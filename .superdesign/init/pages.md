# Page dependency trees

All views share: public/index.html, public/style.css, public/app.js (render functions inside app.js), and the JSON API in src/server.js (data from src/metrics.js).

## #today - Today board
Entry: renderToday() + renderTodayList() in public/app.js
Dependencies: public/index.html, public/style.css, GET /api/status, helpers pill()/dot()/hm()/clock()

## #matrix - Employee x Project
Entry: renderMatrix() in public/app.js
Dependencies: GET /api/matrix, heat colour via color-mix(accent, surface), controls from renderControls() (presets, dates, %/hours toggle, CSV)

## #projects - Projects
Entry: renderProjects() in public/app.js
Dependencies: GET /api/projects, .proj-grid / .contrib CSS

## #compliance - Compliance
Entry: renderCompliance() in public/app.js
Dependencies: GET /api/compliance, .rate / .meter / .tag CSS

## #settings - Team settings
Entry: renderSettings() + wireSettings() in public/app.js
Dependencies: GET/PATCH /api/users

## Employee drawer (opened from any view)
Entry: openEmployee() in public/app.js
Dependencies: GET /api/employee/:id, stackHtml(), .bars/.bar-col CSS
