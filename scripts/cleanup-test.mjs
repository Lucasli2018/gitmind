// 清理测试账号与测试导图（仅用于开发期清理共享 dev 库；生产勿用）
import { execFileSync } from "node:child_process";
const ACCOUNT_ID = "332b848d9f5d9ec2808bdb855763eb8e";
const DATABASE_ID = "3c83aee3-4645-450b-b50b-6488750deeb4";
function getToken() {
  try { return execFileSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Machine')"]).toString().trim(); } catch (_) { return ""; }
}
const token = getToken();
if (!token) { console.error("缺少 Token"); process.exit(1); }
const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
const stmts = [
  "DELETE FROM gm_maps WHERE user_id = (SELECT id FROM gm_users WHERE email='test@mindflow.dev')",
  "DELETE FROM gm_sessions WHERE user_id = (SELECT id FROM gm_users WHERE email='test@mindflow.dev')",
  "DELETE FROM gm_users WHERE email='test@mindflow.dev'",
];
for (const sql of stmts) {
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql }) });
  const j = await r.json();
  if (!j.success) console.error("失败:", sql, JSON.stringify(j.errors)); else console.log("OK:", sql);
}
