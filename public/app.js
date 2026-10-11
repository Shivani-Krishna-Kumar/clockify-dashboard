(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = { tab: "today", date: null, from: null, to: null, mode: "pct", filter: "all", cfg: null, csv: null, token: 0, expanded: new Set(), expandedFor: null };
  const TABS = ["today", "matrix", "projects", "compliance", "settings"];
  const TITLES = { today: "Today", matrix: "Employee × Project", projects: "Projects", compliance: "Compliance", settings: "Team settings" };

  const ICONS = {
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  };
  const svg = (name) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  // ---------- formatting ----------
  const hm = (s) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const hrs = (s) => (s / 3600).toFixed(1);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: state.cfg.tz, hour: "2-digit", minute: "2-digit" });
  const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const stamp = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: state.cfg.tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  // ---------- date math on YYYY-MM-DD strings ----------
  const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const weekday = (s) => (new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
  const monthStart = (s) => `${s.slice(0, 7)}-01`;
  function presets() {
    const t = state.cfg.today;
    const lastMonthEnd = addDays(monthStart(t), -1);
    return [
      ["Today", t, t],
      ["Yesterday", addDays(t, -1), addDays(t, -1)],
      ["This week", addDays(t, -weekday(t)), t],
      ["Last 7 days", addDays(t, -6), t],
      ["This month", monthStart(t), t],
      ["Last month", monthStart(lastMonthEnd), lastMonthEnd],
    ];
  }

  // ---------- project colours: top 8 by hours get a fixed categorical slot, the rest fold into "Other" ----------
  const colorOf = (name) => {
    const i = state.cfg.projects.indexOf(name);
    return i > -1 && i < 8 ? `var(--s${i + 1})` : "var(--other)";
  };
  function foldOthers(items) { // items: [{name, seconds}] -> top-8 projects + one merged "Other"
    const shown = items.filter((x) => colorOf(x.name) !== "var(--other)");
    const rest = items.filter((x) => colorOf(x.name) === "var(--other)");
    const out = [...shown];
    if (rest.length) out.push({ name: rest.length > 1 ? `Other (${rest.length} projects)` : rest[0].name, seconds: rest.reduce((s, x) => s + x.seconds, 0), other: true });
    return out;
  }
  const dot = (name) => `<span class="dot" style="background:${colorOf(name)}"></span>`;

  function stackHtml(items, total) {
    const folded = foldOthers(items).filter((x) => x.seconds > 0);
    if (!total) return "";
    const bar = folded.map((x) => `<span title="${esc(x.name)}: ${hm(x.seconds)} (${pct(x.seconds / total)})" style="width:${(x.seconds / total) * 100}%;background:${x.other ? "var(--other)" : colorOf(x.name)}"></span>`).join("");
    const legend = folded.map((x) => `<div><span class="dot" style="background:${x.other ? "var(--other)" : colorOf(x.name)}"></span>${esc(x.name)}<span class="v num">${pct(x.seconds / total)}</span><span class="muted num">&nbsp;${hrs(x.seconds)}h</span></div>`).join("");
    return `<div class="stack" role="img" aria-label="Project split">${bar}</div><div class="legend">${legend}</div>`;
  }

  // ---------- api ----------
  async function api(path, opts) {
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }
  const qs = () => `from=${state.from}&to=${state.to}`;

  // ---------- CSV ----------
  const csvCell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  function downloadCsv() {
    if (!state.csv) return;
    const text = state.csv.rows.map((r) => r.map(csvCell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `${state.csv.name}-${state.from || state.date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- controls ----------
  const exportBtn = `<button class="btn quiet" id="csvBtn">${svg("download")}Export CSV</button>`;
  const fmtRange = (f, t) => {
    const short = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    return f === t ? dayLabel(f) : `${short(f)} – ${short(t)} ${t.slice(0, 4)}`;
  };
  const closeRange = () => {
    const pop = $("#rangePop"), btn = $("#rangeBtn");
    if (pop) pop.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  };

  function renderControls() {
    const el = $("#controls");
    if (state.tab === "settings") { el.innerHTML = ""; return; }
    if (state.tab === "today") {
      el.innerHTML = `
        <div class="stepper">
          <button class="icon-btn" id="prevDay" aria-label="Previous day">${svg("chevL")}</button>
          <input type="date" id="dayInput" value="${state.date}" max="${state.cfg.today}" aria-label="Day">
          <button class="icon-btn" id="nextDay" aria-label="Next day" ${state.date >= state.cfg.today ? "disabled" : ""}>${svg("chevR")}</button>
          <span class="sep"></span>
          <button class="chip" id="goToday" aria-pressed="${state.date === state.cfg.today}">Today</button>
        </div>
        ${exportBtn}`;
      $("#prevDay").onclick = () => { state.date = addDays(state.date, -1); render(); };
      $("#nextDay").onclick = () => { state.date = addDays(state.date, 1); render(); };
      $("#dayInput").onchange = (e) => { if (e.target.value) { state.date = e.target.value; render(); } };
      $("#goToday").onclick = () => { state.date = state.cfg.today; render(); };
      $("#csvBtn").onclick = downloadCsv;
      return;
    }

    // Employee x Project / Projects / Compliance: one date-range control, presets live in its popover
    const list = presets();
    const match = list.find(([, f, t]) => f === state.from && t === state.to);
    const label = match ? match[0] : fmtRange(state.from, state.to);
    const items = list.map(([name, f, t]) =>
      `<button class="pop-item" role="menuitemradio" aria-checked="${!!match && match[0] === name}" data-from="${f}" data-to="${t}">${name}${svg("check")}</button>`).join("");
    const toggle = state.tab === "matrix"
      ? `<div class="seg" role="group" aria-label="Show">
           <button data-mode="pct" aria-pressed="${state.mode === "pct"}">% of employee's time</button>
           <button data-mode="hours" aria-pressed="${state.mode === "hours"}">Hours</button>
         </div>` : "";
    el.innerHTML = `
      ${toggle}
      <div class="range">
        <button class="btn range-btn" id="rangeBtn" aria-haspopup="true" aria-expanded="false">${svg("cal")}<span>${label}</span>${svg("chevD")}</button>
        <div class="popover" id="rangePop" hidden>
          ${items}
          <div class="pop-sep"></div>
          <div class="pop-custom">
            <span class="hd">Custom range</span>
            <label>From <input type="date" id="fromInput" value="${state.from}" max="${state.cfg.today}"></label>
            <label>To <input type="date" id="toInput" value="${state.to}" max="${state.cfg.today}"></label>
          </div>
        </div>
      </div>
      ${exportBtn}`;
    $("#rangeBtn").onclick = () => {
      const pop = $("#rangePop");
      pop.hidden = !pop.hidden;
      $("#rangeBtn").setAttribute("aria-expanded", String(!pop.hidden));
    };
    el.querySelectorAll("[data-from]").forEach((b) => (b.onclick = () => { state.from = b.dataset.from; state.to = b.dataset.to; render(); }));
    el.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { state.mode = b.dataset.mode; render(); }));
    const apply = () => {
      const f = $("#fromInput").value, t = $("#toInput").value;
      if (f && t && f <= t) { state.from = f; state.to = t; render(); }
    };
    $("#fromInput").onchange = apply;
    $("#toInput").onchange = apply;
    $("#csvBtn").onclick = downloadCsv;
  }

  // ---------- views ----------
  const STATUS = {
    missing: ["Missing", 0], partial: ["Partial", 1], complete: ["Complete", 2], off: ["Day off", 3],
  };
  const pill = (status) => `<span class="pill ${status}"><i></i>${STATUS[status][0]}</span>`;

  let todayData = null;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const projectDots = (entries) => {
    const names = [...new Set(entries.map((x) => x.project))];
    if (!names.length) return "";
    const shown = names.slice(0, 5).map((n) => `<span class="pdot" style="background:${colorOf(n)}"></span>`).join("");
    const more = names.length > 5 ? `<span class="muted">+${names.length - 5}</span>` : "";
    return `<span class="pdots" title="${esc(names.join(", "))}">${shown}</span>${more}`;
  };

  function entryRows(e) {
    if (!e.entries.length) return `<div class="empty-note">${e.status === "off" ? "No entries (non-working day)." : "Nothing logged yet."}</div>`;
    return `<div class="entries">${e.entries.map((x) => `
      <div class="entry">
        <span class="t num">${clock(x.start)} – ${x.running ? "now" : clock(x.end)}</span>
        <span>${dot(x.project)}${esc(x.project)}</span>
        <span class="d">${esc([x.task, x.description].filter(Boolean).join(" · ") || "(no description)")}</span>
        <span class="dur num">${hm(x.seconds)}</span>
      </div>`).join("")}</div>`;
  }

  function employeeRow(e) {
    const frac = Math.min(1, e.seconds / (e.expectedHours * 3600 || 1));
    const open = state.expanded.has(e.id);
    return `<article class="row ${open ? "open" : ""}" data-row="${esc(e.id)}">
      <div class="row-head">
        <button class="icon-btn chev" aria-expanded="${open}" aria-controls="ent-${esc(e.id)}" aria-label="Show entries for ${esc(e.name)}">${svg("chevR")}</button>
        <div class="row-who">
          <button class="emp-name" data-emp="${esc(e.id)}">${esc(e.name)}</button>
          <span class="pills">${pill(e.status)}${e.running ? `<span class="pill live"><i></i>Timer running</span>` : ""}</span>
        </div>
        <div class="row-meta">${projectDots(e.entries)}<span class="muted">${plural(e.entries.length, "entry", "entries")}</span></div>
        <div class="row-hours"><span class="meter" role="img" aria-label="${pct(frac)} of expected hours"><b style="width:${frac * 100}%"></b></span>
          <span class="num"><strong>${hm(e.seconds)}</strong> <span class="muted">/ ${e.expectedHours}h</span></span></div>
      </div>
      <div class="row-body" id="ent-${esc(e.id)}" ${open ? "" : "hidden"}>${entryRows(e)}</div>
    </article>`;
  }

  function visibleEmployees() {
    const rank = (s) => ({ missing: 0, partial: 1, complete: 2, off: 3 }[s]);
    return todayData.employees
      .filter((e) => state.filter === "all" || e.status === state.filter)
      .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
  }

  function updateExpandAll() {
    const btn = $("#expandAll");
    if (!btn) return;
    const list = visibleEmployees();
    btn.hidden = !list.length;
    btn.textContent = list.length && list.every((e) => state.expanded.has(e.id)) ? "Collapse all" : "Expand all";
  }

  function renderTodayList() {
    const list = visibleEmployees();
    const groups = [
      ["attention", "Needs attention", list.filter((e) => e.status === "missing" || e.status === "partial")],
      ["ok", "On track", list.filter((e) => e.status === "complete")],
      ["off", "Day off", list.filter((e) => e.status === "off")],
    ].filter(([, , items]) => items.length);
    $("#empList").innerHTML = groups.length
      ? groups.map(([cls, title, items]) => `<section class="group">
          <h3 class="group-title ${cls}"><i></i>${title} (${items.length})</h3>
          <div class="rows">${items.map(employeeRow).join("")}</div>
        </section>`).join("")
      : `<div class="card muted">No employees match this filter.</div>`;
    document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.filter === state.filter));
    updateExpandAll();
  }

  function toggleRow(id, force) {
    const open = force ?? !state.expanded.has(id);
    if (open) state.expanded.add(id); else state.expanded.delete(id);
    const row = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (row) {
      row.classList.toggle("open", open);
      row.querySelector(".chev").setAttribute("aria-expanded", String(open));
      row.querySelector(".row-body").hidden = !open;
    }
    updateExpandAll();
  }

  async function renderToday() {
    const d = (todayData = await api(`/api/status?date=${state.date}`));
    if (state.expandedFor !== d.date) { state.expanded.clear(); state.expandedFor = d.date; }
    const s = d.summary;
    const csvRows = [["Employee", "Status", "Hours", "Expected hours", "Entries"]];
    d.employees.forEach((e) => csvRows.push([e.name, STATUS[e.status][0], hrs(e.seconds), e.expectedHours, e.entries.length]));
    state.csv = { name: "status", rows: csvRows };
    $("#pageTitle").textContent = d.date === state.cfg.today ? "Today" : "Daily status";
    $("#pageSub").textContent = `${dayLabel(d.date)}${d.isWorkingDay ? "" : " · non-working day"}`;
    const counts = { all: s.total, missing: s.missing, partial: s.partial, complete: s.complete };
    return `
      <div class="statusbar" role="group" aria-label="Summary and filter">
        <span class="sb-item">Submitted <strong>${s.submitted}</strong> of ${s.total}</span>
        <span class="sb-sep"></span>
        ${["all", "missing", "partial", "complete"].map((f) => `<button class="chip" data-filter="${f}" aria-pressed="${state.filter === f}">${f[0].toUpperCase() + f.slice(1)}<span class="n num">${counts[f]}</span></button>`).join("")}
        <span class="sb-sep"></span>
        <span class="sb-item">Team hours <strong>${hrs(s.totalSeconds)}h</strong></span>
      </div>
      <div class="listtools"><span class="muted">Click a row to see what was logged.</span><button class="linkbtn" id="expandAll">Expand all</button></div>
      <div id="empList"></div>`;
  }

  async function renderMatrix() {
    const m = await api(`/api/matrix?${qs()}`);
    const grand = m.employees.reduce((s, e) => s + e.totalSeconds, 0);
    const heat = (p) => `background:color-mix(in srgb, var(--heat) ${Math.round(p * 85)}%, var(--surface));${p > 0.55 ? "color:#fff;" : ""}`;
    const head = m.projects.map((p) => `<th>${dot(p.name)}${esc(p.name)}</th>`).join("");
    const rows = m.employees.map((e) => {
      const cells = m.projects.map((p) => {
        const s = e.byProject[p.id];
        if (!s) return `<td class="muted">–</td>`;
        const share = s / e.totalSeconds;
        const label = state.mode === "pct" ? pct(share) : hrs(s);
        return `<td class="heat num" style="${heat(share)}" title="${esc(e.name)} · ${esc(p.name)}: ${hm(s)} (${pct(share)} of their time)">${label}</td>`;
      }).join("");
      return `<tr><td><button class="link" data-emp="${esc(e.id)}">${esc(e.name)}</button></td>${cells}<td class="num"><strong>${hrs(e.totalSeconds)}h</strong></td></tr>`;
    }).join("");
    const foot = m.projects.map((p) => `<td class="num" title="${pct(grand ? p.seconds / grand : 0)} of team hours">${hrs(p.seconds)}h</td>`).join("");

    const csv = [["Employee", ...m.projects.map((p) => p.name), "Total hours"]];
    m.employees.forEach((e) => csv.push([e.name, ...m.projects.map((p) => {
      const s = e.byProject[p.id] || 0;
      return state.mode === "pct" ? (e.totalSeconds ? ((s / e.totalSeconds) * 100).toFixed(1) + "%" : "") : hrs(s);
    }), hrs(e.totalSeconds)]));
    state.csv = { name: `employee-by-project-${state.mode}`, rows: csv };

    if (!m.projects.length) return `<div class="card muted">No hours logged between ${state.from} and ${state.to}.</div>`;
    return `<p class="muted">${state.mode === "pct" ? "Each row sums to 100% of that employee's tracked hours." : "Hours per employee per project."} Click a name for detail.</p>
      <div class="table-wrap"><table><thead><tr><th>Employee</th>${head}<th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Team total</td>${foot}<td class="num">${hrs(grand)}h</td></tr></tfoot></table></div>`;
  }

  async function renderProjects() {
    const p = await api(`/api/projects?${qs()}`);
    state.csv = { name: "projects", rows: [["Project", "Hours", "Share of team", "Contributors"], ...p.projects.map((x) => [x.name, hrs(x.seconds), p.totalSeconds ? ((x.seconds / p.totalSeconds) * 100).toFixed(1) + "%" : "", x.contributors.length])] };
    if (!p.projects.length) return `<div class="card muted">No hours logged between ${state.from} and ${state.to}.</div>`;
    return `<div class="proj-grid">${p.projects.map((x) => `
      <article class="card">
        <h2>${dot(x.name)}${esc(x.name)}</h2>
        <div class="num"><strong style="font-size:22px">${hrs(x.seconds)}h</strong> <span class="muted">· ${pct(p.totalSeconds ? x.seconds / p.totalSeconds : 0)} of team · ${x.contributors.length} people</span></div>
        <div style="margin-top:8px">${x.contributors.map((c) => {
          const share = c.seconds / x.seconds;
          return `<div class="contrib" style="background:linear-gradient(90deg,color-mix(in srgb,var(--heat) 28%,transparent) ${share * 100}%,transparent ${share * 100}%)">
            <button class="link emp-name" style="font-size:13px;font-weight:400" data-emp="${esc(c.id)}"><span class="name">${esc(c.name)}</span></button>
            <span class="num" style="text-align:right">${pct(share)}</span><span class="num muted" style="text-align:right">${hrs(c.seconds)}h</span></div>`;
        }).join("")}</div>
      </article>`).join("")}</div>`;
  }

  async function renderCompliance() {
    const c = await api(`/api/compliance?${qs()}`);
    const emps = [...c.employees].sort((a, b) => (a.rate ?? 2) - (b.rate ?? 2) || a.name.localeCompare(b.name));
    state.csv = { name: "compliance", rows: [["Employee", "Days logged", "Working days", "Rate", "Avg hours per logged day", "Total hours", "Missing dates"],
      ...emps.map((e) => [e.name, e.daysLogged, e.workingDays, e.rate == null ? "" : (e.rate * 100).toFixed(0) + "%", hrs(e.avgSecondsPerLoggedDay), hrs(e.totalSeconds), e.missingDates.join(" ")])] };
    return `<p class="muted">${c.workingDays} completed working day${c.workingDays === 1 ? "" : "s"} in range (today is not counted until it has finished). Sorted with the lowest submission rate first.</p>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Days logged</th><th>Submission rate</th><th>Avg h / logged day</th><th>Total hours</th><th>Missing days</th></tr></thead><tbody>
      ${emps.map((e) => {
        const shown = e.missingDates.slice(-5);
        return `<tr><td><button class="link" data-emp="${esc(e.id)}">${esc(e.name)}</button></td>
          <td class="num">${e.daysLogged} / ${e.workingDays}</td>
          <td><div class="rate"><span class="meter"><b style="width:${(e.rate ?? 0) * 100}%"></b></span><span class="num" style="min-width:40px">${e.rate == null ? "–" : pct(e.rate)}</span></div></td>
          <td class="num">${hrs(e.avgSecondsPerLoggedDay)}h</td><td class="num">${hrs(e.totalSeconds)}h</td>
          <td><div class="chips">${e.missingDates.length > shown.length ? `<span class="tag">+${e.missingDates.length - shown.length} earlier</span>` : ""}${shown.map((d) => `<span class="tag">${dayLabel(d)}</span>`).join("") || '<span class="muted">none</span>'}</div></td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  async function renderSettings() {
    state.csv = null;
    const users = await api("/api/users");
    return `${state.cfg.demo ? `<p class="hint"><strong>Read-only demo:</strong> these settings can't be changed here.</p>` : ""}<p class="muted">Untrack people who shouldn't appear (admins, contractors). Leave "expected hours" blank to use the default (${state.cfg.expectedHours}h). Changes apply immediately. Projects excluded from all hours: ${esc(state.cfg.excludedProjects.join(", ") || "none")}.</p>
      <div class="table-wrap settings"><table><thead><tr><th>Employee</th><th>Email</th><th>Tracked</th><th>Expected hours / day</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr data-user="${esc(u.id)}"><td>${esc(u.name)}</td><td class="muted">${esc(u.email)}</td>
        <td><input type="checkbox" data-f="isTracked" ${u.isTracked ? "checked" : ""} ${state.cfg.demo ? "disabled" : ""} aria-label="Track ${esc(u.name)}"></td>
        <td><input type="number" min="0" max="24" step="0.5" data-f="expectedHours" value="${u.expectedHours ?? ""}" placeholder="${u.defaultHours}" ${state.cfg.demo ? "disabled" : ""} aria-label="Expected hours for ${esc(u.name)}"></td>
        <td class="muted" data-saved></td></tr>`).join("")}</tbody></table></div>`;
  }

  // ---------- render orchestration ----------
  const RENDERERS = { today: renderToday, matrix: renderMatrix, projects: renderProjects, compliance: renderCompliance, settings: renderSettings };

  async function render() {
    const token = ++state.token;
    document.querySelectorAll(".side [data-tab]").forEach((b) => {
      if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    history.replaceState(null, "", `#${state.tab}`);
    $("#pageTitle").textContent = state.tab === "today" && state.date !== state.cfg.today ? "Daily status" : TITLES[state.tab];
    $("#pageSub").textContent = state.tab === "today" ? dayLabel(state.date) : "";
    renderControls();
    const view = $("#view");
    view.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      const html = await RENDERERS[state.tab]();
      if (token !== state.token) return;
      view.innerHTML = html;
      if (state.tab === "today") {
        renderTodayList();
        view.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; renderTodayList(); }));
        $("#expandAll").onclick = () => {
          const list = visibleEmployees();
          const all = list.every((e) => state.expanded.has(e.id));
          list.forEach((e) => toggleRow(e.id, !all));
        };
      }
      if (state.tab === "settings") wireSettings();
    } catch (err) {
      if (token === state.token) view.innerHTML = `<div class="card">Could not load this view: ${esc(err.message)}</div>`;
    }
  }

  function wireSettings() {
    $("#view").querySelectorAll("tr[data-user]").forEach((row) => {
      row.querySelectorAll("input").forEach((input) => {
        input.onchange = async () => {
          const body = input.dataset.f === "isTracked" ? { isTracked: input.checked } : { expectedHours: input.value === "" ? null : Number(input.value) };
          const note = $("[data-saved]", row);
          try {
            await api(`/api/users/${encodeURIComponent(row.dataset.user)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            note.textContent = "Saved";
          } catch (err) { note.textContent = err.message; }
        };
      });
    });
  }

  // ---------- employee drawer ----------
  let opener = null;
  function closeDrawer() {
    $("#drawer").hidden = true; $("#scrim").hidden = true;
    if (opener && document.contains(opener)) opener.focus();
  }
  async function openEmployee(id, from) {
    opener = from;
    const [f, t] = state.tab === "today" ? [addDays(state.date, -13), state.date] : [state.from, state.to];
    const drawer = $("#drawer");
    drawer.hidden = false; $("#scrim").hidden = false;
    drawer.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      const e = await api(`/api/employee/${encodeURIComponent(id)}?from=${f}&to=${t}`);
      const maxSecs = Math.max(e.user.expectedHours * 3600, ...e.byDay.map((d) => d.seconds), 1);
      const many = e.byDay.length > 31;
      const bars = e.byDay.map((d) => {
        const segs = foldOthers(Object.entries(d.byProject).map(([name, seconds]) => ({ name, seconds })))
          .map((x) => `<span title="${esc(x.name)}: ${hm(x.seconds)}" style="height:${(x.seconds / maxSecs) * 100}%;background:${x.other ? "var(--other)" : colorOf(x.name)}"></span>`).join("");
        return `<div class="bar-col ${d.working ? "" : "off"}" title="${dayLabel(d.date)}: ${d.seconds ? hm(d.seconds) : "nothing logged"}${d.working ? "" : " (non-working day)"}">${segs}</div>`;
      }).join("");
      const labels = e.byDay.map((d, i) => `<span>${many && i % 7 ? "" : d.date.slice(8)}</span>`).join("");
      const loggedDays = e.byDay.filter((d) => d.seconds).length;
      drawer.innerHTML = `
        <div class="drawer-head"><div><h2 style="font-size:18px;margin:0">${esc(e.user.name)}</h2><div class="muted">${esc(e.user.email)} · ${dayLabel(e.from)} – ${dayLabel(e.to)}</div></div>
          <button class="btn" id="closeDrawer">Close</button></div>
        <div class="tiles">
          <div class="tile"><div class="label">Total hours</div><div class="value num">${hrs(e.totalSeconds)}</div></div>
          <div class="tile"><div class="label">Days logged</div><div class="value num">${e.daysLogged} <span class="muted" style="font-size:16px">/ ${e.workingDays}</span></div><div class="sub">completed working days</div></div>
          <div class="tile"><div class="label">Avg per logged day</div><div class="value num">${hrs(loggedDays ? e.totalSeconds / loggedDays : 0)}h</div></div>
        </div>
        <div class="card"><h2>Where the time went</h2>${e.totalSeconds ? stackHtml(e.byProject, e.totalSeconds) : '<span class="muted">No hours in this range.</span>'}</div>
        <div class="card"><h2>Hours per day</h2><div class="bars">${bars}</div><div class="bar-labels">${labels}</div>
          <p class="muted" style="margin:6px 0 0">Bar height is relative to ${hrs(maxSecs)}h. Faded bars are non-working days.</p></div>
        <div class="card"><h2>Entries</h2>${e.entries.length ? `<div class="table-wrap" style="max-height:none"><table><thead><tr><th>Date</th><th>Project</th><th>What</th><th>Time</th></tr></thead><tbody>
          ${[...e.entries].reverse().map((x) => `<tr><td class="num">${x.date.slice(5)}</td><td>${dot(x.project)}${esc(x.project)}</td><td style="white-space:normal">${esc([x.task, x.description].filter(Boolean).join(" · ") || "(no description)")}</td><td class="num">${hm(x.seconds)}${x.running ? " ●" : ""}</td></tr>`).join("")}
          </tbody></table></div>` : '<span class="muted">No entries.</span>'}</div>`;
      $("#closeDrawer").onclick = closeDrawer;
      $("#closeDrawer").focus();
    } catch (err) {
      drawer.innerHTML = `<div class="drawer-head"><span>Could not load: ${esc(err.message)}</span><button class="btn" id="closeDrawer">Close</button></div>`;
      $("#closeDrawer").onclick = closeDrawer;
    }
  }

  // ---------- sync status ----------
  let pollTimer = null;
  async function refreshSyncInfo() {
    try {
      const s = await api("/api/sync-status");
      const last = s.last;
      const banner = $("#banner");
      $("#syncInfo").textContent = s.running ? "Syncing…" : last && last.finished_at ? `Last synced ${stamp(last.finished_at)} · ${last.entries_seen} entries` : "Never synced";
      const problem = last && (last.status === "error" || last.status === "partial") && last.error;
      banner.hidden = !problem;
      if (problem) banner.textContent = `Last sync ${last.status === "error" ? "failed" : "had problems"}: ${last.error}`;
      clearTimeout(pollTimer);
      if (s.running) pollTimer = setTimeout(async () => { await refreshSyncInfo(); render(); }, 3000);
    } catch { /* dashboard still usable with stale data */ }
  }

  // ---------- wiring ----------
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-emp]");
    if (t) openEmployee(t.dataset.emp, t);
  });
  $("#scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
  document.querySelector(".side").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-tab]");
    if (b) { state.tab = b.dataset.tab; render(); }
  });
  // expand / collapse an employee row (the name itself opens the detail drawer instead)
  $("#view").addEventListener("click", (ev) => {
    const head = ev.target.closest(".row-head");
    if (!head || ev.target.closest("[data-emp]")) return;
    toggleRow(head.parentElement.dataset.row);
  });
  // close the date-range popover on outside click or Escape
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".range")) closeRange(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeRange(); });
  $("#refreshBtn").onclick = async () => {
    const btn = $("#refreshBtn");
    btn.disabled = true; btn.textContent = "Syncing…";
    try { await api("/api/sync", { method: "POST" }); } catch (err) { $("#banner").hidden = false; $("#banner").textContent = err.message; }
    btn.disabled = false; btn.textContent = "Refresh now";
    await refreshSyncInfo();
    render();
  };

  (async function init() {
    try {
      state.cfg = await api("/api/config");
    } catch (err) {
      $("#view").innerHTML = `<div class="card">Could not reach the server: ${esc(err.message)}</div>`;
      return;
    }
    const t = state.cfg.today;
    state.date = t; state.from = addDays(t, -6); state.to = t;
    const fromHash = location.hash.slice(1);
    if (TABS.includes(fromHash)) state.tab = fromHash;
    $("#tzInfo").textContent = `Office timezone: ${state.cfg.tz} · excluded from hours: ${state.cfg.excludedProjects.join(", ") || "nothing"}`;
    if (state.cfg.demo) {
      const btn = $("#refreshBtn");
      btn.disabled = true; btn.textContent = "Demo snapshot"; btn.title = "Read-only demo: sync is turned off";
    }
    await refreshSyncInfo();
    render();
  })();
})();
