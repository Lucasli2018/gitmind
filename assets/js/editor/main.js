// 编辑器入口：加载导图、自动保存、工具栏、主题、导出、分享、快捷键
import { Auth, getMap, saveMap, setShare, toast, fmtTime, fmtSize, byteLength } from "../api.js";
import { showFloatPanel, showModal } from "../ui.js";
import { ICONS } from "../icons.js";
import { Editor } from "./canvas.js";
import { FC_TOOLS } from "./flowchart.js";
import { WB_TOOLS, WB_MORE, WB_COLORS } from "./whiteboard.js";
import { openOutline } from "./outline.js";
import { exportSVG, exportPNG, exportJSON, importJSON, getExportSVG } from "./export.js";
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

// 同步顶栏与左下控制条 undo/redo 按钮的可用态
function updateUndoRedoButtons(canUndo, canRedo) {
  for (const id of ["undoBtn", "undoBtn2"]) {
    const u = document.getElementById(id);
    if (u) u.disabled = !canUndo;
  }
  for (const id of ["redoBtn", "redoBtn2"]) {
    const r = document.getElementById(id);
    if (r) r.disabled = !canRedo;
  }
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
  refreshWbStylePanel(); // 非白板模式会在函数内部自动隐藏属性面板
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
  if (act === "select") { editor.setTool("select"); refreshFcActive(); return; }
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
    const isSelect = b.dataset.act === "select" && editor.tool === "select";
    const isLink = b.dataset.act === "link" && editor.tool === "link";
    b.classList.toggle("active", isSelect || isLink);
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
      editor.wbProps.stroke = c; // 与属性面板保持同步
      colors.querySelectorAll(".gm-wb-color").forEach((el) => el.classList.toggle("active", el === s));
      if (editor.tool === "select") editor.setTool("pen"); // 选色后自动切画笔
      refreshWbActive();
      refreshWbStylePanel();
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

// ---------- 白板图形属性面板（左侧浮动，类 Excalidraw） ----------
// 背景色板（首项为透明）；描边色复用 WB_COLORS 与顶栏色板保持一致
const WB_BG_COLORS = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#d0bfff", "#ffffff"];
const WB_SHAPE_TOOLS = ["rect", "diamond", "ellipse", "arrow", "line", "pen", "text"];
function refreshWbStylePanel() {
  const panel = document.getElementById("wbStylePanel");
  if (!panel || !editor || editor.mode !== "whiteboard") { if (panel) panel.hidden = true; return; }
  // 文字模式：文字工具激活，或选中了单个文字节点 -> 显示文字专属面板
  const selNodes = [...editor.selection].map((id) => editor.nodeById(id)).filter(Boolean);
  const isText = editor.tool === "text" || (selNodes.length === 1 && selNodes[0].shape === "text");
  if (isText) { renderWbTextPanel(panel); return; }
  // 图形/画笔工具激活或选中了图形时显示
  const show = WB_SHAPE_TOOLS.includes(editor.tool) || editor.selection.size > 0;
  panel.hidden = !show;
  if (!show) return;
  const p = editor.getWbProps();
  const strokeSw = (c) => `<button class="gm-ws-swatch${c === p.stroke ? " active" : ""}" data-k="stroke" data-v="${c}" title="${c}" style="background:${c}"></button>`;
  const fillSw = (c) => `<button class="gm-ws-swatch${c === p.fill ? " active" : ""}" data-k="fill" data-v="${c}" title="${c === "transparent" ? "透明" : c}"><span class="gm-ws-fill" style="background:${c}"></span></button>`;
  const widthBtn = (v, lw) => `<button class="gm-ws-seg${p.strokeWidth === v ? " active" : ""}" data-k="strokeWidth" data-v="${v}" title="${v === 1 ? "细" : v === 2 ? "中" : "粗"}"><svg width="22" height="10"><line x1="2" y1="5" x2="20" y2="5" stroke="#1f2a37" stroke-width="${lw}" stroke-linecap="round"/></svg></button>`;
  const styleBtn = (v, t, dash) => `<button class="gm-ws-seg${p.strokeStyle === v ? " active" : ""}" data-k="strokeStyle" data-v="${v}" title="${t}"><svg width="22" height="10"><line x1="2" y1="5" x2="20" y2="5" stroke="#1f2a37" stroke-width="2"${dash}/></svg></button>`;
  const roughBtn = (v, t, d) => `<button class="gm-ws-seg${p.roughness === v ? " active" : ""}" data-k="roughness" data-v="${v}" title="${t}"><svg width="22" height="12"><path d="${d}" fill="none" stroke="#1f2a37" stroke-width="1.6" stroke-linecap="round"/></svg></button>`;
  panel.innerHTML =
    `<div class="gm-ws-t">描边</div>` +
    `<div class="gm-ws-row">${WB_COLORS.map(strokeSw).join("")}</div>` +
    `<div class="gm-ws-t">背景</div>` +
    `<div class="gm-ws-row">${WB_BG_COLORS.map(fillSw).join("")}</div>` +
    `<div class="gm-ws-t">描边宽度</div>` +
    `<div class="gm-ws-row seg">${widthBtn(1, 1.5) + widthBtn(2, 3) + widthBtn(4, 4.5)}</div>` +
    `<div class="gm-ws-t">边框样式</div>` +
    `<div class="gm-ws-row seg">${styleBtn("solid", "实线", "") + styleBtn("dashed", "虚线", ' stroke-dasharray="5 3"') + styleBtn("dotted", "点线", ' stroke-dasharray="0.5 3.5" stroke-linecap="round"')}</div>` +
    `<div class="gm-ws-t">线条风格</div>` +
    `<div class="gm-ws-row seg">${roughBtn(0, "圆滑", "M2,6 L20,6") + roughBtn(1, "手绘", "M2,6 Q7,3 11,6 T20,5") + roughBtn(2, "随性", "M2,6 Q6,2 10,7 T14,4 T20,6")}</div>` +
    `<div class="gm-ws-t">边角</div>` +
    `<div class="gm-ws-row seg">` +
      `<button class="gm-ws-seg${p.rounded ? " active" : ""}" data-k="rounded" data-v="true" title="圆角"><svg width="18" height="14"><path d="M3,13 L3,7 Q3,3 7,3 L13,3" fill="none" stroke="#1f2a37" stroke-width="2" stroke-linecap="round"/></svg></button>` +
      `<button class="gm-ws-seg${!p.rounded ? " active" : ""}" data-k="rounded" data-v="false" title="直角"><svg width="18" height="14"><path d="M3,13 L3,3 L13,3" fill="none" stroke="#1f2a37" stroke-width="2" stroke-linecap="round"/></svg></button>` +
    `</div>` +
    wbOpacityLayerHtml(p);
  wireWsPanelEvents(panel);
}

// 属性面板公共尾段：透明度滑杆 + 图层排序
function wbOpacityLayerHtml(p) {
  return `<div class="gm-ws-t">透明度 <span class="gm-ws-val">${Math.round(p.opacity * 100)}%</span></div>` +
    `<input type="range" class="gm-ws-range" min="10" max="100" step="5" value="${Math.round(p.opacity * 100)}" />` +
    `<div class="gm-ws-t">图层</div>` +
    `<div class="gm-ws-row seg">` +
      `<button class="gm-ws-seg" data-layer="front" title="置于顶层"><svg width="16" height="16"><path d="M8,1 L11,5 L5,5 Z" fill="#1f2a37"/><rect x="4" y="8" width="8" height="6" rx="1.5" fill="none" stroke="#1f2a37" stroke-width="1.6"/></svg></button>` +
      `<button class="gm-ws-seg" data-layer="forward" title="上移一层"><svg width="16" height="16"><path d="M4,10 L8,5 L12,10" fill="none" stroke="#1f2a37" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="4" y="12" width="8" height="2.5" rx="1" fill="#1f2a37"/></svg></button>` +
      `<button class="gm-ws-seg" data-layer="backward" title="下移一层"><svg width="16" height="16"><path d="M4,6 L8,11 L12,6" fill="none" stroke="#1f2a37" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="4" y="1.5" width="8" height="2.5" rx="1" fill="#1f2a37"/></svg></button>` +
      `<button class="gm-ws-seg" data-layer="back" title="置于底层"><svg width="16" height="16"><rect x="4" y="2" width="8" height="6" rx="1.5" fill="none" stroke="#1f2a37" stroke-width="1.6"/><path d="M8,15 L5,11 L11,11 Z" fill="#1f2a37"/></svg></button>` +
    `</div>`;
}

// 属性面板公共事件绑定：属性键 / 图层 / 透明度滑杆（拖动实时预览不记历史，松手落一次历史）
function wireWsPanelEvents(panel) {
  panel.querySelectorAll("[data-k]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.k, v = b.dataset.v;
      const NUM_KEYS = ["strokeWidth", "roughness", "fontSize"];
      const val = k === "rounded" ? v === "true" : NUM_KEYS.includes(k) ? Number(v) : v;
      editor.setWbProps({ [k]: val });
      refreshWbStylePanel();
      if (k === "stroke") refreshWbActive(); // 同步顶栏色板高亮
    });
  });
  panel.querySelectorAll("[data-layer]").forEach((b) => {
    b.addEventListener("click", () => { editor._reorderLayer(b.dataset.layer); refreshWbStylePanel(); });
  });
  const range = panel.querySelector(".gm-ws-range");
  if (range) {
    range.addEventListener("input", () => {
      panel.querySelector(".gm-ws-val").textContent = range.value + "%";
      editor.setWbProps({ opacity: Number(range.value) / 100 }, false);
    });
    range.addEventListener("change", () => editor.setWbProps({ opacity: Number(range.value) / 100 }, true));
  }
}

