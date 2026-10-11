const cfg = require("./config");
const { db } = require("./db");
const { today, addDays, isWorkingDay, eachDay } = require("./dates");

const expectedFor = (u) => u.expected_hours ?? cfg.expectedHours;

function trackedUsers() {
  return db
    .prepare("SELECT id, name, email, expected_hours FROM users WHERE status = 'ACTIVE' AND is_tracked = 1 ORDER BY name")
    .all();
}

// ---- Today board -----------------------------------------------------------
function dayStatus(date) {
  const users = trackedUsers();
  const rows = db
    .prepare(
      `SELECT user_id, project_name, task, description, start_utc, end_utc, running, secs
       FROM work_entries WHERE work_date = ? ORDER BY start_utc`
    )
    .all(date);
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }

  const working = isWorkingDay(date);
  const employees = users.map((u) => {
    const entries = (byUser.get(u.id) || []).map((e) => ({
      project: e.project_name, task: e.task, description: e.description,
      start: e.start_utc, end: e.end_utc, running: !!e.running, seconds: e.secs,
    }));
    const seconds = entries.reduce((s, e) => s + e.seconds, 0);
    const expectedHours = expectedFor(u);
    let status;
    if (entries.length === 0) status = working ? "missing" : "off";
    else status = seconds >= expectedHours * 3600 * 0.999 ? "complete" : "partial";
    return {
      id: u.id, name: u.name, email: u.email, expectedHours, seconds, status,
      running: entries.some((e) => e.running), entries,
    };
  });

  const count = (s) => employees.filter((e) => e.status === s).length;
  return {
    date,
    isWorkingDay: working,
    summary: {
      total: employees.length,
      submitted: employees.filter((e) => e.entries.length > 0).length,
      missing: count("missing"), partial: count("partial"), complete: count("complete"), off: count("off"),
      totalSeconds: employees.reduce((s, e) => s + e.seconds, 0),
    },
    employees,
  };
}

// ---- Employee x project matrix --------------------------------------------
function matrix(from, to) {
  const users = trackedUsers();
  const ids = new Set(users.map((u) => u.id));
  const rows = db
    .prepare(
      `SELECT user_id, COALESCE(project_id, 'none') AS pid, project_name, SUM(secs) AS secs
       FROM work_entries WHERE work_date BETWEEN ? AND ? GROUP BY user_id, pid`
    )
    .all(from, to)
    .filter((r) => ids.has(r.user_id));

  const projects = new Map();
  const perUser = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, totalSeconds: 0, byProject: {} }]));
  for (const r of rows) {
    const p = projects.get(r.pid) || { id: r.pid, name: r.project_name, seconds: 0 };
    p.seconds += r.secs;
    projects.set(r.pid, p);
    const e = perUser.get(r.user_id);
    e.byProject[r.pid] = r.secs;
    e.totalSeconds += r.secs;
  }
  return {
    from, to,
    projects: [...projects.values()].sort((a, b) => b.seconds - a.seconds),
    employees: [...perUser.values()],
  };
}

// ---- Per-project view ---------------------------------------------------------
function projectSummary(from, to) {
  const m = matrix(from, to);
  return {
    from, to,
    totalSeconds: m.projects.reduce((s, p) => s + p.seconds, 0),
    projects: m.projects.map((p) => {
      const contributors = m.employees
        .filter((e) => e.byProject[p.id])
        .map((e) => ({ id: e.id, name: e.name, seconds: e.byProject[p.id] }))
        .sort((a, b) => b.seconds - a.seconds);
      return { ...p, contributors };
    }),
  };
}

// ---- Compliance (uses only completed days: today is excluded) -------------------
function complianceDays(from, to) {
  const lastFullDay = addDays(today(), -1);
  return eachDay(from, to < lastFullDay ? to : lastFullDay).filter(isWorkingDay);
}

