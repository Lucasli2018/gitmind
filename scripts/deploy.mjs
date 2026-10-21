// 部署到 Cloudflare Pages（非交互：从 Machine 环境变量读取 CF Token）
import { execFileSync } from "node:child_process";

function getToken() {
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Machine')"]).toString().trim();
  } catch (_) { return ""; }
}
const token = getToken();
if (!token) { console.error("缺少 CLOUDFLARE_API_TOKEN"); process.exit(1); }

const WRANGLER_JS = "C:/Users/hspcadmin/AppData/Roaming/npm/node_modules/wrangler/bin/wrangler.js";
const env = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: "332b848d9f5d9ec2808bdb855763eb8e",
  PATH: process.env.PATH + ":/c/Users/hspcadmin/AppData/Roaming/npm",
};
console.log("确保 Pages 项目存在 …");
try {
  execFileSync(process.execPath, [WRANGLER_JS, "pages", "project", "create", "gitmind", "--production-branch", "main"], { cwd: process.cwd(), env, stdio: "inherit" });
} catch (_) { console.log("（项目可能已存在，忽略）"); }

console.log("开始部署 gitmind 到 Cloudflare Pages …");
try {
  const out = execFileSync(process.execPath, [WRANGLER_JS, "pages", "deploy", ".", "--project-name", "gitmind", "--commit-dirty=true"], { cwd: process.cwd(), env, stdio: "inherit" });
  console.log("部署命令退出：", out ? out.toString() : "ok");
} catch (e) {
  console.error("部署失败：", e.message);
  process.exit(1);
}
