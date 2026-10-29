// PATCH /api/folders/:id  { name?, parent_id? } -> 重命名 / 移动（防环）
// DELETE /api/folders/:id -> 删除文件夹，并把其下导图与子文件夹级联上移到父级（或根级）
import { json, parseUser } from "../_shared.js";

// 返回某文件夹的全部后代 id 集合（含自身），基于用户全部文件夹列表在 JS 端建树
function collectDescendants(folders, rootId) {
  const byParent = new Map();
  for (const f of folders) {
    if (!byParent.has(f.parent_id)) byParent.set(f.parent_id, []);
    byParent.get(f.parent_id).push(f.id);
  }
  const out = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    const kids = byParent.get(cur) || [];
    for (const k of kids) {
      if (!out.has(k)) { out.add(k); stack.push(k); }
    }
  }
  return out;
}

export async function onRequestPatch({ request, env, params }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const folder = await env.DB.prepare("SELECT * FROM gm_folders WHERE id=? AND user_id=?")
    .bind(params.id, u.id).first();
  if (!folder) return json({ error: "文件夹不存在" }, 404);

  const body = await request.json().catch(() => ({}));
  const sets = [];
  const binds = [];
  const now = Date.now();

  if (typeof body.name === "string") {
    const name = body.name.toString().trim().slice(0, 60);
    if (name) { sets.push("name=?"); binds.push(name); }
  }
  if (body.parent_id !== undefined) {
    let parentId = null;
    if (body.parent_id) {
      const p = await env.DB.prepare("SELECT id FROM gm_folders WHERE id=? AND user_id=?")
        .bind(body.parent_id, u.id).first();
      if (!p) return json({ error: "目标文件夹不存在" }, 400);
      // 防环：不能移动到自身或其后代之下
      const all = await env.DB.prepare("SELECT id,parent_id FROM gm_folders WHERE user_id=?").bind(u.id).all();
      const descendants = collectDescendants(all.results || [], folder.id);
      if (descendants.has(p.id)) return json({ error: "不能移动到自身或子文件夹下" }, 400);
      parentId = p.id;
    }
    sets.push("parent_id=?");
    binds.push(parentId);
  }
  if (sets.length === 0) return json({ ok: true });
  sets.push("updated_at=?");
  binds.push(now, params.id);
  await env.DB.prepare(`UPDATE gm_folders SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  return json({ ok: true, updated_at: now });
}

export async function onRequestDelete({ request, env, params }) {
  const u = await parseUser(env, request);
  if (!u) return json({ error: "未登录" }, 401);
  const folder = await env.DB.prepare("SELECT * FROM gm_folders WHERE id=? AND user_id=?")
    .bind(params.id, u.id).first();
  if (!folder) return json({ error: "文件夹不存在" }, 404);

  const all = await env.DB.prepare("SELECT id,parent_id FROM gm_folders WHERE user_id=?").bind(u.id).all();
  const toDelete = collectDescendants(all.results || [], folder.id);
  const targetParent = folder.parent_id; // 子项上移到被删文件夹的父级（NULL=根级）
  const placeholders = toDelete.size ? Array.from(toDelete).map(() => "?").join(",") : "?";

  // 被删文件夹及其所有后代下的导图，统一上移到 targetParent（NULL 表示根级）
  await env.DB.prepare(
    `UPDATE gm_maps SET folder_id=?, updated_at=? WHERE user_id=? AND folder_id IN (${placeholders})`
  ).bind(targetParent, Date.now(), u.id, ...Array.from(toDelete)).run();
  // 删除文件夹（含后代）
  await env.DB.prepare(
    `DELETE FROM gm_folders WHERE user_id=? AND id IN (${placeholders})`
  ).bind(u.id, ...Array.from(toDelete)).run();

  return json({ ok: true, deleted: toDelete.size, reparentedTo: targetParent });
}
