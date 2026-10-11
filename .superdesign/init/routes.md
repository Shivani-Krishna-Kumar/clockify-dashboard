# Routes

## UI
Single page `/` (public/index.html). Views are tabs selected by URL hash: `#today` `#matrix` `#projects` `#compliance` `#settings`. Layout: the single shell in layouts.md.

## JSON API (backend: src/server.js, Express)
- GET /api/config  - tz, today, expectedHours, excludedProjects, projects[] (ordered by hours)
- GET /api/status?date= - Today board data (summary + employees[] with entries)
- GET /api/matrix?from=&to= - employee x project seconds
- GET /api/projects?from=&to= - per-project totals + contributors
- GET /api/compliance?from=&to= - submission rate per employee
- GET /api/employee/:id?from=&to= - drawer data (byProject, byDay, entries)
- GET /api/users, PATCH /api/users/:id - Team settings (isTracked, expectedHours)
- GET /api/sync-status, POST /api/sync

## Full source: src/server.js
```js
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cron = require("node-cron");
const cfg = require("./config");
const metrics = require("./metrics");
const { runSync, lastSync, hasSuccessfulSync } = require("./sync");
const { today, addDays, isDate } = require("./dates");

const app = express();
app.use(express.json());

// Shared-password gate (HTTP Basic). Username is ignored.
app.use((req, res, next) => {
  if (!cfg.password) return next();
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme === "Basic" && token) {
    const supplied = Buffer.from(Buffer.from(token, "base64").toString().split(":").slice(1).join(":"));
    const expected = Buffer.from(cfg.password);
    if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Clockify Dashboard"').status(401).send("Authentication required");
});

const handler = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

function range(req) {
  const to = req.query.to || today();
  const from = req.query.from || addDays(to, -6);
  if (!isDate(from) || !isDate(to)) throw badRequest("from/to must be YYYY-MM-DD");
  if (from > to) throw badRequest("from must be on or before to");
  return [from, to];
}

app.get("/api/config", handler(() => ({
  tz: cfg.tz,
  today: today(),
  expectedHours: cfg.expectedHours,
  excludedProjects: cfg.excludedProjects,
  projects: metrics.projectNames(),
})));

app.get("/api/status", handler((req) => {
  const date = req.query.date || today();
  if (!isDate(date)) throw badRequest("date must be YYYY-MM-DD");
  return metrics.dayStatus(date);
}));
app.get("/api/matrix", handler((req) => metrics.matrix(...range(req))));
app.get("/api/projects", handler((req) => metrics.projectSummary(...range(req))));
app.get("/api/compliance", handler((req) => metrics.compliance(...range(req))));
app.get("/api/employee/:id", handler((req) => {
  const out = metrics.employee(req.params.id, ...range(req));
  if (!out) throw Object.assign(new Error("Unknown employee"), { status: 404 });
  return out;
}));

app.get("/api/users", handler(() => metrics.listUsers()));
app.patch("/api/users/:id", handler((req) => {
  const { isTracked, expectedHours } = req.body || {};
  try {
    metrics.updateUser(req.params.id, { isTracked, expectedHours });
  } catch (err) {
    throw badRequest(err.message);
  }
  return { ok: true };
}));

app.get("/api/sync-status", handler(() => ({ last: lastSync(), running: !!syncing, schedule: cfg.syncCron })));

let syncing = null;
function startSync(days) {
  if (!syncing) {
    syncing = runSync({ days })
      .catch((err) => console.error("Sync failed:", err.message))
      .finally(() => { syncing = null; });
  }
  return syncing;
}
app.post("/api/sync", async (req, res) => {
  await startSync(7);
  res.json({ last: lastSync() });
});

app.use(express.static(path.join(cfg.root, "public")));

if (!cron.validate(cfg.syncCron)) throw new Error(`Invalid SYNC_CRON: ${cfg.syncCron}`);
cron.schedule(cfg.syncCron, () => startSync(7), { timezone: cfg.tz });

app.listen(cfg.port, cfg.host, () => {
  console.log(`Dashboard on http://localhost:${cfg.port}  (office timezone: ${cfg.tz})`);
  if (!cfg.password) console.warn("WARNING: DASHBOARD_PASSWORD is empty - anyone who can reach this port can see everyone's hours.");
  if (!cfg.apiKey) console.warn("WARNING: CLOCKIFY_API_KEY is not set - copy .env.example to .env and fill it in.");
  else if (!hasSuccessfulSync()) {
    console.log("No data yet - running first sync (last 30 days)...");
    startSync(30);
  }
});
```

