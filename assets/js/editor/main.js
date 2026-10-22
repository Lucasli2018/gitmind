// 编辑器入口：加载导图、自动保存、工具栏、主题、导出、分享、快捷键
import { Auth, getMap, saveMap, setShare, toast, fmtTime, fmtSize, byteLength } from "../api.js";
import { ICONS } from "../icons.js";
import { Editor } from "./canvas.js";
import { FC_TOOLS } from "./flowchart.js";
import { WB_TOOLS, WB_MORE, WB_COLORS } from "./whiteboard.js";
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
document.getElementById("undoBtn").innerHTML = `${ICONS.undo}<span>撤销</span>`;
document.getElementById("redoBtn").innerHTML = `${ICONS.redo}<span>重做</span>`;

// 同步顶栏 undo/redo 按钮的可用态
function updateUndoRedoButtons(canUndo, canRedo) {
  const u = document.getElementById("undoBtn");
  const r = document.getElementById("redoBtn");
  if (u) u.disabled = !canUndo;
  if (r) r.disabled = !canRedo;
}

const THEMES = {
  teal: ["#11b5a4", "#2f80ed", "#ff7a59", "#f5a623", "#9b59b6", "#16a34a"],
  ocean: ["#2f80ed", "#0ea5e9", "#14b8a6", "#6366f1", "#06b6d4", "#3b82f6"],
  sunset: ["#ff7a59", "#f5a623", "#e5484d", "#ff9f43", "#ee5253", "#ff6b6b"],
  forest: ["#16a34a", "#0e9f6e", "#65a30d", "#059669", "#10b981", "#22c55e"],
  // 以下为新增主题（参考 simple-mind-map 配色风格）
  classic: ["#2f54eb", "#13c2c2", "#fa8c16", "#722ed1", "#eb2f96", "#52c41a"],
  blue: ["#1d4ed8", "#2563eb", "#0ea5e9", "#3b82f6", "#06b6d4", "#60a5fa"],
  purple: ["#7c3aed", "#8b5cf6", "#a855f7", "#6d28d9", "#c026d3", "#9333ea"],
  rose: ["#e11d48", "#f43f5e", "#fb7185", "#db2777", "#ec4899", "#f472b6"],
  orange: ["#ea580c", "#f97316", "#fb923c", "#f59e0b", "#d97706", "#fbbf24"],
  gray: ["#334155", "#475569", "#64748b", "#0f766e", "#7c3aed", "#0ea5e9"],
  rainbow: ["#e5484d", "#f5a623", "#16a34a", "#0ea5e9", "#7c3aed", "#ec4899"],
};
let currentTheme = "teal";

let map = null;
let editor = null;
let dirty = false;          // 是否有未保存的本地改动
let autosaveTimer = null;
const AUTOSAVE_MS = 60000;  // 每分钟自动落盘一次，替代实时保存
let lastSavedAt = null;     // 最近一次成功保存的时间戳（用于状态栏展示）

// 当前文档序列化后的字节数（近似文件大小）
function docSize() {
  if (!editor) return 0;
  try { return byteLength(JSON.stringify(editor.doc)); }
  catch (_) { return 0; }
}

