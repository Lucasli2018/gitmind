// 编辑器入口：加载导图、自动保存、工具栏、主题、导出、分享、快捷键
import { Auth, getMap, saveMap, setShare, toast } from "../api.js";
import { ICONS } from "../icons.js";
import { Editor } from "./canvas.js";
import { FLOW_SHAPES } from "./flowchart.js";
import { WB_TOOLS } from "./whiteboard.js";
import { openOutline } from "./outline.js";
import { exportSVG, exportPNG, exportJSON, importJSON } from "./export.js";
import { layoutMindmap } from "./mindmap.js";
import { newId } from "./model.js";

const params = new URLSearchParams(location.search);
const mapId = params.get("id");

// 导出菜单图标
document.getElementById("iPng").innerHTML = ICONS.image;
document.getElementById("iSvg").innerHTML = ICONS.flow;
document.getElementById("iJson").innerHTML = ICONS.folder;
document.getElementById("iImport").innerHTML = ICONS.upload;

const THEMES = {
  teal: ["#11b5a4", "#2f80ed", "#ff7a59", "#f5a623", "#9b59b6", "#16a34a"],
  ocean: ["#2f80ed", "#0ea5e9", "#14b8a6", "#6366f1", "#06b6d4", "#3b82f6"],
  sunset: ["#ff7a59", "#f5a623", "#e5484d", "#ff9f43", "#ee5253", "#ff6b6b"],
  forest: ["#16a34a", "#0e9f6e", "#65a30d", "#059669", "#10b981", "#22c55e"],
};
let currentTheme = "teal";

let map = null;
let editor = null;
let saveTimer = null;

