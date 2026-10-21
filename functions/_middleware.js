// 全局中间件：幂等确保 gm_ 表存在（共享 dev 库，不影响其它项目表）
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS gm_users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT UNIQUE NOT NULL,
     pass_hash TEXT NOT NULL,
     pass_salt TEXT NOT NULL,
     nickname TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS gm_sessions (
     token TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     exp INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS gm_maps (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     title TEXT NOT NULL DEFAULT '未命名导图',
     type TEXT NOT NULL DEFAULT 'mindmap',
     data TEXT NOT NULL DEFAULT '{}',
     is_public INTEGER NOT NULL DEFAULT 0,
     storage TEXT NOT NULL DEFAULT 'd1',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS gm_idx_sessions_user ON gm_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS gm_idx_maps_user ON gm_maps(user_id)`,
  `CREATE INDEX IF NOT EXISTS gm_idx_maps_public ON gm_maps(is_public)`,
];

let ready = false;
let busy = false;

async function ensure(env) {
  if (ready || busy) return;
  busy = true;
  try {
    const r = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='gm_users'"
    ).first();
    if (!r) {
      for (const sql of SCHEMA) await env.DB.prepare(sql).run();
      console.log("[middleware] 已初始化 gm_ 表");
    } else {
      // 兼容已部署库：补 storage 列（R2 优先存储标记）
      try {
        const cols = await env.DB.prepare("PRAGMA table_info(gm_maps)").all();
        const hasStorage = (cols.results || []).some((c) => c.name === "storage");
        if (!hasStorage) {
          await env.DB.prepare(
            "ALTER TABLE gm_maps ADD COLUMN storage TEXT NOT NULL DEFAULT 'd1'"
          ).run();
          console.log("[middleware] 已为 gm_maps 补 storage 列");
        }
      } catch (e) {
        console.error("[middleware] 补 storage 列失败(忽略):", e);
      }
    }
    ready = true;
  } catch (err) {
    console.error("[middleware] 建表失败:", err);
  } finally {
    busy = false;
  }
}

export async function onRequest(context) {
  await ensure(context.env);
  return context.next();
}