// onChange 入口：不再实时保存，仅标记脏并记录状态，由定时器每分钟落盘
function scheduleSave() {
  dirty = true;
  setStatus("unsaved", "未保存");
}
function autosaveTick() {
  if (dirty) saveNow();
}
async function saveNow() {
  if (!editor || !map) return;
  if (!dirty) { setStatus("saved", "已保存"); return; }
  setStatus("saving", "保存中…");
  try {
    const r = await saveMap(mapId, { title: map.title, data: editor.doc });
    dirty = false;
    lastSavedAt = (r && r.updated_at) || Date.now();
    setStatus("saved", "已保存");
  } catch (e) {
    setStatus("saved", "保存失败");
    toast(e.message, "error");
  }
}
function setStatus(cls, text) {
  const s = document.getElementById("status");
  s.className = "gm-status " + cls;
  // 已保存 -> 「已保存 09:39 · 12.3 KB」；其余状态附文件大小
  const parts = [];
  if (cls === "saved" && text === "已保存" && lastSavedAt) parts.push(`已保存 ${fmtTime(lastSavedAt)}`);
  else parts.push(text);
  if (editor) parts.push(fmtSize(docSize()));
  s.textContent = parts.join(" · ");
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
    editor.pushHistory();
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
  editor.pushHistory();
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

// ---------- 布局结构切换 ----------
function setLayout(layout) {
  if (editor.mode !== "mindmap") return;
  layoutMindmap(editor.doc, layout);
  editor.render();
  editor.fitView(true);
  editor.onChange();
  editor.pushHistory();
  document.querySelectorAll("#layouts button").forEach((b) => b.classList.toggle("active", b.dataset.layout === layout));
}
function buildLayouts() {
  document.querySelectorAll("#layouts button").forEach((b) => b.addEventListener("click", () => setLayout(b.dataset.layout)));
  // 同步当前文档布局的激活态
  const cur = editor.doc.layout || "mindmap";
  document.querySelectorAll("#layouts button").forEach((b) => b.classList.toggle("active", b.dataset.layout === cur));
}

// ---------- 工具栏 ----------
function buildToolbar() {
  const bar = document.getElementById("toolbar");
  const wbBar = document.getElementById("wbBar");
  bar.innerHTML = "";
  const mode = editor.mode;
  // 白板 / 流程图模式切换 body 类：隐藏左侧工具栏与脑图专属面板，启用顶部浮动工具栏
  document.body.classList.toggle("gm-wb-mode", mode === "whiteboard" || mode === "flowchart");
  if (wbBar) wbBar.hidden = !(mode === "whiteboard" || mode === "flowchart");
  if (mode === "mindmap") {
    addTool(bar, "plus", "子节点", () => { const sel = [...editor.selection][0]; if (sel) editor.addMindmapChild(sel); else ensureRoot(); });
    addTool(bar, "plus", "兄弟", () => { const sel = [...editor.selection][0]; if (sel) editor.addMindmapSibling(sel); });
    addTool(bar, "trash", "删除", () => editor.deleteSelection());
    addTool(bar, "fit", "布局", () => { layoutMindmap(editor.doc); editor.render(); editor.fitView(true); editor.onChange(); });
  } else if (mode === "flowchart" && wbBar) {
    buildFcBar(wbBar);
  } else if (mode === "whiteboard" && wbBar) {
    buildWbBar(wbBar);
  }
  updateHelpKeys();
}

// 流程图顶部工具栏（图标在上、文字在下，参考 mind-map）
function buildFcBar(bar) {
  bar.innerHTML = "";
  bar.classList.add("gm-fc-bar");
  let lastGroup = null;
  for (const t of FC_TOOLS) {
    const group = t.act.startsWith("shape:") ? 2 : t.act === "undo" || t.act === "redo" ? 1 : 3;
    if (lastGroup !== null && group !== lastGroup) bar.appendChild(wbSep());
    lastGroup = group;
    const b = document.createElement("button");
    b.className = "gm-fc-btn";
    b.dataset.act = t.act;
    b.title = t.key ? `${t.label} (${t.key})` : t.label;
    b.innerHTML = `${ICONS[t.icon] || ""}<span class="lbl">${t.label}</span>`;
    b.addEventListener("click", () => onFcAction(t.act));
    bar.appendChild(b);
  }
  refreshFcActive();
}
function onFcAction(act) {
  if (act === "undo") { editor.undo(); return; }
  if (act === "redo") { editor.redo(); return; }
  if (act === "delete") { editor.deleteSelection(); return; }
  if (act === "image") { document.getElementById("wbImageFile").click(); return; }
  if (act === "link") {
    editor.setTool(editor.tool === "link" ? "select" : "link");
    refreshFcActive();
    if (editor.tool === "link") toast("关联线：先点起始节点，再点目标节点", "info");
    return;
  }
  if (act.startsWith("shape:")) {
    const c = editor.viewCenterWorld();
    editor.addFlowShape(act.slice(6), c.x, c.y);
    editor.setTool("select");
    refreshFcActive();
  }
}
function refreshFcActive() {
  document.querySelectorAll("#wbBar .gm-fc-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.act === "link" && editor.tool === "link");
  });
}