function scheduleSave() {
  setStatus("saving", "保存中…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
async function saveNow() {
  if (!editor || !map) return;
  clearTimeout(saveTimer);
  setStatus("saving", "保存中…");
  try {
    await saveMap(mapId, { title: map.title, data: editor.doc });
    setStatus("saved", "已保存");
  } catch (e) {
    setStatus("saved", "保存失败");
    toast(e.message, "error");
  }
}
function setStatus(cls, text) {
  const s = document.getElementById("status");
  s.className = "gm-status " + cls;
  s.textContent = text;
}

// ---------- 根节点（空白脑图） ----------
function childrenMap() {
  const m = new Map();
  for (const n of editor.doc.nodes) if (n.parentId) { if (!m.has(n.parentId)) m.set(n.parentId, []); m.get(n.parentId).push(n); }
  return m;
}
function ensureRoot() {
  if (editor.doc.type === "mindmap" && !editor.doc.nodes.some((n) => n.parentId == null)) {
    editor.doc.nodes.push({ id: newId(), x: 0, y: 0, w: 160, h: 56, text: "中心主题", shape: "rounded", color: "#11b5a4", textColor: "#fff", stroke: "#11b5a4", fontSize: 17, parentId: null, collapsed: false });
    layoutMindmap(editor.doc);
    editor.render(); editor.fitView(true); editor.onChange();
    return true;
  }
  return false;
}

// ---------- 主题 ----------
function applyTheme(name) {
  const pal = THEMES[name]; if (!pal) return;
  currentTheme = name;
  const cm = childrenMap();
  const roots = editor.doc.nodes.filter((n) => n.parentId == null);
  function paint(id, color) {
    const n = editor.nodeById(id); if (!n) return;
    if (n.parentId == null) { n.color = color; n.textColor = "#fff"; }
    else n.stroke = color;
    for (const c of cm.get(id) || []) paint(c.id, color);
  }
  roots.forEach((r, i) => paint(r.id, pal[i % pal.length]));
  if (editor.doc.type === "mindmap") layoutMindmap(editor.doc);
  editor.render(); editor.onChange();
  document.querySelectorAll("#themes .gm-theme").forEach((el) => el.classList.toggle("active", el.dataset.theme === name));
}
function buildThemes() {
  const box = document.getElementById("themes");
  box.innerHTML = "";
  for (const name of Object.keys(THEMES)) {
    const pal = THEMES[name];
    const el = document.createElement("div");
    el.className = "gm-theme" + (name === currentTheme ? " active" : "");
    el.dataset.theme = name;
    el.style.background = `linear-gradient(135deg, ${pal[0]}, ${pal[1]})`;
    el.title = name;
    el.addEventListener("click", () => applyTheme(name));
    box.appendChild(el);
  }
}

// ---------- 工具栏 ----------
function buildToolbar() {
  const bar = document.getElementById("toolbar");
  bar.innerHTML = "";
  const mode = editor.mode;
  if (mode === "mindmap") {
    addTool(bar, "plus", "子节点", () => { const sel = [...editor.selection][0]; if (sel) editor.addMindmapChild(sel); else ensureRoot(); });
    addTool(bar, "plus", "兄弟", () => { const sel = [...editor.selection][0]; if (sel) editor.addMindmapSibling(sel); });
    addTool(bar, "trash", "删除", () => editor.deleteSelection());
    addTool(bar, "fit", "布局", () => { layoutMindmap(editor.doc); editor.render(); editor.fitView(true); editor.onChange(); });
  } else if (mode === "flowchart") {
    for (const s of FLOW_SHAPES) {
      addTool(bar, s.icon, s.label, () => { const c = editor.viewCenterWorld(); editor.addFlowShape(s.shape, c.x, c.y); });
    }
    addTool(bar, "trash", "删除", () => editor.deleteSelection());
  } else {
    for (const t of WB_TOOLS) {
      if (t.tool === "pen") {
        const b = addTool(bar, t.icon, t.label, () => { editor.setTool(editor.tool === "pen" ? "select" : "pen"); refreshToolActive(); });
      } else {
        addTool(bar, t.icon, t.label, () => { const c = editor.viewCenterWorld(); editor.addWhiteboardNode(t.tool, c.x, c.y); editor.setTool("select"); refreshToolActive(); });
      }
    }
    addTool(bar, "trash", "删除", () => editor.deleteSelection());
  }
}
function addTool(bar, icon, label, action) {
  const b = document.createElement("button");
  b.className = "gm-tool";
  b.innerHTML = `${ICONS[icon] || ""}<span class="lbl">${label}</span>`;
  b.addEventListener("click", () => {
    action();
    document.body.classList.remove("gm-tools-open");
  });
  bar.appendChild(b);
  return b;
}
function refreshToolActive() {
  const tools = document.querySelectorAll("#toolbar .gm-tool");
  tools.forEach((t, i) => {
    if (editor.mode === "whiteboard" && i === 0) t.classList.toggle("active", editor.tool === "pen");
  });
}

// ---------- 模式切换 ----------
function setMode(mode) {
  editor.setMode(mode);
  document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  buildToolbar();
}

// ---------- 分享 ----------
async function toggleShare() {
  try {
    if (map.is_public) {
      await setShare(mapId, false); map.is_public = 0;
      document.getElementById("shareBtn").textContent = "分享";
      toast("已取消分享", "success");
    } else {
      await setShare(mapId, true); map.is_public = 1;
      document.getElementById("shareBtn").textContent = "已分享";
      const url = `${location.origin}/share.html?id=${mapId}`;
      try { await navigator.clipboard.writeText(url); toast("公开链接已复制：" + url, "success"); }
      catch (_) { toast("公开链接：" + url, "success"); }
    }
  } catch (e) { toast(e.message, "error"); }
}

// ---------- 导出菜单 ----------
function wireExport() {
  const menu = document.getElementById("exportMenu");
  const toggle = document.getElementById("exportToggle");
  const pop = document.getElementById("exportPop");
  toggle.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
  document.addEventListener("click", () => menu.classList.remove("open"));
  pop.addEventListener("click", (e) => e.stopPropagation());
  pop.querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "png") exportPNG(editor, map.title);
      else if (act === "svg") exportSVG(editor, map.title);
      else if (act === "json") exportJSON(editor, map.title);
      else if (act === "import") document.getElementById("importFile").click();
    });
  });
  document.getElementById("importFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    importJSON(editor, f, () => {
      map.title = editor.doc.type === "mindmap" ? map.title : map.title;
      document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === editor.mode));
      buildToolbar(); scheduleSave();
    });
  });
}

