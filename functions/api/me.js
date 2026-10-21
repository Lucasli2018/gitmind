// GET /api/me -> 当前登录用户
import { json, parseUser } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  const u = await parseUser(env, request);
  if (!u) return json({ user: null }, 401);
  return json({ user: { id: u.id, email: u.email, nickname: u.nickname } });
}
