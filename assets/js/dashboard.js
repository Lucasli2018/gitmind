// 仪表盘：文件夹层级 + 导图列表 / 新建 / 分享 / 重命名 / 删除 / 移动
import { Auth, getMaps, createMap, saveMap, deleteMap, setShare, getFolders, createFolder, renameFolder, moveFolder, deleteFolder, moveMap, fmtDate, fmtSize, toast } from "./api.js";
import { confirmDialog, promptDialog } from "./ui.js";
import { ICONS } from "./icons.js";
import { TEMPLATES, emptyDoc } from "./templates.js";

document.getElementById("tM").innerHTML = ICONS.mindmap;
document.getElementById("tF").innerHTML = ICONS.flow;
document.getElementById("tB").innerHTML = ICONS.board;

const navAuth = document.getElementById("navAuth");
let maps = [];
let folders = [];
let filter = "all";
// 当前视图：null=全部 / '__uncat__'=未分类 / <folderId>=某个文件夹
let currentFolder = null;
const expanded = new Set();   // 已展开的文件夹 id
const V_UNCAT = "__uncat__";  // 未分类虚拟节点

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

function escapeHtml(s) { return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function folderMap() { const m = new Map(); for (const f of folders) m.set(f.id, f); return m; }

// 当前文件夹下直接归属的导图
function mapsInFolder(id) {
  if (id === null) return maps;                       // 全部
  if (id === V_UNCAT) return maps.filter((m) => !m.folder_id);
  return maps.filter((m) => m.folder_id === id);
}
// 当前文件夹的直接子文件夹
function childFolders(id) {
  if (id === null || id === V_UNCAT) return folders.filter((f) => !f.parent_id || !folderMap().has(f.parent_id));
  return folders.filter((f) => f.parent_id === id);
}
function directCount(id) { return maps.filter((m) => m.folder_id === id).length; }

// ===================== 侧栏文件夹树 =====================
function renderSidebar() {
  const tree = document.getElementById("tree");
  tree.innerHTML = "";
  // 虚拟根：全部 / 未分类
  tree.appendChild(sideRow({
    id: null, name: "全部", icon: "🗂️", count: maps.length, virtual: true, depth: 0,
  }));
  tree.appendChild(sideRow({
    id: V_UNCAT, name: "未分类", icon: "📄", count: maps.filter((m) => !m.folder_id).length, virtual: true, depth: 0,
  }));
  // 真实根文件夹
  for (const f of childFolders(null)) tree.appendChild(renderNode(f, 0));
}

function renderNode(folder, depth) {
  // 子节点包进独立容器，避免塞进父行 flex 布局导致样式错乱
  const node = document.createElement("div");
  node.className = "tree-node";
  node.appendChild(sideRow({
    id: folder.id, name: folder.name, icon: "📁", count: directCount(folder.id), depth,
    hasChildren: childFolders(folder.id).length > 0,
  }));
  if (expanded.has(folder.id)) {
    const kids = document.createElement("div");
    kids.className = "tree-children";
    for (const c of childFolders(folder.id)) kids.appendChild(renderNode(c, depth + 1));
    node.appendChild(kids);
  }
  return node;
}

function sideRow({ id, name, icon, count, depth, virtual, hasChildren }) {
  const row = document.createElement("div");
  row.className = "tree-row" + (currentFolder === id ? " active" : "");
  row.dataset.id = id === null ? "" : id;
  row.dataset.virtual = virtual ? "1" : "";
  row.style.paddingLeft = (10 + depth * 16) + "px";
  const isOpen = id && expanded.has(id);
  const caret = hasChildren ? `<span class="tw-caret">${isOpen ? "▾" : "▸"}</span>` : `<span class="tw-caret leaf"></span>`;
  row.innerHTML =
    caret +
    `<span class="tw-ico">${icon}</span>` +
    `<span class="tw-name">${escapeHtml(name)}</span>` +
    `<span class="tw-count">${count}</span>` +
    (virtual ? "" :
      `<span class="tw-acts">` +
        `<button data-act="add" title="新建子文件夹">＋</button>` +
        `<button data-act="rename" title="重命名">✎</button>` +
        `<button data-act="del" title="删除">🗑</button>` +
      `</span>`);

  // 点击整行（非操作按钮）跳转
  row.addEventListener("click", (e) => {
    if (e.target.closest(".tw-acts")) return;
    if (hasChildren && e.target.closest(".tw-caret:not(.leaf)")) {
      toggleExpand(id); return;
    }
    currentFolder = id;
    renderSidebar(); renderBreadcrumb(); renderList();
  });
  // 拖放：把导图拖到文件夹上归类
  row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop"); });
  row.addEventListener("dragleave", () => row.classList.remove("drop"));
  row.addEventListener("drop", async (e) => {
    e.preventDefault(); row.classList.remove("drop");
    const mapId = e.dataTransfer.getData("text/map-id");
    if (!mapId || id === null) return;            // 「全部」入口不移动
    const target = id === V_UNCAT ? null : id;    // 「未分类」显式归位 NULL
    await doMoveMap(mapId, target);
  });
  // 操作按钮
  row.querySelector('[data-act="add"]')?.addEventListener("click", (e) => { e.stopPropagation(); onNewFolder(id); });
  row.querySelector('[data-act="rename"]')?.addEventListener("click", (e) => { e.stopPropagation(); onRenameFolder(id); });
  row.querySelector('[data-act="del"]')?.addEventListener("click", (e) => { e.stopPropagation(); onDeleteFolder(id); });
  return row;
}

function toggleExpand(id) {
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  renderSidebar();
}

// ===================== 面包屑 =====================
function folderPath(id) {
  const path = [];
  let cur = folderMap().get(id);
  while (cur) { path.unshift(cur); cur = cur.parent_id ? folderMap().get(cur.parent_id) : null; }
  return path;
}
function renderBreadcrumb() {
  const crumb = document.getElementById("crumb");
  const title = document.getElementById("crumbTitle");
  crumb.innerHTML = "";
  const parts = [];
  if (currentFolder === null) { parts.push({ id: null, name: "全部" }); }
  else if (currentFolder === V_UNCAT) { parts.push({ id: null, name: "全部" }, { id: V_UNCAT, name: "未分类" }); }
  else { parts.push({ id: null, name: "全部" }, ...folderPath(currentFolder)); }
  parts.forEach((p, i) => {
    const a = document.createElement("span");
    a.className = "crumb-item" + (i === parts.length - 1 ? " current" : "");
    a.textContent = p.name;
    a.addEventListener("click", () => { currentFolder = p.id; renderSidebar(); renderBreadcrumb(); renderList(); });
    crumb.appendChild(a);
    if (i < parts.length - 1) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep"; sep.textContent = "›";
      crumb.appendChild(sep);
    }
  });
  title.textContent = currentFolder === V_UNCAT ? "未分类" : (currentFolder ? (folderMap().get(currentFolder)?.name || "我的导图") : "我的导图");
}