function compliance(from, to) {
  const users = trackedUsers();
  const workDays = complianceDays(from, to);
  const rows = db
    .prepare(
      `SELECT user_id, work_date, SUM(secs) AS secs FROM work_entries
       WHERE work_date BETWEEN ? AND ? GROUP BY user_id, work_date`
    )
    .all(from, to);
  const perUser = new Map();
  for (const r of rows) {
    if (!perUser.has(r.user_id)) perUser.set(r.user_id, new Map());
    perUser.get(r.user_id).set(r.work_date, r.secs);
  }
  return {
    from, to,
    workingDays: workDays.length,
    employees: users.map((u) => {
      const days = perUser.get(u.id) || new Map();
      const logged = workDays.filter((d) => days.has(d));
      const totalSeconds = [...days.values()].reduce((s, v) => s + v, 0);
      return {
        id: u.id, name: u.name,
        daysLogged: logged.length,
        workingDays: workDays.length,
        rate: workDays.length ? logged.length / workDays.length : null,
        totalSeconds,
        avgSecondsPerLoggedDay: days.size ? totalSeconds / days.size : 0,
        missingDates: workDays.filter((d) => !days.has(d)),
      };
    }),
  };
}

// ---- One employee ---------------------------------------------------------------
function employee(id, from, to) {
  const user = db.prepare("SELECT id, name, email, expected_hours FROM users WHERE id = ?").get(id);
  if (!user) return null;
  const rows = db
    .prepare(
      `SELECT work_date, project_name, task, description, start_utc, end_utc, running, secs
       FROM work_entries WHERE user_id = ? AND work_date BETWEEN ? AND ? ORDER BY start_utc`
    )
    .all(id, from, to);

  const byProject = {};
  const byDay = new Map(eachDay(from, to).map((d) => [d, { date: d, working: isWorkingDay(d), seconds: 0, byProject: {} }]));
  for (const r of rows) {
    byProject[r.project_name] = (byProject[r.project_name] || 0) + r.secs;
    const day = byDay.get(r.work_date);
    day.seconds += r.secs;
    day.byProject[r.project_name] = (day.byProject[r.project_name] || 0) + r.secs;
  }
  const totalSeconds = rows.reduce((s, r) => s + r.secs, 0);
  const workDays = complianceDays(from, to);
  const loggedWorkDays = workDays.filter((d) => byDay.get(d)?.seconds > 0).length;

  return {
    user: { id: user.id, name: user.name, email: user.email, expectedHours: expectedFor(user) },
    from, to, totalSeconds,
    daysLogged: loggedWorkDays,
    workingDays: workDays.length,
    byProject: Object.entries(byProject)
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds),
    byDay: [...byDay.values()],
    entries: rows.map((r) => ({
      date: r.work_date, project: r.project_name, task: r.task, description: r.description,
      start: r.start_utc, end: r.end_utc, running: !!r.running, seconds: r.secs,
    })),
  };
}

// ---- Team settings ------------------------------------------------------------------
const listUsers = () =>
  db.prepare("SELECT id, name, email, expected_hours AS expectedHours, is_tracked AS isTracked FROM users WHERE status = 'ACTIVE' ORDER BY name").all()
    .map((u) => ({ ...u, isTracked: !!u.isTracked, defaultHours: cfg.expectedHours }));

function updateUser(id, { isTracked, expectedHours }) {
  if (isTracked !== undefined) db.prepare("UPDATE users SET is_tracked = ? WHERE id = ?").run(isTracked ? 1 : 0, id);
  if (expectedHours !== undefined) {
    const v = expectedHours === null || expectedHours === "" ? null : Number(expectedHours);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 24)) throw new Error("expectedHours must be between 0 and 24");
    db.prepare("UPDATE users SET expected_hours = ? WHERE id = ?").run(v, id);
  }
}

// Ordered by all-time hours so the biggest projects get the stable categorical colours in the UI.
const projectNames = () =>
  db.prepare("SELECT project_name AS name FROM work_entries GROUP BY project_name ORDER BY SUM(secs) DESC, project_name").all().map((r) => r.name);

module.exports = { dayStatus, matrix, projectSummary, compliance, employee, listUsers, updateUser, projectNames };
