// BYOK-only activation. No platform APIs or credentials in application runtime.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account)
  throw new Error(
    "Configure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID securely before activation.",
  );
async function cf(path, method = "GET", data) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new Error(
      `Cloudflare activation failed (HTTP ${response.status}, codes: ${(result.errors ?? []).map((e) => e.code).join(",")}). No other database has been modified.`,
    );
  return result.result;
}
const databases = await cf("/d1/database?per_page=100");
let database = databases.find((d) => d.name === "jarvish-production");
if (!database)
  database = await cf("/d1/database", "POST", { name: "jarvish-production" });
if (!/^[0-9a-f-]{36}$/.test(database.uuid ?? ""))
  throw new Error("Cloudflare did not return a real database UUID; stopped.");
const config = JSON.parse(
  readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""),
);
config.d1_databases = [
  {
    binding: "DB",
    database_name: "jarvish-production",
    database_id: database.uuid,
    migrations_dir: "database/migrations",
  },
];
writeFileSync("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0)
    throw new Error(`${command} failed; activation stopped.`);
}
run("npx", [
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "jarvish-production",
  "--remote",
]);
run("npm", ["run", "deploy"]);
const project = await cf("/pages/projects/jarvish");
const origin = `https://${project.subdomain}`;
const health = await fetch(origin + "/health");
if (!health.ok || !(await health.json()).ok)
  throw new Error(
    `Deployment exists but D1 health is not ready at ${origin}; not claiming functional runtime.`,
  );
console.log(
  `Dedicated Jarvish D1 and production health verified at ${origin}. Configure GROQ_API_KEY in Pages secrets to enable live AI.`,
);
