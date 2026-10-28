// 部署到 Cloudflare Pages（非交互：配置读环境变量 / 项目根 .env，见 scripts/config.mjs）
import { execFileSync } from "node:child_process";
import { CF_API_TOKEN, CF_ACCOUNT_ID, wranglerCommand } from "./config.mjs";

const env = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: CF_API_TOKEN(),
  CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT_ID(),
};

console.log("确保 Pages 项目存在 …");
try {
  const c0 = wranglerCommand(["pages", "project", "create", "gitmind", "--production-branch", "main"]);
  execFileSync(c0.cmd, c0.args, { cwd: process.cwd(), env, stdio: "inherit", shell: c0.shell });
} catch (_) { console.log("（项目可能已存在，忽略）"); }

console.log("开始部署 gitmind 到 Cloudflare Pages …");
const c = wranglerCommand(["pages", "deploy", ".", "--project-name", "gitmind", "--commit-dirty=true"]);
try {
  execFileSync(c.cmd, c.args, { cwd: process.cwd(), env, stdio: "inherit", shell: c.shell });
} catch (e) {
  console.error("部署失败：", e.message);
  process.exit(1);
}