// 白板文字属性面板（文字工具激活 / 选中文字节点时显示）：
// 文字颜色 / 字体大小(S M L XL) / 字体(无衬线·衬线·代码) / 样式(正常·斜体) / 对齐 / 透明度 / 图层
function renderWbTextPanel(panel) {
  const p = editor.getWbProps();
  panel.hidden = false;
  const colorSw = (c) => `<button class="gm-ws-swatch${c === p.stroke ? " active" : ""}" data-k="stroke" data-v="${c}" title="${c}" style="background:${c}"></button>`;
  const sizeBtn = (v, t) => `<button class="gm-ws-seg${p.fontSize === v ? " active" : ""}" data-k="fontSize" data-v="${v}">${t}</button>`;
  const famBtn = (v, t, st) => `<button class="gm-ws-seg${p.fontFamily === v ? " active" : ""}" data-k="fontFamily" data-v="${v}" style="${st}">${t}</button>`;
  const styleBtn = (v, t) => `<button class="gm-ws-seg${p.fontStyle === v ? " active" : ""}" data-k="fontStyle" data-v="${v}">${t}</button>`;
  const alignBtn = (v, svg) => `<button class="gm-ws-seg${p.textAlign === v ? " active" : ""}" data-k="textAlign" data-v="${v}" title="${v === "left" ? "左对齐" : v === "right" ? "右对齐" : "居中"}">${svg}</button>`;
  panel.innerHTML =
    `<div class="gm-ws-t">文字颜色</div>` +
    `<div class="gm-ws-row">${WB_COLORS.map(colorSw).join("")}</div>` +
    `<div class="gm-ws-t">字体大小</div>` +
    `<div class="gm-ws-row seg">${sizeBtn(14, "S") + sizeBtn(18, "M") + sizeBtn(24, "L") + sizeBtn(32, "XL")}</div>` +
    `<div class="gm-ws-t">字体</div>` +
    `<div class="gm-ws-row seg">${famBtn("sans", "A", "font-weight:600") + famBtn("serif", "A", "font-family:Georgia,serif;font-weight:600") + famBtn("code", "&lt;/&gt;", "font-family:monospace;font-weight:600")}</div>` +
    `<div class="gm-ws-t">样式</div>` +
    `<div class="gm-ws-row seg">${styleBtn("normal", "正常") + styleBtn("italic", "<i>斜体</i>")}</div>` +
    `<div class="gm-ws-t">文本对齐</div>` +
    `<div class="gm-ws-row seg">` +
      alignBtn("left", `<svg width="16" height="12"><path d="M1,2 h14 M1,6 h9 M1,10 h12" stroke="#1f2a37" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`) +
      alignBtn("center", `<svg width="16" height="12"><path d="M1,2 h14 M3.5,6 h9 M2,10 h12" stroke="#1f2a37" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`) +
      alignBtn("right", `<svg width="16" height="12"><path d="M1,2 h14 M6,6 h9 M3,10 h12" stroke="#1f2a37" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`) +
    `</div>` +
    wbOpacityLayerHtml(p);
  wireWsPanelEvents(panel);
}

