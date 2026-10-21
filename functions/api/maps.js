// GET /api/maps  -> 当前用户的所有导图（列表）
// POST /api/maps  { title, type, data } -> 新建导图
import { json, parseUser } from "./_shared.js";
import { putMapData } from "./_store.js";

export async function onRequestGet({ request, env }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const rows = await env.DB.prepare(
    "SELECT id,title,type,is_public,created_at,updated_at FROM gm_maps WHERE user_id=? ORDER BY updated_at DESC"
  ).bind(u.id).all();
  return json({ maps: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const body = await request.json().catch(() => ({}));
  const title = (body.title || "未命名导图").toString().slice(0, 80);
  const type = ["mindmap", "flowchart", "whiteboard"].includes(body.type) ? body.type : "mindmap";
  const id = crypto.randomUUID();
  const now = Date.now();
  const data = body.data ? JSON.stringify(body.data) : "{}";
  // 元数据入库（storage 默认 d1，内容由 putMapData 决定主存储位并双写兜底）
  await env.DB.prepare(
    "INSERT INTO gm_maps(id,user_id,title,type,data,is_public,storage,created_at,updated_at) VALUES(?,?,?,?,?,0,'d1',?,?)"
  ).bind(id, u.id, title, type, data, now, now).run();
  // 内容优先写 R2（R2 不可用时自动兜底 D1）
  await putMapData(env, id, data);
  return json({ map: { id, title, type, is_public: 0, created_at: now, updated_at: now } });
}
