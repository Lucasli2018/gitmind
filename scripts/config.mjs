// 部署 / 迁移脚本统一配置入口：环境变量优先，其次项目根 .env（已 gitignore）。
// 目标：源码中零硬编码账号 ID / 数据库 ID / 机器路径 / Token，跨机器可复用。
// .env 模板见 .env.example：
//   CLOUDFLARE_API_TOKEN=   # CF API Token（需 D1 Edit + R2 Edit + Pages Edit 权限）
//   CLOUDFLARE_ACCOUNT_ID=  # CF 账号 ID
//   D1_DATABASE_ID=         # 共享 dev 库 ID
//   R2_BUCKET=gitmind       # 可选，R2 桶名（默认 gitmind）
//   WRANGLER_BIN=           # 可选，wrangler 入口（.js 用 node 执行；否则走 PATH 上的 wrangler）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 极简 .env 加载（KEY=VALUE，支持 # 注释与引号包裹；已存在的环境变量优先，不覆盖）
try {
  for (const raw of readFileSync(join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined || process.env[m[1]] === "") {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
} catch (_) { /* 无 .env 时忽略，仅依赖环境变量 */ }

export function env(key, def = "") {
  const v = process.env[key];
  return v === undefined || v === "" ? def : v;
}

// 必填配置：缺失时报错并退出（给出修复提示）
export function requireEnv(key, hint = "") {
  const v = env(key);
  if (!v) {
    console.error(`缺少配置 ${key}${hint ? "（" + hint + "）" : ""}。请在项目根创建 .env（参考 .env.example）或 export 环境变量。`);
    process.exit(1);
  }
  return v;
}

export const CF_API_TOKEN = () => requireEnv("CLOUDFLARE_API_TOKEN", "Cloudflare API Token");
export const CF_ACCOUNT_ID = () => requireEnv("CLOUDFLARE_ACCOUNT_ID", "Cloudflare 账号 ID");
export const D1_DATABASE_ID = () => requireEnv("D1_DATABASE_ID", "D1 数据库 ID");
export const R2_BUCKET = () => env("R2_BUCKET", "gitmind");

// 解析 wrangler 调用方式：
// - WRANGLER_BIN 指向 wrangler.js -> 用当前 node 执行（无需依赖 PATH）
// - WRANGLER_BIN 指向可执行文件  -> 直接执行
// - 未配置                       -> 走 PATH 上的 wrangler（shell:true 兼容 Windows 的 wrangler.cmd）
export function wranglerCommand(args) {
  const bin = env("WRANGLER_BIN");
  if (bin && bin.endsWith(".js")) return { cmd: process.execPath, args: [bin, ...args], shell: false };
  if (bin) return { cmd: bin, args, shell: false };
  return { cmd: "wrangler", args, shell: true };
}