// ---------- 白板右键菜单 ----------
let wbClipboard = [];   // 白板内部剪贴板（节点深拷贝）
let wbMenuPos = null;   // 最近一次右键位置（屏幕坐标），粘贴到鼠标处用

function wireWbContextMenu() {
  editor.container.addEventListener("contextmenu", (e) => {
    if (editor.mode !== "whiteboard") return;
    e.preventDefault();
    wbMenuPos = { x: e.clientX, y: e.clientY };
    // 右键命中节点：纳入选中（不在多选内则单选）
    const hit = e.target.closest && e.target.closest("[data-id]");
    if (hit) {
      const id = hit.getAttribute("data-id");
      if (!editor.selection.has(id)) editor.selection = new Set([id]);
      editor.render();
    } else {
      editor.clearSelection();
    }
    showWbMenu(e.clientX, e.clientY);
  });
  // 点击其他区域 / 滚动 / 失焦关闭
  window.addEventListener("pointerdown", (e) => { if (!e.target.closest || !e.target.closest(".gm-ctx-menu")) hideWbMenu(); }, true);
  window.addEventListener("wheel", hideWbMenu, { passive: true });
  window.addEventListener("blur", hideWbMenu);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hideWbMenu(); });
}
function hideWbMenu() {
  const m = document.querySelector(".gm-ctx-menu");
  if (m) m.remove();
}
function showWbMenu(x, y) {
  hideWbMenu();
  const hasSel = editor.selection.size > 0;
  const items = [];
  if (wbClipboard.length) items.push({ label: "粘贴", kbd: "Ctrl+V", act: () => pasteWbClipboard() });
  if (hasSel) items.push({ label: "复制", kbd: "Ctrl+C", act: copyWbSelection });
  items.push({ label: "复制为 PNG 到剪贴板", kbd: "Shift+Alt+C", act: () => copyWbExport(true) });
  items.push({ label: "复制为 SVG 到剪贴板", act: () => copyWbExport(false) });
  items.push({ sep: true });
  items.push({ label: "全部选中", kbd: "Ctrl+A", keep: true, act: wbSelectAll });
  items.push({ label: (editor.showGrid ? "✓ " : "") + "显示网格", kbd: "Ctrl+'", keep: true, act: () => editor.toggleGrid() });
  if (hasSel) {
    items.push({ sep: true });
    items.push({ label: "置于顶层", act: () => editor._reorderLayer("front") });
    items.push({ label: "置于底层", act: () => editor._reorderLayer("back") });
    items.push({ label: "删除", kbd: "Del", act: () => editor.deleteSelection() });
  }
  items.push({ sep: true });
  items.push({ label: "详细统计信息", kbd: "Alt+/", act: wbStats });
  const menu = document.createElement("div");
  menu.className = "gm-ctx-menu";
  for (const it of items) {
    if (it.sep) { const s = document.createElement("div"); s.className = "gm-ctx-sep"; menu.appendChild(s); continue; }
    const b = document.createElement("button");
    b.innerHTML = `<span class="lbl">${it.label}</span>${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ""}`;
    b.addEventListener("click", () => { it.act(); if (it.keep) showWbMenu(x, y); else hideWbMenu(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  // 视口边界修正
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 8)) + "px";
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 8)) + "px";
}
function wbSelectAll() {
  editor.selection = new Set(editor.doc.nodes.map((n) => n.id));
  editor.render();
}
function copyWbSelection() {
  const sel = new Set(editor.selection);
  wbClipboard = editor.doc.nodes.filter((n) => sel.has(n.id)).map((n) => JSON.parse(JSON.stringify(n)));
  if (wbClipboard.length) toast(`已复制 ${wbClipboard.length} 个图形`, "info");
}
function pasteWbClipboard() {
  if (!wbClipboard.length) return;
  // 有右键位置时贴到鼠标处，否则右下偏移 24
  let minX = Infinity, minY = Infinity;
  for (const n of wbClipboard) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
  const world = wbMenuPos ? editor.toWorld(wbMenuPos.x, wbMenuPos.y) : null;
  const pasted = wbClipboard.map((n) => {
    const c = JSON.parse(JSON.stringify(n));
    c.id = crypto.randomUUID ? crypto.randomUUID() : "n" + Math.random().toString(36).slice(2);
    c.x = world ? world.x + (n.x - minX) : n.x + 24;
    c.y = world ? world.y + (n.y - minY) : n.y + 24;
    return c;
  });
  editor.doc.nodes.push(...pasted);
  editor.selection = new Set(pasted.map((n) => n.id));
  editor.render(); editor.onChange(); editor.pushHistory();
  toast(`已粘贴 ${pasted.length} 个图形`, "info");
}
// 导出当前选择（无选择则导出整块画布）为 SVG 字符串
function wbExportSVG() {
  if (!editor.selection.size) return getExportSVG(editor);
  const doc = editor.doc;
  const sel = new Set(editor.selection);
  const clone = { ...doc, nodes: doc.nodes.filter((n) => sel.has(n.id)), strokes: [], edges: doc.edges.filter((e) => sel.has(e.from) && sel.has(e.to)) };
  editor.doc = clone;
  const r = getExportSVG(editor);
  editor.doc = doc;
  editor.render();
  return r;
}
async function copyWbExport(asPng) {
  const r = wbExportSVG();
  if (!r) { toast("画布为空", "error"); return; }
  try {
    if (asPng) {
      const svgBlob = new Blob([r.svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = r.w * scale; canvas.height = r.h * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const pngBlob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    } else {
      const svgBlob = new Blob([r.svg], { type: "image/svg+xml;charset=utf-8" });
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/svg+xml": svgBlob })]);
      } catch (_) {
        await navigator.clipboard.writeText(r.svg); // SVG 写入不被支持时降级为文本
      }
    }
    toast("已复制到剪贴板", "info");
  } catch (e) {
    toast("复制失败：" + (e.message || e), "error");
  }
}
function wbStats() {
  const d = editor.doc;
  const bytes = byteLength(JSON.stringify(d));
  let histBytes = 0;
  try { for (const s of editor._history) histBytes += byteLength(JSON.stringify(s)); } catch (_) {}
  const b = editor.getBounds();
  const row = (l, v) => `<div class="gm-fp-row"><span>${l}</span><b>${v}</b></div>`;
  showFloatPanel("详细统计信息",
    `<div class="gm-fp-sec">画布</div>` +
    row("元素", d.nodes.length + d.strokes.length + d.edges.length) +
    row("宽度", b ? Math.round(b.w) : 0) +
    row("高度", b ? Math.round(b.h) : 0) +
    `<div class="gm-fp-sec">存储</div>` +
    row("画布", fmtSize(bytes)) +
    row("总计", fmtSize(bytes + histBytes)));
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
      `直线/箭头选中：拖端点移动 · 拖中点弯曲<br/>` +
      `Shift + 拖拽：直线 / 箭头吸附 45°<br/>` +
      `框选：空白处左键拖拽（Shift 叠加）<br/>` +
      `删除：Delete / Backspace<br/>` +
      `撤销：Ctrl/⌘ + Z · 重做：Ctrl+Y<br/>` +
      `平移：中键拖拽 / Alt+拖拽 / 抓手<br/>` +
      `缩放：滚轮 · 保存：Ctrl/⌘ + S`;
  } else if (editor.mode === "flowchart") {
    el.innerHTML =
      `选择 V（空白拖拽框选多个节点）<br/>` +
      `矩形 1 · 圆角 2 · 判断 3<br/>` +
      `椭圆 4 · 平行四边形 5 · 文本 6<br/>` +
      `图片 7 · 关联线 L（点起点再点目标）<br/>` +
      `连线：拖节点上下端口到目标节点<br/>` +
      `删除：Delete / Backspace<br/>` +
      `撤销：Ctrl/⌘ + Z · 重做：Ctrl+Y<br/>` +
      `平移：中键拖拽 / Alt+拖拽 · 缩放：滚轮<br/>` +
      `保存：Ctrl/⌘ + S`;
  } else {
    el.innerHTML =
      `脑图：Tab 加子节点 · Enter 加兄弟<br/>` +
      `框选：空白处左键拖拽（Shift 叠加）<br/>` +
      `删除：Delete / Backspace<br/>` +
      `撤销：Ctrl/⌘ + Z · 重做：Ctrl+Y / ⌘+Shift+Z<br/>` +
      `平移：中键拖拽 / Alt+拖拽 · 缩放：滚轮<br/>` +
      `保存：Ctrl/⌘ + S`;
  }
}

