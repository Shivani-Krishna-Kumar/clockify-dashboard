// Minimal read-only Clockify REST client (GET only).
const cfg = require("./config");

const BASE = "https://api.clockify.me/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params = {}, attempt = 0) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { "X-Api-Key": cfg.apiKey } });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(500 * 2 ** attempt);
    return get(path, params, attempt + 1);
  }
  if (!res.ok) {
    const err = new Error(`Clockify ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function paged(path, params = {}, pageSize = 500) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await get(path, { ...params, page, "page-size": pageSize });
    all.push(...batch);
    if (batch.length < pageSize) return all;
  }
}

const ws = () => `/workspaces/${cfg.workspaceId}`;

module.exports = {
  get,
  currentUser: () => get("/user"),
  listWorkspaces: () => get("/workspaces"),
  listUsers: () => paged(`${ws()}/users`, { status: "ACTIVE" }),
  listProjects: () => paged(`${ws()}/projects`),
  listEntries: (userId, startIso, endIso) =>
    paged(`${ws()}/user/${userId}/time-entries`, { start: startIso, end: endIso, hydrated: true }),
};
