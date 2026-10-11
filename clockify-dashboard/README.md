# Clockify Team Dashboard

Internal dashboard for the TechGuard Labs Foundation Clockify workspace. It pulls everyone's time entries into a local SQLite file and shows:

- **Today** - who has / hasn't logged (Missing / Partial / Complete, timer-running badge), hours vs expected, every entry with project + description.
- **Employee × Project** - each person's hours and **% split across projects** (rows sum to 100%), switchable to hours.
- **Projects** - hours per project and who contributed what share.
- **Compliance** - submission rate over a range (days logged / working days), avg hours per logged day, missing dates.
- **Team settings** - untrack people (admins/contractors) and set expected hours per person.
- Click any name for a drawer with their project split, hours per day and entry list. Every table exports to CSV.

## Setup

Requires **Node 22.13+** (uses the built-in `node:sqlite`; no native build step).

```bash
npm install
copy .env.example .env      # then edit .env
npm run check               # verifies the key can read ALL users' entries
npm run backfill            # one-time: load the last 90 days
npm start                   # http://localhost:3000
```

In `.env` set `CLOCKIFY_API_KEY` to a **workspace admin/owner** key (a normal user's key can only read their own entries - `npm run check` will tell you). The key stays on the server and is never sent to the browser. `WORKSPACE_ID` is pre-filled for TechGuard Labs Foundation.

Set `DASHBOARD_PASSWORD` before exposing it on the office network (browser asks for it; username is ignored).

## How it works

- `src/sync.js` fetches users, projects and each user's entries (GET only). Every run re-reads the **last 7 days** so late backfills, edits and deletions in Clockify are picked up. Default schedule: hourly 08:00-20:00 office time (`SYNC_CRON`); the **Refresh now** button syncs on demand.
- Days are bucketed in `OFFICE_TZ`, not UTC. An entry belongs to the day it started.
- Projects in `EXCLUDED_PROJECTS` (default `Lunch Break`) don't count in any hours or percentages.
- Running timers count up to "now" and show a badge.
- Compliance counts only completed working days (today is excluded until it ends). Weekends come from `WORKING_DAYS`; add `HOLIDAYS` as `YYYY-MM-DD,...`.
- Status rules: **Missing** = no entries on a working day, **Partial** = below expected hours (default 8, per-person override), **Complete** = met expected hours.

## Trying it without Clockify

```bash
set DB_PATH=data/demo.db
node scripts/seed-demo.js
npm start
```

## Keeping it running (Windows)

Run it on an always-on office PC/server: `npm i -g pm2 && pm2 start src/server.js --name clockify-dashboard && pm2 save`, or create a Task Scheduler task that runs `node src/server.js` at startup.

## Notes

- Colours: the top 8 projects (by all-time hours) get a fixed colour; the rest are grouped as "Other" in charts but are always named in the tables.
- `.env` and `data/` are gitignored.
