// POST /api/login  { email, pw } -> 验证并登录
import { json, getUserByEmail, verifyPassword, sessionCookie, newToken } from "./_shared.js";

export async function onRequestPost({ request, env }) {
  const { email, pw } = await request.json().catch(() => ({}));
  const em = (email || "").trim().toLowerCase();
  const u = await getUserByEmail(env.DB, em);
  if (!u) return json({ error: "邮箱或密码不正确" }, 401);
  if (!(await verifyPassword(pw, u.pass_salt, u.pass_hash))) return json({ error: "邮箱或密码不正确" }, 401);

  const now = Date.now();
  const token = newToken();
  await env.DB.prepare("INSERT INTO gm_sessions(token,user_id,exp,created_at) VALUES(?,?,?,?)")
    .bind(token, u.id, now + 1000 * 60 * 60 * 24 * 30, now).run();

  return json({ user: { id: u.id, email: u.email, nickname: u.nickname } }, 200, { "set-cookie": sessionCookie(token) });
}
