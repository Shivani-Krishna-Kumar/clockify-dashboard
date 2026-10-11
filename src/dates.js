const cfg = require("./config");

// All "day" logic uses YYYY-MM-DD strings in the office timezone.
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: cfg.tz,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayOf = (value) => dayFormat.format(value instanceof Date ? value : new Date(value));
const today = () => dayOf(new Date());
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoWeekday(dateStr) {
  const g = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun
  return g === 0 ? 7 : g;
}

const isWorkingDay = (dateStr) =>
  cfg.workingDays.includes(isoWeekday(dateStr)) && !cfg.holidays.includes(dateStr);

function eachDay(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

module.exports = { dayOf, today, isDate, addDays, isoWeekday, isWorkingDay, eachDay };