// ===================== 列表（子文件夹卡片 + 导图卡片） =====================
function renderList() {
  const list = document.getElementById("list");
  const viewMaps = mapsInFolder(currentFolder).filter((m) => filter === "all" || m.type === filter);
  const subFolders = currentFolder && currentFolder !== V_UNCAT ? childFolders(currentFolder) : [];

  if (!subFolders.length && !viewMaps.length) {
    list.className = "";
    list.innerHTML = `<div class="empty">${ICONS.folder}<div>这里还没有内容，点右上角「新建导图」或左侧「+ 新建」文件夹吧～</div></div>`;
    return;
  }
  list.className = "grid cols-4";
  list.innerHTML = "";
  // 子文件夹卡片
  for (const f of subFolders) {
    const card = document.createElement("div");
    card.className = "map-card folder-card";
    card.innerHTML =
      `<div class="preview folder-prev">📁</div>` +
      `<div class="meta"><h3>${escapeHtml(f.name)}</h3>` +
      `<div class="time">${directCount(f.id)} 个导图 · ${childFolders(f.id).length} 个子文件夹</div></div>` +
      `<div class="acts">` +
        `<button class="btn btn-soft btn-sm" data-act="open">打开</button>` +
        `<button class="btn btn-ghost btn-sm" data-act="rename">改名</button>` +
        `<button class="btn btn-danger btn-sm" data-act="del">删除</button>` +
      `</div>`;
    card.querySelector('[data-act="open"]').addEventListener("click", () => { currentFolder = f.id; expanded.add(f.id); renderSidebar(); renderBreadcrumb(); renderList(); });
    card.querySelector('[data-act="rename"]').addEventListener("click", () => onRenameFolder(f.id));
    card.querySelector('[data-act="del"]').addEventListener("click", () => onDeleteFolder(f.id));
    list.appendChild(card);
  }
  // 导图卡片
  for (const m of viewMaps) {
    const card = document.createElement("div");
    card.className = "map-card";
    card.draggable = true;
    card.innerHTML =
      `<div class="preview">${TYPE_ICON[m.type] || ICONS.mindmap}</div>` +
      `<div class="meta">` +
        `<h3>${escapeHtml(m.title)} ${m.is_public ? '<span class="pub">公开</span>' : ""}</h3>` +
        `<div class="time">${TYPE_NAME[m.type] || ""} · 更新 ${fmtDate(m.updated_at)}${m.size ? " · " + fmtSize(m.size) : ""}</div>` +
      `</div>` +
      `<div class="acts">` +
        `<button class="btn btn-primary btn-sm" data-act="open">打开</button>` +
        `<button class="btn btn-soft btn-sm" data-act="move">移动</button>` +
        `<button class="btn btn-ghost btn-sm" data-act="share">${m.is_public ? "取消分享" : "分享"}</button>` +
        `<button class="btn btn-ghost btn-sm" data-act="rename">改名</button>` +
        `<button class="btn btn-danger btn-sm" data-act="del">删除</button>` +
      `</div>`;
    card.querySelector('[data-act="open"]').addEventListener("click", () => { location.href = `editor.html?id=${m.id}`; });
    card.querySelector('[data-act="share"]').addEventListener("click", () => onShare(m));
    card.querySelector('[data-act="rename"]').addEventListener("click", () => onRename(m));
    card.querySelector('[data-act="del"]').addEventListener("click", () => onDelete(m));
    card.querySelector('[data-act="move"]').addEventListener("click", () => openMovePicker(m));
    card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/map-id", m.id); card.classList.add("dragging"); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    list.appendChild(card);
  }
}

