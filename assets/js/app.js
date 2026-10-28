// 落地页逻辑：渲染模板墙、鉴权态导航、模板一键新建
import { Auth, createMap, toast } from "./api.js";
import { ICONS } from "./icons.js";
import { TEMPLATES } from "./templates.js";

document.getElementById("f1").innerHTML = ICONS.mindmap;
document.getElementById("f2").innerHTML = ICONS.flow;
document.getElementById("f3").innerHTML = ICONS.board;
document.getElementById("f4").innerHTML = ICONS.cloud || ICONS.share;

const navAuth = document.getElementById("navAuth");
const ctaStart = document.getElementById("ctaStart");

function renderNav(user) {
  if (user) {
    navAuth.innerHTML =
      `<a class="btn btn-ghost btn-sm" href="dashboard.html">我的导图</a>` +
      `<span class="avatar" title="${user.nickname || user.email}">${(user.nickname || user.email)[0].toUpperCase()}</span>`;
    ctaStart.textContent = "进入工作台";
    ctaStart.setAttribute("href", "dashboard.html");
  } else {
    navAuth.innerHTML =
      `<a class="btn btn-ghost btn-sm" href="login.html">登录</a>` +
      `<a class="btn btn-primary btn-sm" href="register.html">注册</a>`;
  }
}

function renderTemplates() {
  const grid = document.getElementById("tplGrid");
  grid.innerHTML = "";
  for (const t of TEMPLATES) {
    const card = document.createElement("div");
    card.className = "tpl-card";
    card.innerHTML =
      `<div class="thumb">${ICONS[t.icon] || ICONS.mindmap}</div>` +
      `<span class="badge">${t.type === "mindmap" ? "脑图" : t.type === "flowchart" ? "流程" : "白板"}</span>` +
      `<h3>${t.name}</h3><p class="desc">${t.desc}</p>`;
    card.addEventListener("click", () => onPick(t));
    grid.appendChild(card);
  }
}

async function onPick(t) {
  const user = await Auth.me().catch(() => null);
  if (!user) {
    location.href = `login.html?tpl=${t.id}`;
    return;
  }
  try {
    const map = await createMap(t.name, t.type, t.build());
    location.href = `editor.html?id=${map.id}`;
  } catch (e) {
    toast(e.message, "error");
  }
}

(async () => {
  renderTemplates();
  const user = await Auth.me().catch(() => null);
  renderNav(user);
})();
