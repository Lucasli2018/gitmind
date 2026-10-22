// 一次性修复：把 R2 桶 gitmind 中 maps/ 前缀下存量对象的 Content-Type
// 刷成 application/json; charset=utf-8（旧对象写入时未带类型，控制台显示 --）。
// 幂等：已是目标类型（含 charset）的对象自动跳过。Token 读 Machine 级 CLOUDFLARE_API_TOKEN。
import { execFileSync } from "node:child_process";

const ACCOUNT_ID = "332b848d9f5d9ec2808bdb855763eb8e";
const BUCKET = "gitmind";
const TARGET_TYPE = "application/json; charset=utf-8";
const PREFIX = "maps/";

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
const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}`;
let cursor = "";

// 列出对象（分页；list 接口的 prefix 参数实测不生效，改客户端过滤）
async function listObjects() {
  const out = [];
  for (;;) {
    const url = `${base}/objects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json();
    if (!j.success) throw new Error(`列取失败: ${JSON.stringify(j.errors)}`);
    // result 可能是对象数组，也可能是 { objects: [...] }（API 版本差异）
    const raw = Array.isArray(j.result) ? j.result : (j.result && j.result.objects) || [];
    out.push(...raw.filter((o) => o.key && o.key.startsWith(PREFIX)));
    const ri = j.result_info;
    if (ri && ri.truncated && ri.cursor) { cursor = ri.cursor; continue; }
    break;
  }
  return out;
}

async function getObject(key) {
  const res = await fetch(`${base}/objects/${key.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${key} -> ${res.status}`);
  return { body: await res.arrayBuffer(), type: res.headers.get("content-type") || "" };
}

async function putObject(key, body) {
  const res = await fetch(`${base}/objects/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": TARGET_TYPE },
    body: body,
  });
  const j = await res.json().catch(() => ({}));
  if (!j.success) throw new Error(`PUT ${key} 失败: ${JSON.stringify(j.errors || res.status)}`);
}

async function run() {
  const objs = await listObjects();
  console.log(`共 ${objs.length} 个对象（客户端过滤 prefix=${PREFIX}）`);
  let fixed = 0, skipped = 0, failed = 0;
  for (const o of objs) {
    try {
      const { body, type } = await getObject(o.key);
      if (type && type.toLowerCase().replace(/\s/g, "") === TARGET_TYPE.toLowerCase().replace(/\s/g, "")) {
        skipped++;
        console.log(`SKIP ${o.key} (${type})`);
        continue;
      }
      await putObject(o.key, body);
      fixed++;
      console.log(`FIXED ${o.key}: "${type || "(无)"}" -> "${TARGET_TYPE}"`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${o.key}: ${e.message || e}`);
    }
  }
  console.log(`\n完成：修复 ${fixed}，跳过 ${skipped}，失败 ${failed}`);
  if (failed > 0) process.exit(2);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
