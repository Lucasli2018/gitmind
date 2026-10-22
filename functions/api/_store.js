// 导图内容存储抽象：优先 R2 对象存储，D1 始终双写兜底，读取优先 R2、异常回退 D1。
// 设计目标：满足「数据优先存 R2，R2 不可用才用 D1」——R2 绑定缺失 / 写入 403 / 网络异常时，
// 自动降级到 D1 的 gm_maps.data 列，保证零数据丢失。
const R2_KEY = (id) => `maps/${id}.json`;

// UTF-8 字节数（用于列表页展示文件大小）
function byteLen(str) {
  try { return new TextEncoder().encode(str || "").length; }
  catch (_) { return (str || "").length; }
}

// 写入：R2 优先（成功则标记 storage='r2'），无论 R2 是否成功都双写 D1 data 列作兜底。
// 返回主存储位置 'r2' | 'd1'。
export async function putMapData(env, id, dataStr) {
  let r2ok = false;
  if (env.R2) {
    try {
      await env.R2.put(R2_KEY(id), dataStr, { type: "application/json" });
      r2ok = true;
    } catch (e) {
      console.error("[store] R2 写入失败，已回退 D1 兜底:", e?.message || e);
    }
  }
  await env.DB.prepare("UPDATE gm_maps SET data=?, storage=?, size=? WHERE id=?")
    .bind(dataStr, r2ok ? "r2" : "d1", byteLen(dataStr), id).run();
  return r2ok ? "r2" : "d1";
}

// 读取：优先 R2 对象；R2 缺失 / 抛错 / 对象不存在则回退 D1 data 列。
// 返回内容字符串或 null。
export async function getMapData(env, id) {
  if (env.R2) {
    try {
      const obj = await env.R2.get(R2_KEY(id));
      if (obj) return await obj.text();
    } catch (e) {
      console.error("[store] R2 读取失败，回退 D1:", e?.message || e);
    }
  }
  const row = await env.DB.prepare("SELECT data FROM gm_maps WHERE id=?").bind(id).first();
  return row ? row.data : null;
}

// 删除 R2 对象（D1 整行由调用方负责删除）。R2 缺失 / 失败仅记录，不影响主流程。
export async function deleteMapData(env, id) {
  if (!env.R2) return;
  try {
    await env.R2.delete(R2_KEY(id));
  } catch (e) {
    console.error("[store] R2 删除失败(忽略):", e?.message || e);
  }
}
