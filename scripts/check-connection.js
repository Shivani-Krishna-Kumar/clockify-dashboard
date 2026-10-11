// Step 1 of setup: verifies the API key can see every user and read OTHER users' entries
// (i.e. the key really belongs to a workspace admin). Run: npm run check
const cfg = require("../src/config");
const clockify = require("../src/clockify");

async function main() {
  if (!cfg.apiKey || cfg.apiKey.startsWith("PASTE_")) {
    throw new Error("Set CLOCKIFY_API_KEY in .env first (copy .env.example to .env).");
  }
  const me = await clockify.currentUser();
  console.log(`Key belongs to: ${me.name} <${me.email}>`);

  if (!cfg.workspaceId) {
    console.log("WORKSPACE_ID is empty. Workspaces this key can see:");
    for (const w of await clockify.listWorkspaces()) console.log(`  ${w.id}  ${w.name}`);
    return;
  }

  const users = await clockify.listUsers();
  console.log(`Active users in workspace: ${users.length}`);
  users.forEach((u) => console.log(`  - ${u.name} <${u.email}>`));

  const projects = await clockify.listProjects();
  console.log(`Projects: ${projects.length} (${projects.filter((p) => p.archived).length} archived)`);

  const other = users.find((u) => u.id !== me.id);
  if (!other) return console.log("Only one user in the workspace - nothing more to test.");
  const start = new Date(Date.now() - 7 * 86400e3).toISOString();
  try {
    const entries = await clockify.listEntries(other.id, start, new Date().toISOString());
    console.log(`\nOK: read ${entries.length} entries for ${other.name} in the last 7 days.`);
    console.log("The key has the access the dashboard needs.");
  } catch (err) {
    console.log(`\nFAILED reading another user's entries: ${err.message}`);
    console.log("This key is probably not a workspace admin/owner. Use an admin's API key.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Connection check failed:", err.message);
  process.exit(1);
});
