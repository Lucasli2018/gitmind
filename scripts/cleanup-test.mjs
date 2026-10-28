// 清理测试账号与测试导图（仅用于开发期清理共享 dev 库；生产勿用）
// 配置读环境变量 / 项目根 .env（见 scripts/config.mjs）。
import { CF_API_TOKEN, CF_ACCOUNT_ID, D1_DATABASE_ID } from "./config.mjs";
const ACCOUNT_ID = CF_ACCOUNT_ID();
const DATABASE_ID = D1_DATABASE_ID();
const token = CF_API_TOKEN();
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
