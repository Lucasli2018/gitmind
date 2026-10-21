// PUT /api/maps/:id/share  { is_public } -> 切换公开/私有（仅 owner）
import { json, parseUser } from "./_shared.js";

export async function onRequestPut({ request, env, params }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const row = await env.DB.prepare("SELECT user_id FROM gm_maps WHERE id=?").bind(params.id).first();
  if (!row) return json({ error: "导图不存在" }, 404);
  if (row.user_id !== u.id) return json({ error: "无权操作" }, 403);
  const body = await request.json().catch(() => ({}));
  const pub = body.is_public ? 1 : 0;
  await env.DB.prepare("UPDATE gm_maps SET is_public=?, updated_at=? WHERE id=?")
    .bind(pub, Date.now(), params.id).run();
  return json({ ok: true, is_public: pub });
}
