const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const list = (value, fallback = "") =>
  (value ?? fallback).split(",").map((s) => s.trim()).filter(Boolean);

// DEMO_MODE=1: read-only showcase (e.g. on Vercel) served from a bundled snapshot of the database.
// Create the snapshot with `npm run snapshot`; it lives in demo-data/snapshot.js.
const demo = process.env.DEMO_MODE === "1";
let snapshot = null;
if (demo) {
  try {
    snapshot = require("../demo-data/snapshot.js");
  } catch {
    throw new Error("DEMO_MODE=1 but demo-data/snapshot.js is missing. Run `npm run snapshot` first.");
  }
}

module.exports = {
  root,
  demo,
  snapshot,
  apiKey: process.env.CLOCKIFY_API_KEY || "",
  workspaceId: process.env.WORKSPACE_ID || "",
  tz: process.env.OFFICE_TZ || snapshot?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
  // In demo mode "today" is frozen to the last day that has data, so the Today view is never empty.
  demoToday: demo ? process.env.DEMO_TODAY || snapshot.lastDay || "" : "",
  expectedHours: Number(process.env.EXPECTED_HOURS || 8),
  workingDays: list(process.env.WORKING_DAYS, "1,2,3,4,5").map(Number), // ISO: 1=Mon..7=Sun
  holidays: list(process.env.HOLIDAYS),
  excludedProjects: list(process.env.EXCLUDED_PROJECTS, "Lunch Break"),
  syncCron: process.env.SYNC_CRON || "0 8-20 * * *",
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  password: process.env.DASHBOARD_PASSWORD || "",
  // demo: a writable copy of the snapshot in the OS temp dir (the only writable place on Vercel)
  dbPath: demo ? path.join(os.tmpdir(), "clockify-dashboard-demo.db") : process.env.DB_PATH || path.join(root, "data", "dashboard.db"),
};
