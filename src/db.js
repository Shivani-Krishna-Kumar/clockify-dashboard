const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const cfg = require("./config");
const { today, addDays, startOfDayUtc } = require("./dates");

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
if (cfg.demo) {
  // Fresh copy of the bundled snapshot; drop stale WAL files so they can't be replayed onto it.
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(cfg.dbPath + ext, { force: true });
  fs.writeFileSync(cfg.dbPath, Buffer.from(cfg.snapshot.db, "base64"));
}
const db = new DatabaseSync(cfg.dbPath);

// Seconds for a timer that is still running. A timer on today's date counts up to "now"; a timer
// left running on an earlier day is capped at the end of that day, so a forgotten timer can't
// add hundreds of phantom hours.
db.function("running_secs", (startUtc, workDate) => {
  const start = Date.parse(startUtc);
  const end = workDate === today() ? Date.now() : startOfDayUtc(addDays(workDate, 1));
  return Math.max(0, Math.round((end - start) / 1000));
});

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    expected_hours REAL,
    is_tracked INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT,
    client TEXT,
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT,
    task TEXT,
    description TEXT,
    start_utc TEXT NOT NULL,
    end_utc TEXT,
    seconds INTEGER NOT NULL DEFAULT 0,
    running INTEGER NOT NULL DEFAULT 0,
    work_date TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries (work_date);
  CREATE INDEX IF NOT EXISTS idx_entries_user_start ON entries (user_id, start_utc);

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT,
    finished_at TEXT,
    days INTEGER,
    entries_seen INTEGER,
    status TEXT,
    error TEXT
  );
`);

// "work_entries" = entries that count as work (excluded projects removed), with live seconds
// for running timers. Recreated on every start so config changes apply immediately.
const excluded = cfg.excludedProjects.map((n) => `'${n.toLowerCase().replace(/'/g, "''")}'`).join(",") || "''";
db.exec(`
  DROP VIEW IF EXISTS work_entries;
  CREATE VIEW work_entries AS
  SELECT e.id, e.user_id, e.project_id,
         COALESCE(p.name, 'No project') AS project_name,
         e.task, e.description, e.start_utc, e.end_utc, e.running, e.work_date,
         CASE WHEN e.running = 1
              THEN running_secs(e.start_utc, e.work_date)
              ELSE e.seconds END AS secs
  FROM entries e
  LEFT JOIN projects p ON p.id = e.project_id
  WHERE p.name IS NULL OR lower(p.name) NOT IN (${excluded});
`);

function transaction(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

module.exports = { db, transaction };
