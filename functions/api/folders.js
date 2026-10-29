// GET  /api/folders        -> 当前用户的所有文件夹（扁平列表，含 parent_id，前端自行建树）
// POST /api/folders        { name, parent_id? } -> 新建文件夹（parent_id 须属于本人，否则视为根级）
import { json, parseUser } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const rows = await env.DB.prepare(
    "SELECT id,name,parent_id,created_at,updated_at FROM gm_folders WHERE user_id=? ORDER BY updated_at DESC"
  ).bind(u.id).all();
  return json({ folders: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const body = await request.json().catch(() => ({}));
  const name = (body.name || "未命名文件夹").toString().trim().slice(0, 60) || "未命名文件夹";
  const now = Date.now();
  // parent_id 校验：必须属于本人，否则忽略（落到根级）
  let parentId = null;
  if (body.parent_id) {
    const p = await env.DB.prepare("SELECT id FROM gm_folders WHERE id=? AND user_id=?")
      .bind(body.parent_id, u.id).first();
    if (p) parentId = p.id;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO gm_folders(id,user_id,name,parent_id,created_at,updated_at) VALUES(?,?,?,?,?,?)"
  ).bind(id, u.id, name, parentId, now, now).run();
  return json({ folder: { id, name, parent_id: parentId, created_at: now, updated_at: now } });
}