// ---------- 快捷键弹框（右下角 ? 按钮） ----------
const SHORTCUTS = {
  whiteboard: {
    工具: [
      ["选择", ["V", "或", "1"]], ["抓手", ["H"]], ["画框", ["F"]],
      ["矩形", ["2"]], ["菱形", ["3"]], ["圆形", ["4"]], ["箭头", ["5"]], ["直线", ["6"]],
      ["画笔", ["7"]], ["文字", ["8"]], ["图片", ["9"]], ["橡皮", ["0"]], ["激光笔", ["K"]],
    ],
    编辑器: [
      ["移动画布", ["中键拖拽", "/", "Alt+拖拽"]], ["缩放", ["滚轮"]], ["重置缩放", ["点击 100%"]],
      ["框选多选", ["拖空白处", "或", "Shift+拖"]], ["直线变换", ["拖端点 / 中点"]], ["删除", ["Delete"]],
      ["复制 / 粘贴", ["Ctrl+C", "/", "V"]], ["全部选中", ["Ctrl+A"]], ["显示网格", ["Ctrl+'"]],
      ["复制为 PNG", ["Shift+Alt+C"]], ["统计信息", ["Alt+/"]],
      ["撤销 / 重做", ["Ctrl+Z", "/", "Ctrl+Y"]], ["保存", ["Ctrl+S"]],
    ],
  },
  flowchart: {
    工具: [
      ["选择", ["V"]], ["矩形", ["1"]], ["圆角", ["2"]], ["判断", ["3"]], ["椭圆", ["4"]],
      ["平行四边形", ["5"]], ["文本", ["6"]], ["图片", ["7"]], ["关联线", ["L"]],
    ],
    编辑器: [
      ["框选多选", ["拖空白处", "或", "Shift+拖"]], ["连线", ["拖节点端口"]],
      ["移动画布", ["中键拖拽", "或", "Alt+拖拽"]], ["缩放", ["滚轮"]],
      ["重置缩放", ["点击 100%"]], ["删除", ["Delete"]],
      ["撤销 / 重做", ["Ctrl+Z", "/", "Ctrl+Y"]], ["保存", ["Ctrl+S"]],
    ],
  },
  mindmap: {
    工具: [["加子节点", ["Tab"]], ["加兄弟节点", ["Enter"]]],
    编辑器: [
      ["框选多选", ["拖空白处", "或", "Shift+拖"]],
      ["移动画布", ["中键拖拽", "或", "Alt+拖拽"]], ["缩放", ["滚轮"]], ["重置缩放", ["点击 100%"]],
      ["删除", ["Delete"]], ["撤销 / 重做", ["Ctrl+Z", "/", "Ctrl+Y"]], ["保存", ["Ctrl+S"]],
    ],
  },
};
function openShortcutsModal() {
  const sc = SHORTCUTS[editor.mode] || SHORTCUTS.mindmap;
  const col = (name, rows) =>
    `<div class="gm-sc-col"><h4>${name}</h4>` +
    rows.map(([l, kbds]) =>
      `<div class="gm-sc-row"><span>${l}</span><span class="gm-sc-kbd">` +
      kbds.map((k) => (k === "或" || k === "/" ? `<em>${k}</em>` : `<kbd>${k}</kbd>`)).join("") +
      `</span></div>`).join("") +
    `</div>`;
  const keys = Object.keys(sc);
  showModal("快捷键列表", `<div class="gm-sc-grid">${keys.map((k) => col(k, sc[k])).join("")}</div>`);
}

