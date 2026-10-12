const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cron = require("node-cron");
const cfg = require("./config");
const metrics = require("./metrics");
const { runSync, lastSync, hasSuccessfulSync } = require("./sync");
const { today, addDays, isDate } = require("./dates");

// A demo serves real data from a public URL, so it must never run without the password.
if (cfg.demo && !cfg.password) throw new Error("DEMO_MODE=1 requires DASHBOARD_PASSWORD to be set.");

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
  demo: cfg.demo,
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
const demoBlocked = () => Object.assign(new Error("This is a read-only demo; changes are disabled."), { status: 403 });
app.patch("/api/users/:id", handler((req) => {
  if (cfg.demo) throw demoBlocked();
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
  if (cfg.demo) return res.status(403).json({ error: demoBlocked().message });
  await startSync(7);
  res.json({ last: lastSync() });
});

// Hosts like Vercel serve public/ files without running the password check above. If the page's API
// calls come back 401, the UI sends the browser here: a top-level request always gets the browser's
// password prompt, and on success we return to the dashboard.
app.get("/login", (req, res) => res.redirect("/"));

// The three page files are read with literal paths on purpose: Vercel bundles only the files it can
// find by reading the code, and it does not find a directory handed to express.static. These routes
// also run behind the password check above on every host.
const page = (type, file) => ({ type, body: file });
const pages = {
  "/": page("text/html; charset=utf-8", fs.readFileSync(path.join(__dirname, "..", "public", "index.html"))),
  "/index.html": page("text/html; charset=utf-8", fs.readFileSync(path.join(__dirname, "..", "public", "index.html"))),
  "/app.js": page("text/javascript; charset=utf-8", fs.readFileSync(path.join(__dirname, "..", "public", "app.js"))),
  "/style.css": page("text/css; charset=utf-8", fs.readFileSync(path.join(__dirname, "..", "public", "style.css"))),
};
app.get(Object.keys(pages), (req, res) => {
  const p = pages[req.path];
  res.set("Cache-Control", "no-cache").type(p.type).send(p.body);
});

app.use(express.static(path.join(cfg.root, "public")));

// Exported so a serverless host (Vercel) can run it; only `node src/server.js` starts a listener.
module.exports = app;

if (require.main === module) {
  app.listen(cfg.port, cfg.host, () => {
    console.log(`Dashboard on http://localhost:${cfg.port}  (office timezone: ${cfg.tz})`);
    if (cfg.demo) {
      console.log(`DEMO MODE: read-only snapshot, "today" frozen at ${cfg.demoToday}. Sync is off.`);
      return;
    }
    if (!cron.validate(cfg.syncCron)) throw new Error(`Invalid SYNC_CRON: ${cfg.syncCron}`);
    cron.schedule(cfg.syncCron, () => startSync(7), { timezone: cfg.tz });
    if (!cfg.password) console.warn("WARNING: DASHBOARD_PASSWORD is empty - anyone who can reach this port can see everyone's hours.");
    if (!cfg.apiKey) console.warn("WARNING: CLOCKIFY_API_KEY is not set - copy .env.example to .env and fill it in.");
    else if (!hasSuccessfulSync()) {
      console.log("No data yet - running first sync (last 30 days)...");
      startSync(30);
    }
  });
}
