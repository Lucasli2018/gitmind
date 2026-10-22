// 增量迁移：gm_maps 加 r2_key 列；data 列改为可 NULL（必要时重建表）；
// 存量 storage='r2' 的行回填 r2_key（旧格式 maps/<id>.json）并清空 data 冗余。
// 幂等：可重复执行。Token 读取 Machine 级 CLOUDFLARE_API_TOKEN。
import { execFileSync } from "node:child_process";

const ACCOUNT_ID = "332b848d9f5d9ec2808bdb855763eb8e";
const DATABASE_ID = "3c83aee3-4645-450b-b50b-6488750deeb4";

function getToken() {
  try {
    const t = execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Machine')",
    ]).toString().trim();
    if (t) return t;
  } catch (_) {}
  return process.env.CLOUDFLARE_API_TOKEN || "";
}

const token = getToken();
if (!token) { console.error("缺少 CLOUDFLARE_API_TOKEN"); process.exit(1); }

const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;

async function q(sql) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const j = await res.json();
  if (!j.success) throw new Error("SQL 失败: " + sql.slice(0, 80) + "\n" + JSON.stringify(j.errors));
  return j.result[0];
}

async function run() {
  // 0) 前置检查：表存在
  let cols = (await q("PRAGMA table_info(gm_maps)")).results || [];
  if (cols.length === 0) { console.log("gm_maps 不存在，跳过（首次部署由 middleware 建表）"); return; }
  const names = cols.map((c) => c.name);

  // 1) 补列：storage / r2_key / size（可缺任何一列，逐个幂等补齐）
  if (!names.includes("storage")) {
    await q("ALTER TABLE gm_maps ADD COLUMN storage TEXT NOT NULL DEFAULT 'd1'");
    console.log("OK: 已加 storage 列");
  } else {
    console.log("SKIP: storage 已存在");
  }
  if (!names.includes("r2_key")) {
    await q("ALTER TABLE gm_maps ADD COLUMN r2_key TEXT");
    console.log("OK: 已加 r2_key 列");
  } else {
    console.log("SKIP: r2_key 已存在");
  }
  if (!names.includes("size")) {
    await q("ALTER TABLE gm_maps ADD COLUMN size INTEGER NOT NULL DEFAULT 0");
    console.log("OK: 已加 size 列");
  } else {
    console.log("SKIP: size 已存在");
  }

  // 2) data 列若为 NOT NULL 则重建表放开约束
  cols = (await q("PRAGMA table_info(gm_maps)")).results;
  const dataCol = cols.find((c) => c.name === "data");
  if (dataCol && dataCol.notnull === 1) {
    console.log("RUN: data 列为 NOT NULL，重建表…");
    await q("DROP TABLE IF EXISTS gm_maps_new"); // 清理上次失败残留
    await q(
      "CREATE TABLE gm_maps_new (" +
      " id TEXT PRIMARY KEY," +
      " user_id INTEGER NOT NULL," +
      " title TEXT NOT NULL DEFAULT '未命名导图'," +
      " type TEXT NOT NULL DEFAULT 'mindmap'," +
      " data TEXT," +
      " is_public INTEGER NOT NULL DEFAULT 0," +
      " storage TEXT NOT NULL DEFAULT 'd1'," +
      " r2_key TEXT," +
      " size INTEGER NOT NULL DEFAULT 0," +
      " created_at INTEGER NOT NULL," +
      " updated_at INTEGER NOT NULL)"
    );
    await q(
      "INSERT INTO gm_maps_new(id,user_id,title,type,data,is_public,storage,r2_key,size,created_at,updated_at)" +
      " SELECT id,user_id,title,type,data,is_public,storage,r2_key,size,created_at,updated_at FROM gm_maps"
    );
    await q("DROP TABLE gm_maps");
    await q("ALTER TABLE gm_maps_new RENAME TO gm_maps");
    await q("CREATE INDEX IF NOT EXISTS gm_idx_maps_user ON gm_maps(user_id)");
    await q("CREATE INDEX IF NOT EXISTS gm_idx_maps_public ON gm_maps(is_public)");
    console.log("OK: 表已重建，data 可 NULL，索引已恢复");
  } else {
    console.log("SKIP: data 列已可 NULL");
  }

  // 3) 存量 r2 行回填 r2_key（旧格式 key，对象确实存放在此）
  const bf = await q("UPDATE gm_maps SET r2_key='maps/'||id||'.json' WHERE storage='r2' AND r2_key IS NULL");
  console.log("OK: 回填 r2_key " + (bf.changes ?? 0) + " 行（旧格式 maps/<id>.json）");

  // 4) 已确认存 R2 的行清掉 data 冗余（dev 库若尚未真正写入 R2，此步自然 0 行）
  const cl = await q("UPDATE gm_maps SET data=NULL WHERE storage='r2' AND r2_key IS NOT NULL AND data IS NOT NULL");
  console.log("OK: 清空 data 冗余 " + (cl.changes ?? 0) + " 行");

  // 4.5) 存量行回填 size（仅 d1 行；R2 行的 size 由 putMapData 写入时维护）
  const sb = await q("UPDATE gm_maps SET size=LENGTH(CAST(data AS BLOB)) WHERE size=0 AND data IS NOT NULL");
  console.log("OK: 回填 size " + (sb.changes ?? 0) + " 行");

  // 5) 验证
  const v = (await q("PRAGMA table_info(gm_maps)")).results
    .map((c) => c.name + ":" + c.type + (c.notnull ? "(NN)" : ""));
  console.log("结构:", v.join(" | "));
  const sample = (await q("SELECT id,title,storage,r2_key,data,size FROM gm_maps LIMIT 5")).results;
  console.log("样例:", JSON.stringify(sample, null, 1));
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
