(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = { tab: "today", date: null, from: null, to: null, mode: "pct", filter: "all", cfg: null, csv: null, token: 0 };
  const TABS = ["today", "matrix", "projects", "compliance", "settings"];

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
  function renderControls() {
    const el = $("#controls");
    if (state.tab === "settings") { el.innerHTML = ""; return; }
    if (state.tab === "today") {
      el.innerHTML = `
        <button class="btn" id="prevDay" aria-label="Previous day">◀</button>
        <input type="date" id="dayInput" value="${state.date}" max="${state.cfg.today}">
        <button class="btn" id="nextDay" aria-label="Next day" ${state.date >= state.cfg.today ? "disabled" : ""}>▶</button>
        <button class="chip" id="goToday" aria-pressed="${state.date === state.cfg.today}">Today</button>`;
      $("#prevDay").onclick = () => { state.date = addDays(state.date, -1); render(); };
      $("#nextDay").onclick = () => { state.date = addDays(state.date, 1); render(); };
      $("#dayInput").onchange = (e) => { if (e.target.value) { state.date = e.target.value; render(); } };
      $("#goToday").onclick = () => { state.date = state.cfg.today; render(); };
      return;
    }
    const chips = presets().map(([label, f, t]) => `<button class="chip" data-from="${f}" data-to="${t}" aria-pressed="${f === state.from && t === state.to}">${label}</button>`).join("");
    const extra = state.tab === "matrix"
      ? `<span class="spacer"></span>
         <button class="chip" data-mode="pct" aria-pressed="${state.mode === "pct"}">% of employee's time</button>
         <button class="chip" data-mode="hours" aria-pressed="${state.mode === "hours"}">Hours</button>` : `<span class="spacer"></span>`;
    el.innerHTML = `${chips}
      <label>From <input type="date" id="fromInput" value="${state.from}" max="${state.cfg.today}"></label>
      <label>To <input type="date" id="toInput" value="${state.to}" max="${state.cfg.today}"></label>
      ${extra}
      <button class="btn" id="csvBtn">Export CSV</button>`;
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
  function renderTodayList() {
    const d = todayData;
    const rank = (s) => ({ missing: 0, partial: 1, complete: 2, off: 3 }[s]);
    const list = d.employees
      .filter((e) => state.filter === "all" || e.status === state.filter)
      .sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
    $("#empList").innerHTML = list.length ? list.map((e) => {
      const frac = Math.min(1, e.seconds / (e.expectedHours * 3600 || 1));
      const rows = e.entries.length ? `<div class="entries">${e.entries.map((x) => `
        <div class="entry">
          <span class="t num">${clock(x.start)} – ${x.running ? "now" : clock(x.end)}</span>
          <span>${dot(x.project)}${esc(x.project)}</span>
          <span class="d">${esc([x.task, x.description].filter(Boolean).join(" · ") || "(no description)")}</span>
          <span class="dur num">${hm(x.seconds)}</span>
        </div>`).join("")}</div>` : `<div class="empty-note">${e.status === "off" ? "No entries (non-working day)." : "Nothing logged yet."}</div>`;
      return `<article class="card emp">
        <div class="emp-head">
          <button class="emp-name" data-emp="${esc(e.id)}">${esc(e.name)}</button>
          ${pill(e.status)}${e.running ? `<span class="pill live"><i></i>Timer running</span>` : ""}
          <div class="emp-hours"><span class="meter" role="img" aria-label="${pct(frac)} of expected hours"><b style="width:${frac * 100}%"></b></span>
            <span class="num"><strong>${hm(e.seconds)}</strong> <span class="muted">/ ${e.expectedHours}h</span></span></div>
        </div>${rows}</article>`;
    }).join("") : `<div class="card muted">No employees match this filter.</div>`;
    document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.filter === state.filter));
  }

  async function renderToday() {
    const d = (todayData = await api(`/api/status?date=${state.date}`));
    const s = d.summary;
    const csvRows = [["Employee", "Status", "Hours", "Expected hours", "Entries"]];
    d.employees.forEach((e) => csvRows.push([e.name, STATUS[e.status][0], hrs(e.seconds), e.expectedHours, e.entries.length]));
    state.csv = { name: "status", rows: csvRows };
    return `
      <h2>${dayLabel(d.date)}${d.isWorkingDay ? "" : ' <span class="muted">· non-working day</span>'}</h2>
      <div class="tiles">
        <div class="tile"><div class="label">Submitted</div><div class="value num">${s.submitted} <span class="muted" style="font-size:16px">of ${s.total}</span></div></div>
        <div class="tile"><div class="label">Missing</div><div class="value num">${s.missing}</div><div class="sub">no entries</div></div>
        <div class="tile"><div class="label">Partial</div><div class="value num">${s.partial}</div><div class="sub">below expected hours</div></div>
        <div class="tile"><div class="label">Complete</div><div class="value num">${s.complete}</div><div class="sub">met expected hours</div></div>
        <div class="tile"><div class="label">Team hours</div><div class="value num">${hrs(s.totalSeconds)}</div></div>
      </div>
      <div class="controls" style="padding:0 0 12px">
        ${["all", "missing", "partial", "complete"].map((f) => `<button class="chip" data-filter="${f}" aria-pressed="${state.filter === f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
        <span class="spacer"></span><button class="btn" id="csvBtn2">Export CSV</button>
      </div>
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
    return `<p class="muted">Untrack people who shouldn't appear (admins, contractors). Leave "expected hours" blank to use the default (${state.cfg.expectedHours}h). Changes apply immediately. Projects excluded from all hours: ${esc(state.cfg.excludedProjects.join(", ") || "none")}.</p>
      <div class="table-wrap settings"><table><thead><tr><th>Employee</th><th>Email</th><th>Tracked</th><th>Expected hours / day</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr data-user="${esc(u.id)}"><td>${esc(u.name)}</td><td class="muted">${esc(u.email)}</td>
        <td><input type="checkbox" data-f="isTracked" ${u.isTracked ? "checked" : ""} aria-label="Track ${esc(u.name)}"></td>
        <td><input type="number" min="0" max="24" step="0.5" data-f="expectedHours" value="${u.expectedHours ?? ""}" placeholder="${u.defaultHours}" aria-label="Expected hours for ${esc(u.name)}"></td>
        <td class="muted" data-saved></td></tr>`).join("")}</tbody></table></div>`;
  }

  // ---------- render orchestration ----------
  const RENDERERS = { today: renderToday, matrix: renderMatrix, projects: renderProjects, compliance: renderCompliance, settings: renderSettings };

  async function render() {
    const token = ++state.token;
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
    history.replaceState(null, "", `#${state.tab}`);
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
        $("#csvBtn2").onclick = downloadCsv;
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
  $("#tabs").onclick = (ev) => {
    const b = ev.target.closest("button[data-tab]");
    if (b) { state.tab = b.dataset.tab; render(); }
  };
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
    await refreshSyncInfo();
    render();
  })();
})();
