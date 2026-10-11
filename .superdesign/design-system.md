# Design system: Team Time Dashboard

## Product context
Internal web dashboard for a small security-consulting company (TechGuard Labs Foundation) that tracks hours in Clockify. Audience: managers who open it once or twice a day to answer, in this order:
1. Who has not logged today's work yet? (needs a nudge)
2. What did everyone do and for how many hours?
3. Across a date range: what share of each person's time went to each project, and who contributes to which project?

Desktop-first (managers on laptops), must still work on a phone. Read-only except a small Team settings screen.

## Views (content MUST stay exactly as is, only layout/arrangement may change)
- Today: per-employee status (Missing / Partial / Complete / Day off + "Timer running"), hours vs expected hours, list of entries (time range, project, task/description, duration). Summary counts: Submitted x of N, Missing, Partial, Complete, Team hours. Filter All/Missing/Partial/Complete. Day stepper + date input. Export CSV.
- Employee x Project: table of employees (rows) by projects (columns) showing % of the employee's own hours (rows sum to 100%) or hours, heat-shaded. Team total row. Presets + From/To dates. Export CSV.
- Projects: one block per project: total hours, % of team, number of people, contributors with share bars.
- Compliance: per employee days logged / working days, submission-rate bar, avg hours per logged day, total hours, missing dates.
- Team settings: per employee Tracked checkbox + expected hours/day input.
- Employee detail drawer: total hours, days logged, avg per logged day, project split bar + legend, hours-per-day bars, entries table.
- Header: title, office timezone note, "Last synced ..." text, Refresh now button, error banner when a sync fails.

## Visual style (KEEP - do not invent a new look)
- Calm, utilitarian, data-dense but legible. Flat: 1px borders, NO shadows, NO gradients.
- Font: system-ui, -apple-system, "Segoe UI", sans-serif only. Body 14px/1.45. Page title 20px/600. Section title 15px/600. KPI number 26px/600.
- Light theme: page #f9f9f7, surface #fcfcfb, ink #0b0b0b, secondary ink #52514e, muted #6e6c66, grid lines #e1e0d9, borders/axes #c3c2b7.
- Dark theme (also supported): page #0d0d0d, surface #1a1a19, ink #ffffff, secondary #c3c2b7, muted #a09e96, grid #2c2c2a, borders #383835.
- One accent: blue #2a78d6 (light) / #3987e5 (dark) for selected state, links, meters, heat-map.
- Status colours, ALWAYS with a text label and a dot, never colour alone: Complete green #0ca30c, Partial amber #fab219, Missing red #d03b3b, Day off grey #898781, Timer running blue accent.
- Project colours (fixed categorical order, 8 max, extra projects grouped as grey "Other" #898781): blue #2a78d6, orange #eb6834, aqua #1baf7a, yellow #eda100, magenta #e87ba4, green #008300, violet #4a3aa7, red #e34948.
- Radius: controls 8px, panels 12px, status pills fully round. Spacing on a 4px grid; 16px page gutter; 12px gap between panels.
- Controls: bordered buttons/chips on the surface colour; selected chip = accent border + 14% accent tint + semibold.

## Layout principles for the redesign
- Show less at once: progressive disclosure. Details (entry lists) are collapsed until the user asks for them.
- Put the answer to "who needs attention" first and make it unmissable without extra colour: group Missing/Partial at the top.
- One clear primary action per screen; secondary actions (export, refresh) are quiet.
- One date control per screen (a single compact range control with presets inside), not a row of preset chips plus two pickers.
- Group related controls; separate navigation from filters from page actions.
- Keep real copy, real labels and real numbers; sentence case; no marketing text.
- Keyboard accessible, visible focus rings, targets at least 32px tall, works at 375px width.