// ---------- 顶栏 / 右键面板 ----------
function wireChrome() {
  document.getElementById("saveBtn").addEventListener("click", saveNow);
  document.getElementById("shareBtn").addEventListener("click", toggleShare);
  document.getElementById("zoomIn").addEventListener("click", () => { const r = editor.rect(); editor.zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2); });
  document.getElementById("zoomOut").addEventListener("click", () => { const r = editor.rect(); editor.zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2); });
  document.getElementById("zoomFit").addEventListener("click", () => editor.fitView());
  document.getElementById("layoutBtn").addEventListener("click", () => { layoutMindmap(editor.doc); editor.render(); editor.fitView(true); editor.onChange(); });
  document.getElementById("outlineBtn").addEventListener("click", () => openOutline(editor));
  document.getElementById("delBtn").addEventListener("click", () => editor.deleteSelection());
  document.querySelectorAll("#modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  const titleInput = document.getElementById("titleInput");
  titleInput.addEventListener("input", () => { map.title = titleInput.value; scheduleSave(); });
  wireMobileDrawers();
}

// 移动端：工具栏 / 面板抽屉开关 + 遮罩关闭
function wireMobileDrawers() {
  const body = document.body;
  const t = document.getElementById("toolsToggle");
  const p = document.getElementById("panelToggle");
  const m = document.getElementById("drawerMask");
  if (t) t.addEventListener("click", () => {
    const open = body.classList.toggle("gm-tools-open");
    if (open) body.classList.remove("gm-panel-open");
  });
  if (p) p.addEventListener("click", () => {
    const open = body.classList.toggle("gm-panel-open");
    if (open) body.classList.remove("gm-tools-open");
  });
  if (m) m.addEventListener("click", () => body.classList.remove("gm-tools-open", "gm-panel-open"));
}

// ---------- 快捷键 ----------
function wireKeys() {
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); return; }
    if (e.key === "Tab" && editor.mode === "mindmap") {
      e.preventDefault();
      const sel = [...editor.selection][0];
      if (sel) editor.addMindmapChild(sel);
      else { const root = editor.doc.nodes.find((n) => n.parentId == null); if (root) editor.addMindmapChild(root.id); else ensureRoot(); }
      return;
    }
    if (e.key === "Enter" && editor.mode === "mindmap") { e.preventDefault(); const sel = [...editor.selection][0]; if (sel) editor.addMindmapSibling(sel); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); editor.deleteSelection(); return; }
    if (e.key === "Escape") editor.clearSelection();
  });
}

// ---------- 启动 ----------
(async () => {
  const user = await Auth.me().catch(() => null);
  if (!user) { location.href = `/login.html?next=${encodeURIComponent("/editor.html?id=" + mapId)}`; return; }
  if (!mapId) { location.href = "/dashboard.html"; return; }

  try {
    map = await getMap(mapId);
  } catch (e) {
    if (e.message.includes("无权") || e.message.includes("不存在")) { location.href = `/share.html?id=${mapId}`; return; }
    toast(e.message, "error"); return;
  }
  if (!map.owner) { location.href = `/share.html?id=${mapId}`; return; }

  document.getElementById("titleInput").value = map.title || "未命名导图";
  document.getElementById("shareBtn").textContent = map.is_public ? "已分享" : "分享";

  editor = new Editor(document.getElementById("canvas"), { onChange: scheduleSave, mode: map.type || "mindmap" });
  editor.load(map.data);
  document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === editor.mode));
  if (editor.mode === "mindmap") ensureRoot();

  buildToolbar();
  buildThemes();
  wireChrome();
  wireExport();
  wireKeys();
})();
