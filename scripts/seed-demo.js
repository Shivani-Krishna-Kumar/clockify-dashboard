// Fills a SEPARATE demo database with fake employees/entries so the UI can be tried without Clockify.
// Run: DB_PATH=data/demo.db node scripts/seed-demo.js   then   DB_PATH=data/demo.db npm start
process.env.DB_PATH = process.env.DB_PATH || require("path").join(__dirname, "..", "data", "demo.db");
const { db, transaction } = require("../src/db");
const { today, addDays, isWorkingDay, eachDay } = require("../src/dates");

const names = ["Asha Nair", "Ravi Kumar", "Meera Iyer", "Karthik S", "Divya Menon", "Arjun Rao", "Neha Verma", "Sanjay P"];
const projects = ["AI Automation", "Company organized training", "External Penetration Testing", "Internal SOC",
  "Oracle EBS", "OT Security", "Proposal", "Self Learning", "V-Store", "Lunch Break"];
const notes = ["Report writing", "Client call", "Wazuh rule tuning", "Script development", "Review", "Documentation", "Testing"];

// deterministic pseudo-random so the demo looks the same each time
let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(rnd() * a.length)];

transaction(() => {
  for (const t of ["entries", "users", "projects", "sync_log"]) db.exec(`DELETE FROM ${t}`);
  projects.forEach((p, i) => db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(`p${i}`, p));
  names.forEach((n, i) =>
    db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(`u${i}`, n, `${n.split(" ")[0].toLowerCase()}@example.com`));

  const t = today();
  const ins = db.prepare(`INSERT INTO entries (id, user_id, project_id, task, description, start_utc, end_utc, seconds, running, work_date)
                          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  names.forEach((_, ui) => {
    const favourites = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => rnd() - 0.5).slice(0, 2 + (ui % 5)); // 2..6 projects each
    for (const d of eachDay(addDays(t, -20), t)) {
      if (!isWorkingDay(d)) continue;
      if (d === t && ui % 4 === 3) continue;                    // missing today
      if (d !== t && rnd() < 0.08) continue;                    // occasional missed day in the past
      let cursor = new Date(`${d}T09:00:00Z`).getTime();
      const target = d === t && ui % 4 === 2 ? 3 : 7 + rnd() * 2; // partial today
      let remaining = target * 3600;
      while (remaining > 600) {
        const secs = Math.min(remaining, Math.round((0.5 + rnd() * 2.5) * 3600));
        const start = new Date(cursor).toISOString();
        const end = new Date(cursor + secs * 1000).toISOString();
        ins.run(`e${n++}`, `u${ui}`, `p${pick(favourites)}`, pick(notes), start, end, secs, 0, d);
        cursor += secs * 1000;
        remaining -= secs;
      }
      if (d === t && ui === 0) {                                 // running timer today
        ins.run(`e${n++}`, "u0", "p0", "Live task", new Date(Date.now() - 45 * 60e3).toISOString(), null, 0, 1, d);
      }
      if (d !== t) { // lunch break that must NOT count as work
        ins.run(`e${n++}`, `u${ui}`, "p9", "Lunch", `${d}T13:00:00.000Z`, `${d}T13:45:00.000Z`, 2700, 0, d);
      }
    }
  });
  db.prepare("INSERT INTO sync_log (started_at, finished_at, days, entries_seen, status) VALUES (?, ?, 20, ?, 'ok')")
    .run(new Date().toISOString(), new Date().toISOString(), n);
});
console.log(`Seeded demo data into ${process.env.DB_PATH}`);
