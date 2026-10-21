// POST /api/register  { email, pw, nickname } -> 创建账号并登录
import { json, hashPassword, getUserByEmail, sessionCookie, newToken } from "./_shared.js";

export async function onRequestPost({ request, env }) {
  const { email, pw, nickname } = await request.json().catch(() => ({}));
  const em = (email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json({ error: "邮箱格式不正确" }, 400);
  if (!pw || pw.length < 6) return json({ error: "密码至少 6 位" }, 400);
  if (await getUserByEmail(env.DB, em)) return json({ error: "该邮箱已注册" }, 409);

  const { salt, hash } = await hashPassword(pw);
  const now = Date.now();
  const nick = (nickname || em.split("@")[0] || "用户").trim().slice(0, 24);
  const info = await env.DB.prepare(
    "INSERT INTO gm_users(email,pass_hash,pass_salt,nickname,created_at) VALUES(?,?,?,?,?)"
  ).bind(em, hash, salt, nick, now).run();
  const userId = info.meta?.last_row_id ?? info.lastRowId;

  const token = newToken();
  await env.DB.prepare("INSERT INTO gm_sessions(token,user_id,exp,created_at) VALUES(?,?,?,?)")
    .bind(token, userId, now + 1000 * 60 * 60 * 24 * 30, now).run();

  return json({ user: { id: userId, email: em, nickname: nick } }, 200, { "set-cookie": sessionCookie(token) });
}