// ---------- 左下角控制条（缩放 / 撤销重做）+ 右栏收起 ----------
function wireBottomBars() {
  const center = () => { const r = editor.rect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  document.getElementById("zoomOut2").addEventListener("click", () => { const [x, y] = center(); editor.zoomAt(1 / 1.2, x, y); });
  document.getElementById("zoomIn2").addEventListener("click", () => { const [x, y] = center(); editor.zoomAt(1.2, x, y); });
  document.getElementById("zoomPct").addEventListener("click", () => { const [x, y] = center(); editor.zoomAt(1 / editor.view.scale, x, y); });
  document.getElementById("undoBtn2").addEventListener("click", () => editor.undo());
  document.getElementById("redoBtn2").addEventListener("click", () => editor.redo());
  const pct = document.getElementById("zoomPct");
  setInterval(() => {
    const v = Math.round(editor.view.scale * 100) + "%";
    if (pct.textContent !== v) pct.textContent = v;
  }, 250);
  // 右下角 ? 快捷键弹框
  document.getElementById("helpFab").addEventListener("click", openShortcutsModal);
  // 右侧说明栏收起（localStorage 记忆）
  const st = document.getElementById("sideToggle");
  const applySide = () => {
    const hidden = localStorage.getItem("gm_side_hidden") === "1";
    document.body.classList.toggle("gm-side-hidden", hidden);
    st.textContent = hidden ? "«" : "›";
    st.title = hidden ? "展开侧栏" : "收起侧栏";
  };
  st.addEventListener("click", () => {
    localStorage.setItem("gm_side_hidden", document.body.classList.contains("gm-side-hidden") ? "0" : "1");
    applySide();
  });
  applySide();
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
  wireBottomBars();
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
    // 流程图工具快捷键（V 选择 / 1-6 图形 / 7 图片 / L 关联线）
    if (editor.mode === "flowchart") {
      const fcKeys = { v: "select", "1": "shape:rect", "2": "shape:rounded", "3": "shape:diamond", "4": "shape:ellipse", "5": "shape:parallelogram", "6": "shape:text", "7": "image", l: "link" };
      const act = fcKeys[e.key.toLowerCase()];
      if (act) { e.preventDefault(); onFcAction(act); return; }
    }
    // 白板工具快捷键（1/V 选择 · H 抓手 · F 画框 · 2-0 图形 · K 激光笔）
    if (editor.mode === "whiteboard") {
      const wbKeys = { v: "select", "1": "select", h: "hand", f: "frame", "2": "rect", "3": "diamond", "4": "ellipse", "5": "arrow", "6": "line", "7": "pen", "8": "text", "9": "image", "0": "eraser", k: "laser" };
      const tool = wbKeys[e.key.toLowerCase()];
      if (tool) { e.preventDefault(); onWbTool(tool); return; }
      // 白板剪贴板 / 全选 / 网格 / 复制导出 / 统计
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { e.preventDefault(); copyWbSelection(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") { e.preventDefault(); pasteWbClipboard(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); wbSelectAll(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "'") { e.preventDefault(); editor.toggleGrid(); return; }
      if (e.shiftKey && e.altKey && e.key.toLowerCase() === "c") { e.preventDefault(); copyWbExport(true); return; }
      if (e.altKey && e.key === "/") { e.preventDefault(); wbStats(); return; }
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

  editor = new Editor(document.getElementById("canvas"), { onChange: scheduleSave, onUndoRedoState: updateUndoRedoButtons, onToolChange: () => { refreshWbActive(); refreshWbStylePanel(); }, onSelectionChange: () => refreshWbStylePanel(), mode: map.type || "mindmap" });
  window.__gmEditor = editor; // 测试钩子：headless 验证用
  wireWbContextMenu();
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
