// 将 schema.sql 应用到共享 dev 库（REST），并自检表是否存在。
// 配置读环境变量 / 项目根 .env（见 scripts/config.mjs）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CF_API_TOKEN, CF_ACCOUNT_ID, D1_DATABASE_ID } from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const token = CF_API_TOKEN();
const ACCOUNT_ID = CF_ACCOUNT_ID();
const DATABASE_ID = D1_DATABASE_ID();

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
