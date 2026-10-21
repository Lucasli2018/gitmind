// POST /api/logout -> 清除会话
import { json, clearCookie } from "./_shared.js";

export async function onRequestPost({ request, env }) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)gm_sid=([^;]+)/);
  if (m) {
    const token = decodeURIComponent(m[1]);
    await env.DB.prepare("DELETE FROM gm_sessions WHERE token=?").bind(token).run();
  }
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}