// 白板浮动工具栏（画布顶部居中，类 Excalidraw）
function buildWbBar(bar) {
  bar.innerHTML = "";
  bar.classList.remove("gm-fc-bar");
  let lastGroup = null;
  for (const t of WB_TOOLS) {
    if (lastGroup !== null && t.group !== lastGroup) bar.appendChild(wbSep());
    lastGroup = t.group;
    const b = document.createElement("button");
    b.className = "gm-wb-btn";
    b.dataset.tool = t.tool;
    b.title = t.key ? `${t.label} (${t.key})` : t.label;
    b.innerHTML = `${ICONS[t.icon] || ""}${t.key ? `<span class="kbd">${t.key}</span>` : ""}`;
    b.addEventListener("click", () => { onWbTool(t.tool); });
    bar.appendChild(b);
  }
  bar.appendChild(wbSep());
  // 画笔 / 图形颜色
  const colors = document.createElement("div");
  colors.className = "gm-wb-colors";
  for (const c of WB_COLORS) {
    const s = document.createElement("button");
    s.className = "gm-wb-color" + (c === editor.toolColor ? " active" : "");
    s.style.background = c;
    s.title = c;
    s.addEventListener("click", () => {
      editor.toolColor = c;
      colors.querySelectorAll(".gm-wb-color").forEach((el) => el.classList.toggle("active", el === s));
      if (editor.tool === "select") editor.setTool("pen"); // 选色后自动切画笔
      refreshWbActive();
    });
    colors.appendChild(s);
  }
  bar.appendChild(colors);
  // 更多菜单：嵌入网页 / 便签 / 清空白板
  const more = document.createElement("div");
  more.className = "gm-wb-more";
  const mb = document.createElement("button");
  mb.className = "gm-wb-btn";
  mb.title = "更多";
  mb.innerHTML = ICONS.menu;
  const pop = document.createElement("div");
  pop.className = "pop";
  for (const m of WB_MORE) {
    const item = document.createElement("button");
    item.innerHTML = `${ICONS[m.icon] || ""}<span>${m.label}</span>${m.key ? `<span class="kbd">${m.key}</span>` : ""}`;
    item.addEventListener("click", () => { more.classList.remove("open"); onWbMore(m.act); });
    pop.appendChild(item);
  }
  mb.addEventListener("click", (e) => { e.stopPropagation(); more.classList.toggle("open"); });
  pop.addEventListener("click", (e) => e.stopPropagation());
  more.appendChild(mb);
  more.appendChild(pop);
  bar.appendChild(more);
  refreshWbActive();
}
function wbSep() {
  const s = document.createElement("span");
  s.className = "gm-wb-sep";
  return s;
}
function onWbTool(tool) {
  if (tool === "image") { document.getElementById("wbImageFile").click(); return; }
  editor.setTool(editor.tool === tool ? "select" : tool);
  refreshWbActive();
}
function onWbMore(act) {
  if (act === "embed") {
    const url = prompt("输入要嵌入的网页地址（https://...）", "https://");
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) { toast("请输入 http(s):// 开头的网址", "error"); return; }
    const c = editor.viewCenterWorld();
    editor.addEmbedNode(url.trim(), c.x, c.y);
  } else if (act === "sticky") {
    const c = editor.viewCenterWorld();
    editor.addWhiteboardNode("sticky", c.x, c.y);
    editor.setTool("select");
    refreshWbActive();
  } else if (act === "clear") {
    if (confirm("确定清空白板上的所有内容？此操作可用 Ctrl+Z 撤销。")) editor.clearWhiteboard();
  }
}
function refreshWbActive() {
  document.querySelectorAll("#wbBar .gm-wb-btn[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === editor.tool);
  });
}

// 帮助面板按模式显示对应快捷键
function updateHelpKeys() {
  const el = document.getElementById("helpKeys");
  if (!el) return;
  if (editor.mode === "whiteboard") {
    el.innerHTML =
      `选择 1/V · 抓手 H · 画框 F<br/>` +
      `矩形 2 · 菱形 3 · 圆 4<br/>` +
      `箭头 5 · 直线 6 · 画笔 7<br/>` +
      `文字 8 · 图片 9 · 橡皮 0 · 激光笔 K<br/>` +
      `Shift + 拖拽：直线 / 箭头吸附 45°<br/>` +
      `删除：Delete / Backspace<br/>` +
      `撤销：Ctrl/⌘ + Z · 重做：Ctrl+Y<br/>` +
      `平移：拖空白处 / 抓手 · 缩放：滚轮<br/>` +
      `保存：Ctrl/⌘ + S`;
  } else if (editor.mode === "flowchart") {
    el.innerHTML =
      `矩形 1 · 圆角 2 · 判断 3<br/>` +
      `椭圆 4 · 平行四边形 5 · 文本 6<br/>` +
      `图片 7 · 关联线 L（点起点再点目标）<br/>` +
      `连线：拖节点上下端口到目标节点<br/>` +
      `删除：Delete / Backspace<br/>` +
      `撤销：Ctrl/⌘ + Z · 重做：Ctrl+Y<br/>` +
      `平移：拖空白处 · 缩放：滚轮<br/>` +
      `保存：Ctrl/⌘ + S`;
  } else {
    el.innerHTML =
      `脑图：Tab 加子节点 · Enter 加兄弟<br/>` +
      `删除：Delete / Backspace<br/>` +
      `撤销：Ctrl/⌘ + Z · 重做：Ctrl+Y / ⌘+Shift+Z<br/>` +
      `平移：拖空白处 · 缩放：滚轮<br/>` +
      `保存：Ctrl/⌘ + S`;
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
      editor.pushHistory();
    });
  });
}

