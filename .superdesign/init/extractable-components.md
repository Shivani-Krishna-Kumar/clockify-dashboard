# Extractable components

## AppHeader
- Source: `public/index.html` (header.top + #banner)
- Category: layout
- Description: Title, timezone note, last-sync text, Refresh now button, sync error banner
- Extractable props: syncText (string), showBanner (boolean)
- Hardcoded: title, button label, all CSS

## TabBar
- Source: `public/index.html` (nav.tabs)
- Category: layout
- Description: Five view tabs
- Extractable props: activeTab (string, default: "today")
- Hardcoded: tab labels, CSS

## DateControls
- Source: `public/app.js` renderControls()
- Category: layout
- Description: Day stepper (Today view) or preset chips + From/To dates (other views)
- Extractable props: mode (string: day|range), activePreset (string)
- Hardcoded: preset labels, CSS

## EmployeeStatusCard
- Source: `public/app.js` renderTodayList()
- Category: basic
- Description: Employee name, status pill, hours-vs-expected meter and entry rows
- Extractable props: status (string: missing|partial|complete|off), running (boolean)
- Hardcoded: layout, CSS

## StatTile
- Source: `public/style.css` (.tile) + renderToday()
- Category: basic
- Description: KPI tile with label, value, sub-label
- Extractable props: label, value, sub
- Hardcoded: CSS
