// 仪表盘：列表 / 新建 / 分享 / 重命名 / 删除
import { Auth, getMaps, createMap, saveMap, deleteMap, setShare, fmtDate, fmtSize, toast } from "./api.js";
import { ICONS } from "./icons.js";
import { TEMPLATES, emptyDoc } from "./templates.js";

document.getElementById("tM").innerHTML = ICONS.mindmap;
document.getElementById("tF").innerHTML = ICONS.flow;
document.getElementById("tB").innerHTML = ICONS.board;

const navAuth = document.getElementById("navAuth");
let maps = [];
let filter = "all";

function renderNav(user) {
  navAuth.innerHTML =
    `<span class="avatar" title="${user.nickname || user.email}">${(user.nickname || user.email)[0].toUpperCase()}</span>` +
    `<button class="btn btn-ghost btn-sm" id="logoutBtn">退出</button>`;
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await Auth.logout().catch(() => {});
    location.href = "/";
  });
}

const TYPE_ICON = { mindmap: ICONS.mindmap, flowchart: ICONS.flow, whiteboard: ICONS.board };
const TYPE_NAME = { mindmap: "思维导图", flowchart: "流程图", whiteboard: "白板" };

function renderList() {
  const list = document.getElementById("list");
  const data = filter === "all" ? maps : maps.filter((m) => m.type === filter);
  if (!data.length) {
    list.innerHTML = `<div class="empty">${ICONS.folder}<div>这里还没有导图，点右上角「新建导图」开始吧～</div></div>`;
    return;
  }
  list.className = "grid cols-4";
  list.innerHTML = "";
  for (const m of data) {
    const card = document.createElement("div");
    card.className = "map-card";
    card.innerHTML =
      `<div class="preview">${TYPE_ICON[m.type] || ICONS.mindmap}</div>` +
      `<div class="meta">` +
        `<h3>${escapeHtml(m.title)} ${m.is_public ? '<span class="pub">公开</span>' : ""}</h3>` +
        `<div class="time">${TYPE_NAME[m.type] || ""} · 更新 ${fmtDate(m.updated_at)}${m.size ? " · " + fmtSize(m.size) : ""}</div>` +
      `</div>` +
      `<div class="acts">` +
        `<button class="btn btn-primary btn-sm" data-act="open">打开</button>` +
        `<button class="btn btn-soft btn-sm" data-act="share">${m.is_public ? "取消分享" : "分享"}</button>` +
        `<button class="btn btn-ghost btn-sm" data-act="rename">改名</button>` +
        `<button class="btn btn-danger btn-sm" data-act="del">删除</button>` +
      `</div>`;
    card.querySelector('[data-act="open"]').addEventListener("click", () => { location.href = `/editor.html?id=${m.id}`; });
    card.querySelector('[data-act="share"]').addEventListener("click", () => onShare(m));
    card.querySelector('[data-act="rename"]').addEventListener("click", () => onRename(m));
    card.querySelector('[data-act="del"]').addEventListener("click", () => onDelete(m));
    list.appendChild(card);
  }
}

function escapeHtml(s) { return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

async function onShare(m) {
  try {
    if (m.is_public) {
      await setShare(m.id, false);
      m.is_public = 0;
      toast("已取消分享");
    } else {
      await setShare(m.id, true);
      m.is_public = 1;
      const url = `${location.origin}/share.html?id=${m.id}`;
      try { await navigator.clipboard.writeText(url); toast("分享链接已复制：" + url, "success"); }
      catch (_) { toast("公开链接：" + url, "success"); }
    }
    renderList();
  } catch (e) { toast(e.message, "error"); }
}

async function onRename(m) {
  const name = prompt("输入新标题", m.title);
  if (!name) return;
  try {
    await saveMap(m.id, { title: name });
    m.title = name.slice(0, 80);
    renderList();
    toast("已重命名", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function onDelete(m) {
  if (!confirm(`确定删除「${m.title}」？此操作不可恢复。`)) return;
  try {
    await deleteMap(m.id);
    maps = maps.filter((x) => x.id !== m.id);
    renderList();
    toast("已删除", "success");
  } catch (e) { toast(e.message, "error"); }
}

// 新建弹层
const newMask = document.getElementById("newMask");
document.getElementById("newBtn").addEventListener("click", () => {
  newMask.style.display = "flex";
});
document.getElementById("newCancel").addEventListener("click", () => { newMask.style.display = "none"; });
newMask.addEventListener("click", (e) => { if (e.target === newMask) newMask.style.display = "none"; });

document.querySelectorAll("#typeGrid .opt").forEach((opt) => {
  opt.addEventListener("click", async () => {
    const type = opt.dataset.type;
    newMask.style.display = "none";
    try {
      const map = await createMap("未命名导图", type, emptyDoc(type));
      location.href = `/editor.html?id=${map.id}`;
    } catch (e) { toast(e.message, "error"); }
  });
});

const tplChips = document.getElementById("tplChips");
for (const t of TEMPLATES) {
  const chip = document.createElement("button");
  chip.className = "btn btn-ghost btn-sm";
  chip.textContent = t.name;
  chip.addEventListener("click", async () => {
    newMask.style.display = "none";
    try {
      const map = await createMap(t.name, t.type, t.build());
      location.href = `/editor.html?id=${map.id}`;
    } catch (e) { toast(e.message, "error"); }
  });
  tplChips.appendChild(chip);
}

document.querySelectorAll("#filter button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#filter button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    filter = b.dataset.f;
    renderList();
  });
});

(async () => {
  const user = await Auth.me().catch(() => null);
  if (!user) { location.href = "/login.html?next=/dashboard.html"; return; }
  renderNav(user);
  try {
    maps = await getMaps();
  } catch (e) { toast(e.message, "error"); }
  renderList();
})();
