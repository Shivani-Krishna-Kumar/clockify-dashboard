// Pulls users, projects and time entries from Clockify into SQLite.
// CLI: node src/sync.js --days 7   (use --days 90 for the first backfill)
const cfg = require("./config");
const clockify = require("./clockify");
const { db, transaction } = require("./db");
const { dayOf } = require("./dates");

const iso = (v) => new Date(v).toISOString();

function syncUsers(users) {
  const upsert = db.prepare(`
    INSERT INTO users (id, name, email, status) VALUES (?, ?, ?, 'ACTIVE')
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, status = 'ACTIVE'`);
  transaction(() => {
    db.exec("UPDATE users SET status = 'INACTIVE'");
    for (const u of users) upsert.run(u.id, u.name, u.email);
  });
}

function syncProjects(projects) {
  const upsert = db.prepare(`
    INSERT INTO projects (id, name, client, archived) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, client = excluded.client, archived = excluded.archived`);
  transaction(() => {
    for (const p of projects) upsert.run(p.id, p.name, p.clientName || null, p.archived ? 1 : 0);
  });
}

function syncUserEntries(userId, entries, windowStartIso) {
  const upsert = db.prepare(`
    INSERT INTO entries (id, user_id, project_id, task, description, start_utc, end_utc, seconds, running, work_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id, project_id = excluded.project_id, task = excluded.task,
      description = excluded.description, start_utc = excluded.start_utc, end_utc = excluded.end_utc,
      seconds = excluded.seconds, running = excluded.running, work_date = excluded.work_date`);
  const seen = new Set();

  transaction(() => {
    for (const e of entries) {
      const start = iso(e.timeInterval.start);
      const end = e.timeInterval.end ? iso(e.timeInterval.end) : null;
      const seconds = end ? Math.round((new Date(end) - new Date(start)) / 1000) : 0;
      seen.add(e.id);
      upsert.run(
        e.id, userId, e.projectId || null, e.task?.name || null, e.description || null,
        start, end, seconds, end ? 0 : 1, dayOf(start)
      );
    }
    // Entries edited/deleted in Clockify disappear from the window: drop them here too.
    const stored = db
      .prepare("SELECT id FROM entries WHERE user_id = ? AND start_utc >= ?")
      .all(userId, windowStartIso);
    const del = db.prepare("DELETE FROM entries WHERE id = ?");
    for (const row of stored) if (!seen.has(row.id)) del.run(row.id);
  });
  return seen.size;
}

async function runSync({ days = 7 } = {}) {
  if (!cfg.apiKey || !cfg.workspaceId) {
    throw new Error("CLOCKIFY_API_KEY and WORKSPACE_ID must be set in .env");
  }
  const startedAt = new Date().toISOString();
  const logId = Number(
    db.prepare("INSERT INTO sync_log (started_at, days, status) VALUES (?, ?, 'running')").run(startedAt, days)
      .lastInsertRowid
  );

  let seen = 0;
  const errors = [];
  try {
    const users = await clockify.listUsers();
    syncUsers(users);
    syncProjects(await clockify.listProjects());

    const windowStart = new Date(Date.now() - days * 86400e3).toISOString();
    const windowEnd = new Date(Date.now() + 86400e3).toISOString(); // include running timers
    for (const u of users) {
      try {
        const entries = await clockify.listEntries(u.id, windowStart, windowEnd);
        seen += syncUserEntries(u.id, entries, windowStart);
      } catch (err) {
        errors.push(`${u.name}: ${err.message}`);
      }
    }
    if (errors.length === users.length && users.length > 0) {
      throw new Error(
        `Could not read time entries for any user. Is the API key a workspace admin? First error: ${errors[0]}`
      );
    }
    const status = errors.length ? "partial" : "ok";
    db.prepare("UPDATE sync_log SET finished_at=?, entries_seen=?, status=?, error=? WHERE id=?").run(
      new Date().toISOString(), seen, status, errors.join("\n") || null, logId
    );
    return { status, users: users.length, entries: seen, errors };
  } catch (err) {
    db.prepare("UPDATE sync_log SET finished_at=?, entries_seen=?, status='error', error=? WHERE id=?").run(
      new Date().toISOString(), seen, err.message, logId
    );
    throw err;
  }
}

function lastSync() {
  return db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1").get() || null;
}
function hasSuccessfulSync() {
  return !!db.prepare("SELECT 1 AS ok FROM sync_log WHERE status IN ('ok','partial') LIMIT 1").get();
}

module.exports = { runSync, lastSync, hasSuccessfulSync };

if (require.main === module) {
  const i = process.argv.indexOf("--days");
  const days = i > -1 ? Number(process.argv[i + 1]) : 7;
  runSync({ days })
    .then((r) => {
      console.log(`Sync ${r.status}: ${r.users} users, ${r.entries} entries (last ${days} days).`);
      if (r.errors.length) console.warn("Problems:\n" + r.errors.join("\n"));
    })
    .catch((err) => {
      console.error("Sync failed:", err.message);
      process.exit(1);
    });
}
