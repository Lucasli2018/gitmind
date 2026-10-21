// 将 schema.sql 应用到共享 dev 库（REST），并自检表是否存在。
// Token 读取 Machine 级 CLOUDFLARE_API_TOKEN；本地也可 export 同名环境变量。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCOUNT_ID = "332b848d9f5d9ec2808bdb855763eb8e";
const DATABASE_ID = "3c83aee3-4645-450b-b50b-6488750deeb4";

function getToken() {
  try {
    const t = execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Machine')",
    ]).toString().trim();
    if (t) return t;
  } catch (_) {}
  return process.env.CLOUDFLARE_API_TOKEN || "";
}

const token = getToken();
if (!token) {
  console.error("缺少 CLOUDFLARE_API_TOKEN（Machine 环境变量或 export）");
  process.exit(1);
}

const sql = readFileSync(join(__dirname, "..", "schema.sql"), "utf8");
const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function run() {
  for (const stmt of stmts) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: stmt }),
    });
    const j = await res.json();
    if (!j.success) {
      console.error("语句失败:", stmt.slice(0, 60), "\n", JSON.stringify(j.errors));
      process.exit(1);
    }
    console.log("OK:", stmt.slice(0, 50));
  }
  const check = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'gm_%'",
    }),
  });
  const cj = await check.json();
  const names = (cj.result && cj.result[0] && cj.result[0].results.map((r) => r.name)) || [];
  console.log("现有 gm_ 表:", names.join(", "));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
