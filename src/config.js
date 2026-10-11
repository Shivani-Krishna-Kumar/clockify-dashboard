const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const list = (value, fallback = "") =>
  (value ?? fallback).split(",").map((s) => s.trim()).filter(Boolean);

module.exports = {
  root,
  apiKey: process.env.CLOCKIFY_API_KEY || "",
  workspaceId: process.env.WORKSPACE_ID || "",
  tz: process.env.OFFICE_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  expectedHours: Number(process.env.EXPECTED_HOURS || 8),
  workingDays: list(process.env.WORKING_DAYS, "1,2,3,4,5").map(Number), // ISO: 1=Mon..7=Sun
  holidays: list(process.env.HOLIDAYS),
  excludedProjects: list(process.env.EXCLUDED_PROJECTS, "Lunch Break"),
  syncCron: process.env.SYNC_CRON || "0 8-20 * * *",
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  password: process.env.DASHBOARD_PASSWORD || "",
  dbPath: process.env.DB_PATH || path.join(root, "data", "dashboard.db"),
};