// ---------- 顶栏 / 右键面板 ----------
function wireChrome() {
  document.getElementById("saveBtn").addEventListener("click", saveNow);
  document.getElementById("shareBtn").addEventListener("click", toggleShare);
  document.getElementById("undoBtn").addEventListener("click", () => editor.undo());
  document.getElementById("redoBtn").addEventListener("click", () => editor.redo());
  document.getElementById("zoomIn").addEventListener("click", () => { const r = editor.rect(); editor.zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2); });
  document.getElementById("zoomOut").addEventListener("click", () => { const r = editor.rect(); editor.zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2); });
  document.getElementById("zoomFit").addEventListener("click", () => editor.fitView());
  document.getElementById("layoutBtn").addEventListener("click", () => { layoutMindmap(editor.doc); editor.render(); editor.fitView(true); editor.onChange(); });
  buildLayouts();
  document.getElementById("outlineBtn").addEventListener("click", () => openOutline(editor));
  document.getElementById("delBtn").addEventListener("click", () => editor.deleteSelection());
  document.querySelectorAll("#modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  // 白板插入图片：本地图片转 dataURL 后放进画布中心
  document.getElementById("wbImageFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = editor.viewCenterWorld();
        editor.addImageNode(reader.result, c.x, c.y, img.naturalWidth, img.naturalHeight);
        editor.setTool("select");
        refreshWbActive();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });
  const titleInput = document.getElementById("titleInput");
  titleInput.addEventListener("input", () => { map.title = titleInput.value; scheduleSave(); });
  wireMobileDrawers();
  // 每分钟自动保存一次（替代实时保存），操作时不发请求以提升流畅度
  autosaveTimer = setInterval(autosaveTick, AUTOSAVE_MS);
  // 兜底：切走/关闭页面若有未保存改动，立即落盘，最多丢 <1 分钟
  document.addEventListener("visibilitychange", () => { if (document.hidden && dirty) saveNow(); });
  window.addEventListener("beforeunload", () => { if (dirty) saveNow(); });
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); editor.redo(); return; }
    if (e.key === "Tab" && editor.mode === "mindmap") {
      e.preventDefault();
      const sel = [...editor.selection][0];
      if (sel) editor.addMindmapChild(sel);
      else { const root = editor.doc.nodes.find((n) => n.parentId == null); if (root) editor.addMindmapChild(root.id); else ensureRoot(); }
      return;
    }
    if (e.key === "Enter" && editor.mode === "mindmap") { e.preventDefault(); const sel = [...editor.selection][0]; if (sel) editor.addMindmapSibling(sel); return; }
    // 流程图工具快捷键（1-6 图形 / 7 图片 / L 关联线）
    if (editor.mode === "flowchart") {
      const fcKeys = { "1": "shape:rect", "2": "shape:rounded", "3": "shape:diamond", "4": "shape:ellipse", "5": "shape:parallelogram", "6": "shape:text", "7": "image", l: "link" };
      const act = fcKeys[e.key.toLowerCase()];
      if (act) { e.preventDefault(); onFcAction(act); return; }
    }
    // 白板工具快捷键（1/V 选择 · H 抓手 · F 画框 · 2-0 图形 · K 激光笔）
    if (editor.mode === "whiteboard") {
      const wbKeys = { v: "select", "1": "select", h: "hand", f: "frame", "2": "rect", "3": "diamond", "4": "ellipse", "5": "arrow", "6": "line", "7": "pen", "8": "text", "9": "image", "0": "eraser", k: "laser" };
      const tool = wbKeys[e.key.toLowerCase()];
      if (tool) { e.preventDefault(); onWbTool(tool); return; }
    }
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

  editor = new Editor(document.getElementById("canvas"), { onChange: scheduleSave, onUndoRedoState: updateUndoRedoButtons, onToolChange: () => refreshWbActive(), mode: map.type || "mindmap" });
  editor.load(map.data);
  dirty = false; // 初始加载触发的 onChange 不算脏，避免无谓落盘
  lastSavedAt = map.updated_at || Date.now();
  setStatus("saved", "已保存");
  document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === editor.mode));
  if (editor.mode === "mindmap") ensureRoot();

  buildToolbar();
  buildThemes();
  wireChrome();
  wireExport();
  wireKeys();
})();
