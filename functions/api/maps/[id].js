// GET    /api/maps/:id  -> 获取（ owner 或 is_public 可读）
// PUT    /api/maps/:id  { title?, data?, is_public? } -> 更新（仅 owner）
// DELETE /api/maps/:id  -> 删除（仅 owner）
import { json, parseUser } from "../_shared.js";
import { getMapData, putMapData, deleteMapData } from "../_store.js";
import { normalizeDoc } from "../_convert.js";

export async function onRequestGet({ request, env, params }) {
  const row = await env.DB.prepare("SELECT * FROM gm_maps WHERE id=?").bind(params.id).first();
  if (!row) return json({ error: "导图不存在" }, 404);
  const u = await parseUser(env, request);
  if (row.user_id !== (u && u.id) && !row.is_public) return json({ error: "无权访问" }, 403);
  let data = {};
  const raw = await getMapData(env, params.id, row.r2_key);
  try { data = JSON.parse(raw || "{}"); } catch (_) {}
  // 兼容层：simple-mind-map 格式（R2 早期快照）自动转换为原生格式，并回写主存储自愈
  const norm = normalizeDoc(data);
  if (norm.converted) {
    data = norm.doc;
    try {
      await putMapData(env, params.id, JSON.stringify(data), row.user_id);
    } catch (e) {
      console.error("[map] 转换后回写失败(忽略):", e?.message || e);
    }
  }
  return json({
    map: {
      id: row.id, title: row.title, type: row.type, data,
      is_public: row.is_public, created_at: row.created_at, updated_at: row.updated_at,
      size: row.size > 0 ? row.size : null,
      owner: !!(u && u.id === row.user_id),
    },
  });
}

export async function onRequestPut({ request, env, params }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const row = await env.DB.prepare("SELECT user_id, r2_key FROM gm_maps WHERE id=?").bind(params.id).first();
  if (!row) return json({ error: "导图不存在" }, 404);
  if (row.user_id !== u.id) return json({ error: "无权修改" }, 403);

  const body = await request.json().catch(() => ({}));
  const sets = [];
  const binds = [];
  if (typeof body.title === "string") { sets.push("title=?"); binds.push(body.title.toString().slice(0, 80)); }
  if (typeof body.is_public === "boolean") { sets.push("is_public=?"); binds.push(body.is_public ? 1 : 0); }
  if (sets.length > 0) {
    sets.push("updated_at=?");
    binds.push(Date.now());
    binds.push(params.id);
    await env.DB.prepare(`UPDATE gm_maps SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  }
  // 内容优先写 R2（R2 不可用时自动兜底 D1 data 列）
  if (body.data !== undefined) {
    await putMapData(env, params.id, JSON.stringify(body.data), row.user_id);
    // 仅更新内容时也要刷新 updated_at，保证列表排序正确
    if (sets.length === 0) {
      await env.DB.prepare("UPDATE gm_maps SET updated_at=? WHERE id=?").bind(Date.now(), params.id).run();
    }
  }
  return json({ ok: true, updated_at: Date.now() });
}

export async function onRequestDelete({ request, env, params }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const row = await env.DB.prepare("SELECT user_id, r2_key FROM gm_maps WHERE id=?").bind(params.id).first();
  if (!row) return json({ error: "导图不存在" }, 404);
  if (row.user_id !== u.id) return json({ error: "无权删除" }, 403);
  await env.DB.prepare("DELETE FROM gm_maps WHERE id=?").bind(params.id).run();
  await deleteMapData(env, params.id, row.r2_key);
  return json({ ok: true });
}
