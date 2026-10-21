// GET    /api/maps/:id  -> 获取（ owner 或 is_public 可读）
// PUT    /api/maps/:id  { title?, data?, is_public? } -> 更新（仅 owner）
// DELETE /api/maps/:id  -> 删除（仅 owner）
import { json, parseUser } from "./_shared.js";

export async function onRequestGet({ request, env, params }) {
  const row = await env.DB.prepare("SELECT * FROM gm_maps WHERE id=?").bind(params.id).first();
  if (!row) return json({ error: "导图不存在" }, 404);
  const u = await parseUser(env, request);
  if (row.user_id !== (u && u.id) && !row.is_public) return json({ error: "无权访问" }, 403);
  let data = {};
  try { data = JSON.parse(row.data || "{}"); } catch (_) {}
  return json({
    map: {
      id: row.id, title: row.title, type: row.type, data,
      is_public: row.is_public, created_at: row.created_at, updated_at: row.updated_at,
      owner: !!(u && u.id === row.user_id),
    },
  });
}

export async function onRequestPut({ request, env, params }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const row = await env.DB.prepare("SELECT user_id FROM gm_maps WHERE id=?").bind(params.id).first();
  if (!row) return json({ error: "导图不存在" }, 404);
  if (row.user_id !== u.id) return json({ error: "无权修改" }, 403);

  const body = await request.json().catch(() => ({}));
  const sets = [];
  const binds = [];
  if (typeof body.title === "string") { sets.push("title=?"); binds.push(body.title.toString().slice(0, 80)); }
  if (body.data !== undefined) { sets.push("data=?"); binds.push(JSON.stringify(body.data)); }
  if (typeof body.is_public === "boolean") { sets.push("is_public=?"); binds.push(body.is_public ? 1 : 0); }
  if (sets.length === 0) return json({ ok: true });
  sets.push("updated_at=?");
  binds.push(Date.now());
  binds.push(params.id);
  await env.DB.prepare(`UPDATE gm_maps SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  return json({ ok: true, updated_at: Date.now() });
}

export async function onRequestDelete({ request, env, params }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const row = await env.DB.prepare("SELECT user_id FROM gm_maps WHERE id=?").bind(params.id).first();
  if (!row) return json({ error: "导图不存在" }, 404);
  if (row.user_id !== u.id) return json({ error: "无权删除" }, 403);
  await env.DB.prepare("DELETE FROM gm_maps WHERE id=?").bind(params.id).run();
  return json({ ok: true });
}
