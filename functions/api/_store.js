// 导图内容存储抽象：优先 R2 对象存储，D1 只存元数据兜底。
// 写入：R2 成功 -> storage='r2'、r2_key 记录对象键、data 置 NULL（内容不再冗余存 D1）；
//       R2 失败 -> storage='d1'、r2_key 置空、内容完整写入 data 列兜底。
// 读取：按行内 r2_key 优先读 R2 -> 旧格式 key 兼容 -> D1 data 列兜底，保证零数据丢失。
const LEGACY_R2_KEY = (id) => `maps/${id}.json`;            // 旧格式（无 user 段），兼容存量对象
const R2_KEY = (userId, id) => `maps/${userId}/${id}.json`; // 新格式：按用户分段

// UTF-8 字节数（用于列表页展示文件大小）
function byteLen(str) {
  try { return new TextEncoder().encode(str || "").length; }
  catch (_) { return (str || "").length; }
}

// 写入内容。userId 用于生成新版 R2 key（maps/<userId>/<id>.json）。
// 返回主存储位置 'r2' | 'd1'。
export async function putMapData(env, id, dataStr, userId) {
  let r2ok = false;
  let r2key = null;
  if (env.R2) {
    try {
      r2key = userId ? R2_KEY(userId, id) : LEGACY_R2_KEY(id);
      // ⚠️ Workers R2 put 不支持 Blob 式的 { type } 选项（会被静默忽略导致对象无类型、被当作 text/plain），
      // 必须用 httpMetadata.contentType 才能真正写入 application/json; charset=utf-8
      await env.R2.put(r2key, dataStr, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
      r2ok = true;
    } catch (e) {
      console.error("[store] R2 写入失败，已回退 D1 兜底:", e?.message || e);
      r2ok = false; r2key = null;
    }
  }
  // 旧库 data 列可能仍是 NOT NULL（未跑重建迁移），置 NULL 失败时降级为空串
  const size = byteLen(dataStr);
  try {
    await env.DB.prepare("UPDATE gm_maps SET data=?, storage=?, r2_key=?, size=? WHERE id=?")
      .bind(r2ok ? null : dataStr, r2ok ? "r2" : "d1", r2key, size, id).run();
  } catch (e) {
    await env.DB.prepare("UPDATE gm_maps SET data=?, storage=?, r2_key=?, size=? WHERE id=?")
      .bind(r2ok ? "" : dataStr, r2ok ? "r2" : "d1", r2key, size, id).run();
  }
  return r2ok ? "r2" : "d1";
}

// 读取内容：r2_key（行内记录）-> 旧格式 key -> D1 data 列。返回字符串或 null。
export async function getMapData(env, id, r2Key) {
  const keys = [...new Set([r2Key, LEGACY_R2_KEY(id)].filter(Boolean))];
  if (env.R2) {
    for (const key of keys) {
      try {
        const obj = await env.R2.get(key);
        if (obj) return await obj.text();
      } catch (e) {
        console.error("[store] R2 读取失败，尝试下一来源:", key, e?.message || e);
      }
    }
  }
  const row = await env.DB.prepare("SELECT data FROM gm_maps WHERE id=?").bind(id).first();
  return row ? row.data : null;
}

// 删除 R2 对象：行内 r2_key 与旧格式 key 都尝试，避免残留。R2 缺失 / 失败仅记录。
export async function deleteMapData(env, id, r2Key) {
  if (!env.R2) return;
  for (const key of [...new Set([r2Key, LEGACY_R2_KEY(id)].filter(Boolean))]) {
    try {
      await env.R2.delete(key);
    } catch (e) {
      console.error("[store] R2 删除失败(忽略):", key, e?.message || e);
    }
  }
}