// ===================== 操作：导图 =====================
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
  const name = await promptDialog({ title: "重命名导图", value: m.title, maxlength: 80, okText: "重命名" });
  if (name === null) return;
  const next = name.trim();
  if (!next || next === m.title) return;
  try {
    await saveMap(m.id, { title: next });
    m.title = next.slice(0, 80);
    renderList();
    toast("已重命名", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function onDelete(m) {
  const ok = await confirmDialog({ title: "提示", message: `确认删除「${escapeHtml(m.title)}」？删除后不可恢复。`, okText: "确认删除" });
  if (!ok) return;
  try {
    await deleteMap(m.id);
    maps = maps.filter((x) => x.id !== m.id);
    renderSidebar(); renderList();
    toast("已删除", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function doMoveMap(mapId, folderId) {
  try {
    await moveMap(mapId, folderId);
    const m = maps.find((x) => x.id === mapId);
    if (m) m.folder_id = folderId || null;
    renderSidebar(); renderBreadcrumb(); renderList();
    toast("已移动", "success");
  } catch (e) { toast(e.message, "error"); }
}

// 移动到：文件夹选择器弹层
async function openMovePicker(m) {
  const mask = document.createElement("div");
  mask.className = "gm-modal-mask";
  const fm = folderMap();
  // 计算缩进深度
  const depthOf = (id) => { let d = 0; let c = fm.get(id); while (c && c.parent_id) { d++; c = fm.get(c.parent_id); } return d; };
  let html = `<div class="gm-modal"><button class="gm-modal-x">×</button><h3>移动到文件夹</h3><div class="gm-modal-scroll move-list">`;
  html += `<div class="move-opt" data-fid=""><span class="tw-ico">📄</span> 未分类</div>`;
  // 按更新时间排序，按层级缩进展示
  const sorted = [...folders].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  for (const f of sorted) html += `<div class="move-opt" data-fid="${f.id}" style="padding-left:${14 + depthOf(f.id) * 16}px"><span class="tw-ico">📁</span> ${escapeHtml(f.name)}</div>`;
  html += `</div><div class="gm-modal-acts"><button class="btn btn-ghost" data-x>取消</button></div></div>`;
  mask.innerHTML = html;
  document.body.appendChild(mask);
  mask.querySelector(".gm-modal-x").addEventListener("click", () => mask.remove());
  mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
  mask.querySelector("[data-x]").addEventListener("click", () => mask.remove());
  mask.querySelectorAll(".move-opt").forEach((opt) => {
    opt.addEventListener("click", async () => {
      const fid = opt.dataset.fid || null;
      mask.remove();
      await doMoveMap(m.id, fid);
    });
  });
}

// ===================== 操作：文件夹 =====================
async function onNewFolder(parentId = null) {
  const name = await promptDialog({ title: parentId ? "新建子文件夹" : "新建文件夹", value: "", maxlength: 60, placeholder: "文件夹名称", okText: "创建" });
  if (name === null) return;
  const nm = name.trim();
  if (!nm) return;
  try {
    const f = await createFolder(nm, parentId);
    folders.push(f);
    if (parentId) expanded.add(parentId);
    renderSidebar(); renderBreadcrumb(); renderList();
    toast("已创建文件夹", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function onRenameFolder(id) {
  const f = folderMap().get(id);
  const name = await promptDialog({ title: "重命名文件夹", value: f ? f.name : "", maxlength: 60, okText: "重命名" });
  if (name === null) return;
  const nm = name.trim();
  if (!nm || (f && nm === f.name)) return;
  try {
    await renameFolder(id, nm);
    if (f) f.name = nm.slice(0, 60);
    renderSidebar(); renderBreadcrumb(); renderList();
    toast("已重命名", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function onDeleteFolder(id) {
  const f = folderMap().get(id);
  const sub = childFolders(id).length;
  const cnt = directCount(id);
  const msg = `确认删除「${escapeHtml(f ? f.name : "")}」？` +
    (sub || cnt ? `其下 ${cnt} 个导图与 ${sub} 个子文件夹将上移到上级文件夹。` : "") + `此操作不可恢复。`;
  const ok = await confirmDialog({ title: "删除文件夹", message: msg, okText: "确认删除" });
  if (!ok) return;
  try {
    const r = await deleteFolder(id);
    const removed = new Set(await collectRemoved(id));
    folders = folders.filter((x) => !removed.has(x.id));
    // 被上移的导图 folder_id 可能变化（级联到父级或 null）
    for (const m of maps) if (m.folder_id && removed.has(m.folder_id)) m.folder_id = (r.reparentedTo || null);
    // 若当前正在被删文件夹或其后代中，回退到父级或「全部」
    if (currentFolder && removed.has(currentFolder)) currentFolder = f && f.parent_id && !removed.has(f.parent_id) ? f.parent_id : null;
    renderSidebar(); renderBreadcrumb(); renderList();
    toast("已删除文件夹", "success");
  } catch (e) { toast(e.message, "error"); }
}

// 本地预估被删集合（与后端一致：自身 + 后代）
async function collectRemoved(id) {
  const out = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of folders) if (c.parent_id === cur && !out.has(c.id)) { out.add(c.id); stack.push(c.id); }
  }
  return out;
}

// ===================== 新建导图（按当前文件夹归类） =====================
const newMask = document.getElementById("newMask");
document.getElementById("newBtn").addEventListener("click", () => { newMask.style.display = "flex"; });
document.getElementById("newCancel").addEventListener("click", () => { newMask.style.display = "none"; });
newMask.addEventListener("click", (e) => { if (e.target === newMask) newMask.style.display = "none"; });

function currentFolderId() { return currentFolder && currentFolder !== V_UNCAT ? currentFolder : null; }

document.querySelectorAll("#typeGrid .opt").forEach((opt) => {
  opt.addEventListener("click", async () => {
    const type = opt.dataset.type;
    newMask.style.display = "none";
    try {
      const map = await createMap("未命名导图", type, emptyDoc(type), currentFolderId());
      location.href = `editor.html?id=${map.id}`;
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
      const map = await createMap(t.name, t.type, t.build(), currentFolderId());
      location.href = `editor.html?id=${map.id}`;
    } catch (e) { toast(e.message, "error"); }
  });
  tplChips.appendChild(chip);
}

document.getElementById("newFolderBtn").addEventListener("click", () => onNewFolder(null));

// ===================== 侧栏整体收缩 =====================
const sidebar = document.getElementById("sidebar");
const sideToggle = document.getElementById("sideToggle");
function applySideCollapsed(c) {
  sidebar.classList.toggle("collapsed", c);
  sideToggle.textContent = c ? "»" : "«";
  sideToggle.title = c ? "展开文件夹栏" : "收起文件夹栏";
}
try { applySideCollapsed(localStorage.getItem("gm_side_collapsed") === "1"); } catch (_) { applySideCollapsed(false); }
sideToggle.addEventListener("click", () => {
  const c = sidebar.classList.toggle("collapsed");
  try { localStorage.setItem("gm_side_collapsed", c ? "1" : "0"); } catch (_) {}
  applySideCollapsed(c);
});

document.querySelectorAll("#filter button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#filter button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    filter = b.dataset.f;
    renderList();
  });
});

// ===================== 启动 =====================
(async () => {
  const user = await Auth.me().catch(() => null);
  if (!user) { location.href = "login.html?next=dashboard.html"; return; }
  renderNav(user);
  try {
    [folders, maps] = await Promise.all([getFolders(), getMaps()]);
    // 默认展开所有文件夹，便于一览结构
    for (const f of folders) expanded.add(f.id);
  } catch (e) { toast(e.message, "error"); }
  renderSidebar(); renderBreadcrumb(); renderList();
})();
