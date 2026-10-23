// 编辑器入口：加载导图、自动保存、工具栏、主题、导出、分享、快捷键
import { Auth, getMap, saveMap, setShare, toast, fmtTime, fmtSize, byteLength } from "../api.js";
import { showFloatPanel, showModal, confirmDialog } from "../ui.js";
import { ICONS } from "../icons.js";
import { Editor } from "./canvas.js";
import { FC_TOOLS } from "./flowchart.js";
import { WB_TOOLS, WB_MORE, WB_COLORS } from "./whiteboard.js";
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
// 左下控制条的撤销/重做按钮只显示图标（editor.html 中为空按钮，需在此填充）
document.getElementById("undoBtn2").innerHTML = ICONS.undo;
document.getElementById("redoBtn2").innerHTML = ICONS.redo;

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
  // 白板 / 流程图 / 脑图模式切换 body 类：隐藏左侧工具栏与脑图专属面板，启用顶部浮动工具栏
  document.body.classList.toggle("gm-wb-mode", mode === "whiteboard" || mode === "flowchart");
  if (wbBar) wbBar.hidden = !(mode === "whiteboard" || mode === "flowchart" || mode === "mindmap");
  refreshWbStylePanel(); // 非白板模式会在函数内部自动隐藏属性面板
  if (mode === "mindmap" && wbBar) {
    buildMmBar(wbBar); // 脑图顶部工具栏（参考 mind-map）：节点操作 + 图片/图标/超链接/备注 + 关联线
  } else if (mode === "flowchart" && wbBar) {
    buildFcBar(wbBar);
  } else if (mode === "whiteboard" && wbBar) {
    buildWbBar(wbBar);
  }
  updateHelpKeys();
}

// 脑图顶部工具栏（图标在上文字在下，参考 mind-map）
const MM_TOOLS = [
  { act: "undo", label: "回退", icon: "undo" },
  { act: "redo", label: "前进", icon: "redo" },
  { act: "hand", label: "抓手", icon: "hand", key: "H" },

  { act: "child", label: "子节点", icon: "plus", key: "Tab" },
  { act: "sibling", label: "同级节点", icon: "plus", key: "Enter" },
  { act: "delete", label: "删除节点", icon: "trash" },

  { act: "image", label: "图片", icon: "image" },
  { act: "icon", label: "图标", icon: "smiley" },
  { act: "href", label: "超链接", icon: "link" },
  { act: "note", label: "备注", icon: "note" },

  { act: "summary", label: "概括", icon: "summary" },
  { act: "frame", label: "外框", icon: "frameBox" },
  { act: "link", label: "关联线", icon: "assoc", key: "L" },
  { act: "layout", label: "整理布局", icon: "fit" },
];
const MM_EMOJIS = ["💡", "⭐", "🔥", "✅", "❌", "❓", "❗", "🎯", "📌", "🚩", "🚀", "⏰", "📅", "👤", "💰", "📄", "📊", "🔑", "🔒", "🧠", "😊", "🎉", "⚠️", "❤️"];
// ---------- 工具栏弹层（挂到 body，修复被 .gm-wb-bar overflow 裁剪的问题） ----------
let _bodyPop = null; // { anchor, el }
function closeBodyPop() {
  if (_bodyPop) { _bodyPop.el.remove(); _bodyPop = null; }
}
// 在锚点按钮下方弹出一个浮层（重复点同一个锚点 = 关闭；点其他区域自动关）
function toggleBodyPop(anchor, pop) {
  if (_bodyPop && _bodyPop.anchor === anchor) { closeBodyPop(); return; }
  closeBodyPop();
  pop.classList.add("gm-body-pop");
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8));
  pop.style.left = left + "px";
  pop.style.top = Math.min(r.bottom + 8, window.innerHeight - pop.offsetHeight - 8) + "px";
  _bodyPop = { anchor, el: pop };
}
function buildMmBar(bar) {
  bar.innerHTML = "";
  bar.classList.add("gm-fc-bar");
  const groupOf = (act) => (act === "undo" || act === "redo" || act === "hand" ? 1
    : act === "child" || act === "sibling" || act === "delete" ? 2
    : act === "image" || act === "icon" || act === "href" || act === "note" || act === "summary" || act === "frame" ? 3 : 4);
  let lastGroup = null;
  for (const t of MM_TOOLS) {
    const group = groupOf(t.act);
    if (lastGroup !== null && group !== lastGroup) bar.appendChild(wbSep());
    lastGroup = group;
    const b = document.createElement("button");
    b.className = "gm-fc-btn";
    b.dataset.act = t.act;
    b.title = t.key ? `${t.label} (${t.key})` : t.label;
    b.innerHTML = `${ICONS[t.icon] || ""}<span class="lbl">${t.label}</span>`;
    if (t.act === "icon") {
      // 图标按钮：emoji 网格弹层（挂 body 避免被工具栏裁剪），再点同一个 emoji 取消
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const pop = document.createElement("div");
        pop.className = "gm-emoji-pop";
        for (const em of MM_EMOJIS) {
          const it = document.createElement("button");
          it.textContent = em;
          it.addEventListener("click", (ev) => { ev.stopPropagation(); closeBodyPop(); onMmAction("icon", em); });
          pop.appendChild(it);
        }
        toggleBodyPop(b, pop);
      });
      bar.appendChild(b);
      continue;
    }
    b.addEventListener("click", () => onMmAction(t.act));
    bar.appendChild(b);
  }
  refreshFcActive();
}
function onMmAction(act, arg) {
  const selId = [...editor.selection][0];
  const node = selId ? editor.nodeById(selId) : null;
  const needNode = () => { if (!node) toast("请先选中一个节点", "info"); return !node; };
  if (act === "undo") { editor.undo(); return; }
  if (act === "redo") { editor.redo(); return; }
  if (act === "hand") { editor.setTool(editor.tool === "hand" ? "select" : "hand"); refreshFcActive(); return; }
  if (act === "delete") { editor.deleteSelection(); return; }
  if (act === "layout") { layoutMindmap(editor.doc); editor.render(); editor.fitView(true); editor.onChange(); return; }
  if (act === "child") { if (selId) editor.addMindmapChild(selId); else ensureRoot(); return; }
  if (act === "sibling") { if (!needNode()) editor.addMindmapSibling(selId); return; }
  if (act === "image") { if (!needNode()) document.getElementById("wbImageFile").click(); return; }
  if (act === "icon") {
    if (needNode()) return;
    editor.setNodeStyle({ icon: node.icon === arg ? null : arg });
    return;
  }
  if (act === "href") {
    if (needNode()) return;
    const url = prompt("输入超链接地址（留空移除）", node.href || "https://");
    if (url === null) return;
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) { toast("请输入 http(s):// 开头的网址", "error"); return; }
    editor.setNodeStyle({ href: url.trim() || null });
    return;
  }
  if (act === "note") {
    if (needNode()) return;
    openNoteModal(node);
    return;
  }
  if (act === "summary") {
    const ids = selectedNodeIds();
    if (!ids.length) { toast("请先选中要概括的节点（可框选 / 多选）", "info"); return; }
    const g = editor.addGroup("summary", ids);
    openGroupModal(g.id);
    return;
  }
  if (act === "frame") {
    const ids = selectedNodeIds();
    if (!ids.length) { toast("请先选中要框选的节点（可框选 / 多选）", "info"); return; }
    const g = editor.addGroup("frame", ids);
    openGroupModal(g.id);
    return;
  }
  if (act === "link") {
    editor.setTool(editor.tool === "link" ? "select" : "link");
    refreshFcActive();
    if (editor.tool === "link") toast("关联线：先点起始节点，再点目标节点", "info");
  }
}

// ---------- 备注 / 概括 弹框（输入与展示都用居中模态） ----------
function escapeModalText(s) {
  return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// ---------- 图片压缩：默认压到 maxBytes 以内（按 原大小/上限 自动算缩放与质量） ----------
// 返回 Promise<dataURL>。noCompress=true 时原样返回（设置项“上传图片不压缩”）。
const IMG_MAX_BYTES = 100 * 1024; // 100KB
function _dataUrlBytes(u) {
  const i = u.indexOf(",");
  const b64 = i >= 0 ? u.slice(i + 1) : u;
  return Math.floor(b64.length * 3 / 4);
}
function compressImageDataURL(dataURL, { maxBytes = IMG_MAX_BYTES, noCompress = false } = {}) {
  return new Promise((resolve) => {
    if (noCompress) { resolve(dataURL); return; }
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || 1000, nh = img.naturalHeight || 1000;
      // 先按像素上限收敛（避免超大图内存/体积爆炸），再按体积迭代降质
      const MAX_DIM = 2000;
      let scale = nw > MAX_DIM || nh > MAX_DIM ? MAX_DIM / Math.max(nw, nh) : 1;
      let quality = 0.9;
      const tryRender = () => {
        const w = Math.max(1, Math.round(nw * scale)), h = Math.max(1, Math.round(nh * scale));
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // 白底，兼容带透明通道的图片
        ctx.drawImage(img, 0, 0, w, h);
        const out = cv.toDataURL("image/jpeg", quality);
        if (_dataUrlBytes(out) <= maxBytes || (scale <= 0.2 && quality <= 0.5)) { resolve(out); return; }
        if (quality > 0.5) quality -= 0.1;            // 先降质量
        else { scale *= 0.82; quality = 0.85; }        // 质量到底再降尺寸
        if (scale < 0.1) { resolve(out); return; }
        tryRender();
      };
      tryRender();
    };
    img.onerror = () => resolve(dataURL); // 解码失败则回退原图
    img.src = dataURL;
  });
}

// ---------- 图片放大灯箱（点击图片查看大图，点击空白处关闭） ----------
function openImageLightbox(src) {
  if (!src) return;
  const mask = document.createElement("div");
  mask.className = "gm-lightbox";
  mask.innerHTML = `<button class="gm-lb-x" aria-label="关闭">×</button><img src="${escapeModalText(src)}" alt="图片预览"/><div class="gm-lb-hint">点击空白处关闭</div>`;
  const close = () => { mask.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  mask.addEventListener("click", (e) => { if (e.target === mask || e.target.classList.contains("gm-lb-x")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(mask);
}
function openNoteModal(node) {
  const close = showModal("备注",
    `<textarea id="gmNoteTa" class="gm-note-ta" placeholder="输入备注内容…（留空保存则移除备注）">${escapeModalText(node.note || "")}</textarea>` +
    `<div class="gm-modal-acts" style="margin-top:14px">` +
    `<button class="btn btn-ghost btn-sm" id="gmNoteDel">删除备注</button>` +
    `<button class="btn gm-btn-coral btn-sm" id="gmNoteSave">保存</button></div>`);
  const ta = document.getElementById("gmNoteTa");
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  document.getElementById("gmNoteSave").addEventListener("click", () => {
    editor.updateNodeById(node.id, { note: ta.value.trim() || null });
    toast(ta.value.trim() ? "备注已保存，点击节点右上角「注」徽标可再次查看" : "已移除备注", "success");
    close();
  });
  document.getElementById("gmNoteDel").addEventListener("click", () => {
    editor.updateNodeById(node.id, { note: null });
    toast("已移除备注", "info");
    close();
  });
}
// 外框 / 概括 编辑弹框：标题 + 颜色 + 删除（双击分组或工具栏创建后弹出）
function openGroupModal(gid) {
  const g = editor.groupById(gid);
  if (!g) return;
  const isFrame = g.kind === "frame";
  const swatches = ["#aab3bf", "#2f80ed", "#11b5a4", "#f5a623", "#ef4444", "#8b5cf6", "#1f2a37"];
  const sw = (c) => `<button class="gm-ws-swatch${c === g.stroke ? " active" : ""}" data-gc="${c}" title="${c}" style="background:${c}"></button>`;
  const close = showModal(isFrame ? "外框" : "概括",
    `<div style="font-size:13px;color:#6b7686;margin-bottom:8px">${isFrame ? "虚线框圈住所选节点，双击可再次编辑" : "大括号 + 标签标注在所选节点右侧，双击可再次编辑"}</div>` +
    `<div class="gm-ws-t">标题</div>` +
    `<input id="gmGroupText" class="gm-note-ta" style="min-height:0;padding:9px 12px" maxlength="20" placeholder="${isFrame ? "可选标题" : "概要"}" value="${escapeModalText(g.text || "")}" />` +
    `<div class="gm-ws-t">颜色</div>` +
    `<div class="gm-ws-row">${swatches.map(sw).join("")}</div>` +
    `<div class="gm-modal-acts" style="margin-top:14px">` +
    `<button class="btn btn-ghost btn-sm" id="gmGroupDel">删除${isFrame ? "外框" : "概括"}</button>` +
    `<button class="btn gm-btn-coral btn-sm" id="gmGroupSave">完成</button></div>`);
  const inp = document.getElementById("gmGroupText");
  setTimeout(() => { inp.focus(); }, 0);
  document.querySelectorAll("[data-gc]").forEach((b) => b.addEventListener("click", () => {
    editor.updateGroup(gid, { stroke: b.dataset.gc });
    document.querySelectorAll("[data-gc]").forEach((x) => x.classList.toggle("active", x.dataset.gc === b.dataset.gc));
  }));
  document.getElementById("gmGroupSave").addEventListener("click", () => {
    editor.updateGroup(gid, { text: inp.value.trim() });
    close();
  });
  document.getElementById("gmGroupDel").addEventListener("click", () => {
    editor.removeGroup(gid);
    toast(`已删除${isFrame ? "外框" : "概括"}`, "info");
    close();
  });
}

// ---------- 脑图节点样式面板（左侧浮动，选中节点时显示，参考 mind-map 节点样式） ----------
const MM_TEXT_COLORS = ["#1f2a37", "#e03131", "#2f80ed", "#0b7d73", "#f59f00", "#7048e8"];
const MM_BG_COLORS = ["#ffffff", "#fff3bf", "#ffe3e3", "#d3f9d8", "#d0ebff", "#e5dbff", "transparent"];
const MM_STROKE_COLORS = ["#94a3b8", "#1f2a37", "#e03131", "#2f80ed", "#0b7d73", "#f59f00", "#7048e8"];
// 连线编辑弹框（替代原生 prompt）：文字 / 颜色 / 线宽 / 线型 / 箭头 / 删除
// 支持脑图派生连线（label 存于子节点 edgeLabel）
function openEdgeModal(eid, derivedChildId) {
  const e = eid ? editor.edgeById(eid) : null;
  const dChild = derivedChildId ? editor.nodeById(derivedChildId) : null;
  if (!e && !dChild) return;
  const derived = !e && !!dChild;
  const cur = {
    stroke: derived ? (dChild.stroke || "#11b5a4") : (e.stroke || (e.assoc ? "#ff9f43" : (e.derived ? "#11b5a4" : "#94a3b8"))),
    strokeWidth: derived ? 2 : (e.strokeWidth || 2),
    strokeStyle: derived ? "solid" : (e.strokeStyle || (e.assoc ? "dashed" : "solid")),
    label: derived ? (dChild.edgeLabel || "") : (e.label || ""),
  };
  const cols = ["#94a3b8", "#11b5a4", "#ff9f43", "#ef4444", "#3b82f6", "#8b5cf6", "#1f2a37"];
  const colBtn = (c) => `<button class="gm-ws-swatch${c === cur.stroke ? " active" : ""}" data-ek="stroke" data-ev="${c}" title="${c}" style="background:${c}"></button>`;
  const wBtn = (v) => `<button class="gm-ws-seg${cur.strokeWidth === v ? " active" : ""}" data-ek="strokeWidth" data-ev="${v}"><svg width="22" height="10"><line x1="2" y1="5" x2="20" y2="5" stroke="#1f2a37" stroke-width="${v}"/></svg></button>`;
  const sBtn = (v, dash) => `<button class="gm-ws-seg${cur.strokeStyle === v ? " active" : ""}" data-ek="strokeStyle" data-ev="${v}"><svg width="22" height="10"><line x1="2" y1="5" x2="20" y2="5" stroke="#1f2a37" stroke-width="2"${dash}/></svg></button>`;
  const arrowRow = derived || (e && e.derived) ? "" :
    `<div class="gm-ws-t">箭头</div><div class="gm-ws-row seg"><button class="gm-ws-seg${(e.arrow || e.arrow === null ? " active" : "")}" data-ek="arrow" data-ev="1" title="带箭头">→</button><button class="gm-ws-seg${(e.arrow === false ? " active" : "")}" data-ek="arrow" data-ev="0" title="无箭头">—</button></div>`;
  const close = showModal("连线",
    `<div class="gm-ws-t">连线文字</div>` +
    `<input id="gmEdgeLabel" class="gm-note-ta" style="min-height:0;padding:9px 12px" maxlength="40" placeholder="可选文字" value="${escapeModalText(cur.label)}" />` +
    `<div class="gm-ws-t">颜色</div><div class="gm-ws-row">${cols.map(colBtn).join("")}</div>` +
    `<div class="gm-ws-t">线宽</div><div class="gm-ws-row seg">${wBtn(2) + wBtn(4) + wBtn(6)}</div>` +
    `<div class="gm-ws-t">线型</div><div class="gm-ws-row seg">${sBtn("solid", "") + sBtn("dashed", ' stroke-dasharray="5 3"') + sBtn("dotted", ' stroke-dasharray="0.5 3.5" stroke-linecap="round"')}</div>` +
    arrowRow +
    `<div class="gm-modal-acts" style="margin-top:14px">` +
    (derived || (e && e.derived) ? "" : `<button class="btn btn-ghost btn-sm" id="gmEdgeDel">删除连线</button>`) +
    `<button class="btn gm-btn-coral btn-sm" id="gmEdgeSave">完成</button></div>`);
  const inp = document.getElementById("gmEdgeLabel");
  setTimeout(() => { inp.focus(); }, 0);
  document.querySelectorAll("[data-ek]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.ek, v = b.dataset.ev;
    if (derived) {
      if (k === "stroke") dChild.stroke = v;
      else if (k === "strokeWidth") dChild.strokeWidth = Number(v);
      else if (k === "strokeStyle") dChild.strokeStyle = v;
    } else {
      const patch = {};
      if (k === "strokeWidth") patch.strokeWidth = Number(v);
      else if (k === "arrow") patch.arrow = v === "1";
      else patch[k] = v;
      editor.setEdgeStyleFor(eid, patch);
    }
    document.querySelectorAll(`[data-ek="${k}"]`).forEach((x) => x.classList.toggle("active", x.dataset.ev === v));
  }));
  document.getElementById("gmEdgeSave").addEventListener("click", () => {
    const val = inp.value.trim();
    if (derived) { if (val) dChild.edgeLabel = val; else delete dChild.edgeLabel; editor.render(); editor.onChange(); editor.pushHistory(); }
    else editor.setEdgeStyleFor(eid, { label: val || null });
    close();
  });
  const del = document.getElementById("gmEdgeDel");
  if (del) del.addEventListener("click", () => { editor.deleteSelection(); close(); });
}
function renderMmNodePanel(panel) {
  const nodes = [...editor.selection].map((id) => editor.nodeById(id)).filter(Boolean);
  panel.hidden = nodes.length === 0;
  if (!nodes.length) return;
  const n = nodes[0];
  const fs = n.fontSize || 15;
  const sw = (k, c, cur) => `<button class="gm-ws-swatch${c === cur ? " active" : ""}" data-k="${k}" data-v="${c}" title="${c === "transparent" ? "透明" : c}"><span class="gm-ws-fill" style="background:${c}"></span></button>`;
  const fsBtn = (v, t) => `<button class="gm-ws-seg${fs === v ? " active" : ""}" data-k="fontSize" data-v="${v}">${t}</button>`;
  const toggleBtn = (k, label, attr) => `<button class="gm-ws-seg${n[k] ? " active" : ""}" data-k="${k}" data-v="1" title="${label}">${attr}</button>`;
  const widthBtn = (v, t) => `<button class="gm-ws-seg${(n.strokeWidth || 2) === v ? " active" : ""}" data-k="strokeWidth" data-v="${v}">${t}</button>`;
  const styleBtn = (v, t, dash) => `<button class="gm-ws-seg${(n.strokeStyle || "solid") === v ? " active" : ""}" data-k="strokeStyle" data-v="${v}" title="${t}"><svg width="22" height="10"><line x1="2" y1="5" x2="20" y2="5" stroke="#1f2a37" stroke-width="2"${dash}/></svg></button>`;
  const shapeBtn = (v, t) => `<button class="gm-ws-seg${(n.shape || "rounded") === v ? " active" : ""}" data-k="shape" data-v="${v}">${t}</button>`;
  panel.innerHTML =
    `<div class="gm-ws-t">文字颜色</div>` +
    `<div class="gm-ws-row">${MM_TEXT_COLORS.map((c) => sw("textColor", c, n.textColor || "#1f2a37")).join("")}</div>` +
    `<div class="gm-ws-t">字号</div>` +
    `<div class="gm-ws-row seg">${fsBtn(14, "S") + fsBtn(15, "M") + fsBtn(18, "L") + fsBtn(24, "XL")}</div>` +
    `<div class="gm-ws-t">样式</div>` +
    `<div class="gm-ws-row seg">${toggleBtn("bold", "加粗", "<b>B</b>") + toggleBtn("italic", "斜体", "<i>I</i>") + toggleBtn("underline", "下划线", "<u>U</u>")}</div>` +
    `<div class="gm-ws-t">背景</div>` +
    `<div class="gm-ws-row">${MM_BG_COLORS.map((c) => sw("color", c, n.color == null ? "#ffffff" : n.color)).join("")}</div>` +
    `<div class="gm-ws-t">边框颜色</div>` +
    `<div class="gm-ws-row">${MM_STROKE_COLORS.map((c) => sw("stroke", c, n.stroke || "#94a3b8")).join("")}</div>` +
    `<div class="gm-ws-t">边框宽度</div>` +
    `<div class="gm-ws-row seg">${widthBtn(1, "细") + widthBtn(2, "中") + widthBtn(4, "粗")}</div>` +
    `<div class="gm-ws-t">边框样式</div>` +
    `<div class="gm-ws-row seg">${styleBtn("solid", "实线", "") + styleBtn("dashed", "虚线", ' stroke-dasharray="5 3"') + styleBtn("dotted", "点线", ' stroke-dasharray="0.5 3.5" stroke-linecap="round"')}</div>` +
    `<div class="gm-ws-t">形状</div>` +
    `<div class="gm-ws-row seg">${shapeBtn("rounded", "圆角") + shapeBtn("rect", "矩形") + shapeBtn("underline", "下划线")}</div>` +
    (n.image
      ? `<div class="gm-ws-t">图片</div><div class="gm-ws-row seg"><button class="gm-ws-seg" data-k="image" data-v="__remove__">移除图片</button></div>`
      : "") +
    (n.icon
      ? `<div class="gm-ws-t">图标</div><div class="gm-ws-row seg"><button class="gm-ws-seg" data-k="icon" data-v="__remove__" title="移除图标">${escapeModalText(n.icon)} 移除图标</button></div>`
      : "");
  panel.querySelectorAll("[data-k]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.k;
      let v = b.dataset.v;
      if (k === "bold" || k === "italic" || k === "underline") v = !n[k];
      else if (k === "fontSize" || k === "strokeWidth") v = Number(v);
      else if (v === "__remove__") v = null;
      editor.setNodeStyle({ [k]: v });
      refreshMmPanelKeep();
    });
  });
  // 重渲染面板（保留在原位）
  function refreshMmPanelKeep() { renderMmNodePanel(panel); }
}

// ---------- 右侧图标栏（属性 / 主题 / 结构 / 大纲 / 设置，参考 mind-map） ----------
// 编辑器行为设置（localStorage 持久化，应用到 editor 实例）
const GM_SETTINGS_KEY = "gm_editor_settings";
let settings = { grid: false, autoEdit: true, dblCreate: false, wheelPan: false, noCompressImage: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem(GM_SETTINGS_KEY) || "{}")); } catch (_) {}
function saveSettings() {
  try { localStorage.setItem(GM_SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
}
function applySettings() {
  if (!editor) return;
  editor.showGrid = !!settings.grid;
  editor.autoEditNewNode = settings.autoEdit !== false;
  editor.dblClickCreate = !!settings.dblCreate;
  editor.wheelPan = !!settings.wheelPan;
  editor.render();
}
function buildSideRail() {
  const bodyEl = document.querySelector(".gm-body");
  if (!bodyEl) return;
  const rail = document.createElement("div");
  rail.className = "gm-side-rail";
  const items = [
    { act: "attr", label: "属性", icon: "sliders" },
    { act: "theme", label: "主题", icon: "theme" },
    { act: "structure", label: "结构", icon: "flow" },
    { act: "outline", label: "大纲", icon: "outline" },
    { act: "settings", label: "设置", icon: "gear" },
  ];
  for (const it of items) {
    const b = document.createElement("button");
    b.dataset.act = it.act;
    b.innerHTML = `${ICONS[it.icon] || ""}<span class="lbl">${it.label}</span>`;
    b.title = it.label;
    b.addEventListener("click", () => onRailAction(it.act, b));
    rail.appendChild(b);
  }
  // 插到画布之后、右侧说明栏之前
  const right = bodyEl.querySelector(".gm-right");
  bodyEl.insertBefore(rail, right || null);
}
function onRailAction(act, btn) {
  if (act === "attr") {
    // 属性：选中节点并打开样式面板（脑图无选中时默认选中心主题）
    if (!editor.selection.size) {
      const root = editor.doc.nodes.find((n) => n.parentId == null) || editor.doc.nodes[0];
      if (root) { editor.selection = new Set([root.id]); editor.render(); }
      else { toast("请先选中一个元素", "info"); return; }
    }
    editor.render(); // 触发 onSelectionChange -> 刷新样式面板
    flashPanel(document.getElementById("wbStylePanel"));
  } else if (act === "theme" || act === "structure") {
    const target = document.getElementById(act === "theme" ? "themePanel" : "layoutPanel");
    if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); flashPanel(target); }
  } else if (act === "outline") {
    import("./outline.js").then((m) => m.openOutline(editor));
  } else if (act === "settings") {
    toggleSettingsPanel(btn);
  }
}
// 面板高亮提示（短暂描边）
function flashPanel(el) {
  if (!el) return;
  el.classList.remove("gm-flash");
  void el.offsetWidth;
  el.classList.add("gm-flash");
}
// 设置面板（挂 body 的固定定位卡片，再点设置按钮关闭）
function toggleSettingsPanel(btn) {
  const exist = document.getElementById("gmSettingsPanel");
  if (exist) { exist.remove(); return; }
  const panel = document.createElement("div");
  panel.className = "gm-set-panel";
  panel.id = "gmSettingsPanel";
  const chk = (k, label, tip) =>
    `<label class="gm-set-row" title="${tip || ""}"><input type="checkbox" data-set="${k}"${settings[k] ? " checked" : ""}/><span>${label}</span></label>`;
  panel.innerHTML =
    `<div class="gm-set-head"><b>设置</b><button class="gm-set-x" aria-label="关闭">×</button></div>` +
    chk("grid", "显示网格", "在画布上显示点状网格") +
    chk("autoEdit", "新节点自动进入编辑", "新建节点后直接开始输入文字") +
    chk("dblCreate", "双击空白处创建子节点", "双击画布空白处在中心主题下新增节点") +
    chk("noCompressImage", "上传图片不压缩", "关闭后插入的图片默认压缩到 100KB 以内；开启则按原图上传") +
    `<div class="gm-set-t">鼠标滚轮行为</div>` +
    `<div class="gm-set-seg">` +
    `<button data-wheel="0"${!settings.wheelPan ? ' class="active"' : ""}>缩放视图</button>` +
    `<button data-wheel="1"${settings.wheelPan ? ' class="active"' : ""}>上下平移</button>` +
    `</div>`;
  panel.querySelector(".gm-set-x").addEventListener("click", () => panel.remove());
  panel.querySelectorAll("[data-set]").forEach((c) => {
    c.addEventListener("change", () => {
      settings[c.dataset.set] = c.checked;
      saveSettings(); applySettings();
    });
  });
  panel.querySelectorAll("[data-wheel]").forEach((b) => {
    b.addEventListener("click", () => {
      settings.wheelPan = b.dataset.wheel === "1";
      saveSettings(); applySettings();
      panel.querySelectorAll("[data-wheel]").forEach((x) => x.classList.toggle("active", x === b));
    });
  });
  document.body.appendChild(panel);
  // 贴在触发按钮左侧
  const r = btn.getBoundingClientRect();
  panel.style.top = Math.min(r.top, window.innerHeight - panel.offsetHeight - 12) + "px";
  panel.style.right = Math.max(10, window.innerWidth - r.left + 8) + "px";
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
    const isHand = b.dataset.act === "hand" && editor.tool === "hand";
    b.classList.toggle("active", isSelect || isLink || isHand);
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
  // 更多菜单：嵌入网页 / 便签 / 清空白板（颜色在左侧属性面板中选择，顶栏不再重复）
  // 弹层挂 body（toggleBodyPop），避免被工具栏 overflow-y:hidden 裁剪
  const mb = document.createElement("button");
  mb.className = "gm-wb-btn";
  mb.title = "更多";
  mb.innerHTML = ICONS.menu;
  mb.addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = document.createElement("div");
    pop.className = "pop gm-more-menu";
    for (const m of WB_MORE) {
      const item = document.createElement("button");
      item.innerHTML = `${ICONS[m.icon] || ""}<span>${m.label}</span>${m.key ? `<span class="kbd">${m.key}</span>` : ""}`;
      item.addEventListener("click", () => { closeBodyPop(); onWbMore(m.act); });
      pop.appendChild(item);
    }
    toggleBodyPop(mb, pop);
  });
  bar.appendChild(mb);
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
function renderEdgeStylePanel(panel, eid) {
  const e = editor.edgeById(eid);
  if (!e) { panel.hidden = true; return; }
  panel.hidden = false;
  const cur = {
    stroke: e.stroke || (e.assoc ? "#ff9f43" : (e.derived ? "#11b5a4" : "#94a3b8")),
    strokeWidth: e.strokeWidth || 2,
    strokeStyle: e.strokeStyle || (e.assoc ? "dashed" : "solid"),
  };
  const cols = ["#94a3b8", "#11b5a4", "#ff9f43", "#ef4444", "#3b82f6", "#8b5cf6", "#1f2a37"];
  const colBtn = (c) => `<button class="gm-ws-swatch${c === cur.stroke ? " active" : ""}" data-ek="stroke" data-ev="${c}" title="${c}" style="background:${c}"></button>`;
  const wBtn = (v) => `<button class="gm-ws-seg${cur.strokeWidth === v ? " active" : ""}" data-ek="strokeWidth" data-ev="${v}" title="${v === 2 ? "细" : v === 4 ? "中" : "粗"}"><svg width="22" height="10"><line x1="2" y1="5" x2="20" y2="5" stroke="#1f2a37" stroke-width="${v}"/></svg></button>`;
  const sBtn = (v, t, dash) => `<button class="gm-ws-seg${cur.strokeStyle === v ? " active" : ""}" data-ek="strokeStyle" data-ev="${v}" title="${t}"><svg width="22" height="10"><line x1="2" y1="5" x2="20" y2="5" stroke="#1f2a37" stroke-width="2"${dash}/></svg></button>`;
  panel.innerHTML =
    `<div class="gm-ws-t">连线样式</div>` +
    `<div class="gm-ws-row">${cols.map(colBtn).join("")}</div>` +
    `<div class="gm-ws-t">线宽</div>` +
    `<div class="gm-ws-row seg">${wBtn(2) + wBtn(4) + wBtn(6)}</div>` +
    `<div class="gm-ws-t">线型</div>` +
    `<div class="gm-ws-row seg">${sBtn("solid", "实线", "") + sBtn("dashed", "虚线", ' stroke-dasharray="5 3"') + sBtn("dotted", "点线", ' stroke-dasharray="0.5 3.5" stroke-linecap="round"')}</div>` +
    `<div class="gm-ws-t">形状</div>` +
    `<div class="gm-ws-row seg">` +
      `<button class="gm-ws-seg" data-ek="bend" data-ev="curve" title="恢复曲线">⌒</button>` +
      `<button class="gm-ws-seg" data-ek="bend" data-ev="straight" title="拉直">—</button>` +
    `</div>` +
    (e.label != null ? `<div class="gm-ws-row"><button class="gm-ws-seg" data-ek="label" data-ev="edit" title="编辑文字">编辑文字</button></div>` : "") +
    `<div class="gm-ws-row"><button class="gm-ws-seg danger" data-ek="del" data-ev="1" title="删除连线">删除连线</button></div>`;
  panel.querySelectorAll("[data-ek]").forEach((b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.ek, v = b.dataset.ev;
      if (k === "strokeWidth") editor.setEdgeStyle({ strokeWidth: Number(v) });
      else if (k === "bend") editor.setEdgeStyle({ bend: v === "straight" ? "straight" : null });
      else if (k === "del") { editor.deleteSelection(); return; }
      else if (k === "label") { openEdgeModal(eid); }
      else editor.setEdgeStyle({ [k]: v });
      refreshWbStylePanel();
    });
  });
}
function refreshWbStylePanel() {
  const panel = document.getElementById("wbStylePanel");
  if (!panel || !editor) { if (panel) panel.hidden = true; return; }
  // 选中连线时优先显示连线样式面板（关联线 / 流程线 / 脑图连线均可调）
  const eid = editor._selEdgeId && editor._selEdgeId();
  if (eid) { renderEdgeStylePanel(panel, eid); return; }
  // 脑图模式：选中节点时显示节点样式面板
  if (editor.mode === "mindmap") { renderMmNodePanel(panel); return; }
  if (editor.mode !== "whiteboard") { panel.hidden = true; return; }
  // 文字模式：文字工具激活，或选中了单个文字节点 -> 显示文字专属面板
  const selNodes = [...editor.selection].map((id) => editor.nodeById(id)).filter(Boolean);
  const laNode = (selNodes.length === 1 && (selNodes[0].shape === "line" || selNodes[0].shape === "arrow")) ? selNodes[0] : null;
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
    (laNode ? `<div class="gm-ws-t">文字</div><input id="wbLineText" data-id="${laNode.id}" class="gm-note-ta" style="min-height:0;padding:9px 12px" maxlength="40" placeholder="线段文字（双击也可编辑）" value="${escapeModalText(laNode.text || "")}" />` : "") +
    wbOpacityLayerHtml(p) + wbActionsHtml();
  wireWsPanelEvents(panel);
  const lt = document.getElementById("wbLineText");
  if (lt) lt.addEventListener("input", () => { const n = editor.nodeById(lt.dataset.id); if (n) { n.text = lt.value; editor.render(); editor.onChange(); } });
}

// 属性面板公共尾段：透明度滑杆 + 图层排序
// 注意：内联 SVG 必须带 viewBox，否则部分浏览器 flex 布局下会被压缩成细条
function wbOpacityLayerHtml(p) {
  const ic = (inner) => `<svg class="gm-ws-ic" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `<div class="gm-ws-t">透明度 <span class="gm-ws-val">${Math.round(p.opacity * 100)}%</span></div>` +
    `<input type="range" class="gm-ws-range" min="10" max="100" step="5" value="${Math.round(p.opacity * 100)}" />` +
    `<div class="gm-ws-t">图层</div>` +
    `<div class="gm-ws-row seg">` +
      `<button class="gm-ws-seg" data-layer="front" title="置于顶层">${ic('<path d="M5,3.4 L8,1 L11,3.4" stroke="#1f2a37" stroke-width="1.5"/><path d="M5,7 L8,4.6 L11,7" stroke="#1f2a37" stroke-width="1.5"/><rect x="4" y="9.8" width="8" height="4.6" rx="1.2" fill="#1f2a37" stroke="none"/>')}</button>` +
      `<button class="gm-ws-seg" data-layer="forward" title="上移一层">${ic('<path d="M5,6.5 L8,4 L11,6.5" stroke="#1f2a37" stroke-width="1.5"/><rect x="4" y="9.8" width="8" height="4.6" rx="1.2" fill="#1f2a37" stroke="none"/>')}</button>` +
      `<button class="gm-ws-seg" data-layer="backward" title="下移一层">${ic('<rect x="4" y="1.6" width="8" height="4.6" rx="1.2" fill="#1f2a37" stroke="none"/><path d="M5,9.5 L8,12 L11,9.5" stroke="#1f2a37" stroke-width="1.5"/>')}</button>` +
      `<button class="gm-ws-seg" data-layer="back" title="置于底层">${ic('<rect x="4" y="1.6" width="8" height="4.6" rx="1.2" fill="#1f2a37" stroke="none"/><path d="M5,8 L8,10.4 L11,8" stroke="#1f2a37" stroke-width="1.5"/><path d="M5,11.6 L8,14 L11,11.6" stroke="#1f2a37" stroke-width="1.5"/>')}</button>` +
    `</div>`;
}

// 白板属性面板操作区：复制 / 删除 / 组合（对应快捷键）
function wbActionsHtml() {
  const ic = (inner) => `<svg class="gm-ws-ic" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `<div class="gm-ws-t">操作</div>` +
    `<div class="gm-ws-row seg">` +
      `<button class="gm-ws-seg" data-wact="dup" title="创建副本 (Ctrl+D)">${ic('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="#1f2a37" stroke-width="1.5"/><path d="M10.5,2.5 L4.5,2.5 Q2.5,2.5 2.5,4.5 L2.5,10.5" stroke="#1f2a37" stroke-width="1.5"/>')}</button>` +
      `<button class="gm-ws-seg" data-wact="del" title="删除 (Del)">${ic('<path d="M3,4.2 L13,4.2" stroke="#1f2a37" stroke-width="1.5"/><path d="M6.2,4.2 L6.2,3.2 Q6.2,2.5 6.9,2.5 L9.1,2.5 Q9.8,2.5 9.8,3.2 L9.8,4.2" stroke="#1f2a37" stroke-width="1.4"/><path d="M4.4,4.2 L5.1,13.2 Q5.15,13.8 5.75,13.8 L10.25,13.8 Q10.85,13.8 10.9,13.2 L11.6,4.2" stroke="#1f2a37" stroke-width="1.4"/><path d="M6.7,6.8 L6.7,11.2 M9.3,6.8 L9.3,11.2" stroke="#1f2a37" stroke-width="1.4"/>')}</button>` +
      `<button class="gm-ws-seg" data-wact="group" title="组合 (Ctrl+G)">${ic('<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="#1f2a37" stroke-width="1.3" stroke-dasharray="2.6 2.1"/><rect x="5" y="5" width="3.6" height="3.6" rx="0.8" fill="#1f2a37" stroke="none"/><rect x="7.4" y="7.4" width="3.6" height="3.6" rx="0.8" fill="#1f2a37" stroke="none"/>')}</button>` +
      `<button class="gm-ws-seg" data-wact="ungroup" title="解组 (Ctrl+Shift+G)">${ic('<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="#1f2a37" stroke-width="1.3" stroke-dasharray="2.6 2.1"/><rect x="4.2" y="4.2" width="3.4" height="3.4" rx="0.8" fill="#1f2a37" stroke="none"/><rect x="8.4" y="8.4" width="3.4" height="3.4" rx="0.8" fill="#1f2a37" stroke="none"/>')}</button>` +
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
  panel.querySelectorAll("[data-wact]").forEach((b) => {
    b.addEventListener("click", () => {
      const a = b.dataset.wact;
      if (a === "dup") editor.duplicateSelection();
      else if (a === "del") editor.deleteSelection();
      else if (a === "group" || a === "ungroup") toggleGroupSelection();
    });
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

// ---------- 右键菜单（白板 / 流程图 / 思维导图通用） ----------
let wbClipboard = [];        // 内部剪贴板（节点深拷贝，三模式通用）
let wbClipboardEdges = [];   // 剪贴板内连线（副本间连线随复制）
let wbMenuPos = null;        // 最近一次右键位置（屏幕坐标），粘贴到鼠标处用
let wbStyleClipboard = null; // 拷贝的节点样式

// 通用菜单构建：itemsFn 返回菜单项（keep 项执行后重开菜单以刷新勾选态）
function showCtxMenu(x, y, itemsFn) {
  hideCtxMenu();
  const menu = document.createElement("div");
  menu.className = "gm-ctx-menu";
  for (const it of itemsFn()) {
    if (it.sep) { const s = document.createElement("div"); s.className = "gm-ctx-sep"; menu.appendChild(s); continue; }
    const b = document.createElement("button");
    if (it.danger) b.classList.add("danger");
    b.innerHTML = `<span class="lbl">${it.label}</span>` +
      (it.kbd ? `<span class="kbd">${it.kbd}</span>` : "") +
      (it.sub ? `<span class="arr">›</span>` : "");
    if (it.sub) {
      b.addEventListener("mouseenter", () => {
        menu.querySelectorAll(".gm-ctx-sub").forEach((s) => s.remove());
        const sub = document.createElement("div");
        sub.className = "gm-ctx-menu gm-ctx-sub";
        for (const sit of it.sub) {
          const sb = document.createElement("button");
          sb.innerHTML = `<span class="lbl">${sit.label}</span>${sit.kbd ? `<span class="kbd">${sit.kbd}</span>` : ""}`;
          sb.addEventListener("click", () => { hideCtxMenu(); sit.act(); });
          sub.appendChild(sb);
        }
        menu.appendChild(sub);
        sub.style.position = "fixed";
        const br = b.getBoundingClientRect();
        const sr = sub.getBoundingClientRect();
        sub.style.left = Math.max(6, Math.min(br.right - 4, window.innerWidth - sr.width - 8)) + "px";
        sub.style.top = Math.max(6, Math.min(br.top - 4, window.innerHeight - sr.height - 8)) + "px";
      });
    } else {
      b.addEventListener("click", () => {
        it.act();
        if (it.keep) showCtxMenu(x, y, itemsFn); else hideCtxMenu();
      });
    }
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 8)) + "px";
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 8)) + "px";
}
function hideCtxMenu() {
  document.querySelectorAll(".gm-ctx-menu").forEach((m) => m.remove());
}
const hideWbMenu = hideCtxMenu; // 兼容旧引用

function wireContextMenus() {
  editor.container.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (editor.rmbJustDragged && editor.rmbJustDragged()) return; // 右键拖拽平移过画布，不弹菜单
    // 右键命中：连线 / 节点 / 分组(外框、概括) 纳入选中，空白则清空
    const edgeHit = e.target.closest && e.target.closest("[data-edge]");
    const groupHit = e.target.closest && e.target.closest(".gm-group");
    const hit = e.target.closest && e.target.closest("[data-id]");
    if (edgeHit && editor.mode !== "whiteboard") {
      const key = "e:" + edgeHit.getAttribute("data-edge");
      if (!editor.selection.has(key)) editor.selection = new Set([key]);
      editor.render();
    } else if (groupHit && editor.mode === "mindmap") {
      const key = "g:" + groupHit.getAttribute("data-g");
      if (!editor.selection.has(key)) editor.selection = new Set([key]);
      editor.render();
    } else if (hit) {
      const id = hit.getAttribute("data-id");
      if (!editor.selection.has(id)) editor.selection = new Set([id]);
      editor.render();
    } else {
      editor.clearSelection();
    }
    if (editor.mode === "whiteboard") showWbMenu(e.clientX, e.clientY);
    else if (editor.mode === "flowchart") showFcMenu(e.clientX, e.clientY);
    else showMmMenu(e.clientX, e.clientY);
  });
  // 点击其他区域 / 滚动 / 失焦 / Esc 关闭
  window.addEventListener("pointerdown", (e) => { if (!e.target.closest || !e.target.closest(".gm-ctx-menu")) hideCtxMenu(); }, true);
  window.addEventListener("wheel", hideCtxMenu, { passive: true });
  window.addEventListener("blur", hideCtxMenu);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCtxMenu(); });
}

// ---------- 白板右键菜单 ----------
function showWbMenu(x, y) {
  wbMenuPos = { x, y };
  showCtxMenu(x, y, () => {
    const hasSel = editor.selection.size > 0;
    const single = hasSel && editor.selection.size === 1 ? editor.nodeById([...editor.selection][0]) : null;
    const items = [];
    if (hasSel) items.push({ label: "剪切", kbd: "Ctrl+X", act: cutWbSelection });
    if (hasSel) items.push({ label: "复制", kbd: "Ctrl+C", act: copyWbSelection });
    if (wbClipboard.length) items.push({ label: "粘贴", kbd: "Ctrl+V", act: () => pasteWbClipboard() });
    if (single) items.push({ label: "编辑", kbd: "Enter", act: () => editor.beginTextEdit(single.id) });
    if (hasSel) items.push({ label: "创建副本", kbd: "Ctrl+D", act: () => editor.duplicateSelection() });
    items.push({ sep: true });
    // 导出 / 样式 / 图层 / 变换 / 锁定 折叠为子菜单，缩短菜单长度
    const exportSub = [{ label: "复制为 PNG", kbd: "Shift+Alt+C", act: () => copyWbExport(true) },
      { label: "复制为 SVG", act: () => copyWbExport(false) }];
    if (hasSel) exportSub.push({ label: "复制文本到剪贴板", act: copySelText });
    items.push({ label: "导出", sub: exportSub });
    if (single || (hasSel && wbStyleClipboard)) {
      const styleSub = [];
      if (single) styleSub.push({ label: "拷贝样式", kbd: "Ctrl+Shift+C", act: copyNodeStyle });
      if (hasSel && wbStyleClipboard) styleSub.push({ label: "粘贴样式", kbd: "Ctrl+Shift+V", act: pasteNodeStyle });
      items.push({ label: "样式", sub: styleSub });
    }
    if (hasSel) {
      items.push({ label: "图层", sub: [
        { label: "下一层", kbd: "Ctrl+[", act: () => editor._reorderLayer("backward") },
        { label: "上一层", kbd: "Ctrl+]", act: () => editor._reorderLayer("forward") },
        { label: "置于顶层", kbd: "Ctrl+Shift+]", act: () => editor._reorderLayer("front") },
        { label: "置于底层", kbd: "Ctrl+Shift+[", act: () => editor._reorderLayer("back") },
      ] });
      items.push({ label: "变换", sub: [
        { label: "水平翻转", kbd: "Shift+H", act: () => flipSelection("x") },
        { label: "垂直翻转", kbd: "Shift+V", act: () => flipSelection("y") },
      ] });
    }
    const lockSub = [];
    if (hasSel) lockSub.push({ label: single && single.locked ? "取消锁定" : "锁定", kbd: "Ctrl+Shift+L", act: toggleLockSelection });
    lockSub.push({ label: "全部锁定", act: () => setAllLocked(true) });
    lockSub.push({ label: "全部解锁", act: () => setAllLocked(false) });
    items.push({ label: "锁定", sub: lockSub });
    items.push({ sep: true });
    items.push({ label: (editor.showGrid ? "✓ " : "") + "显示网格", kbd: "Ctrl+'", keep: true, act: () => editor.toggleGrid() });
    if (hasSel) items.push({ label: "删除", kbd: "Del", danger: true, act: () => editor.deleteSelection() });
    items.push({ sep: true });
    const moreSub = [{ label: "详细统计信息", kbd: "Alt+/", act: wbStats }];
    if (editor._selEdgeId()) moreSub.push({ label: "编辑连线样式", kbd: "双击连线", act: () => { refreshWbStylePanel(); flashPanel(document.getElementById("wbStylePanel")); } });
    items.push({ label: "更多", sub: moreSub });
    return items;
  });
}

// ---------- 流程图右键菜单 ----------
function showFcMenu(x, y) {
  wbMenuPos = { x, y };
  showCtxMenu(x, y, () => {
    const items = [];
    items.push({ label: "撤销", kbd: "Ctrl+Z", act: () => editor.undo() });
    if (wbClipboard.length) items.push({ label: "在此粘贴", kbd: "Ctrl+V", act: () => pasteWbClipboard() });
    items.push({ sep: true });
    items.push({ label: "导出", sub: [
      { label: "复制为图像", kbd: "Shift+Alt+C", act: () => copyWbExport(true) },
      { label: "复制为 SVG", act: () => copyWbExport(false) },
    ] });
    items.push({ label: "清除默认风格", act: clearFcStyle });
    items.push({ sep: true });
    items.push({ label: "全选", kbd: "Ctrl+A", keep: true, act: wbSelectAll });
    items.push({ label: "选择顶点", keep: true, act: () => {
      editor.selection = new Set(editor.doc.nodes.filter((n) => !n.locked).map((n) => n.id));
      editor.render();
    } });
    items.push({ label: "选择边线", keep: true, act: () => {
      editor.selection = new Set(editor.doc.edges.map((e) => "e:" + e.id));
      editor.render();
    } });
    if (editor._selEdgeId()) items.push({ label: "编辑连线样式", kbd: "双击连线", act: () => { refreshWbStylePanel(); flashPanel(document.getElementById("wbStylePanel")); } });
    // 选中节点 / 连线时提供「删除」（含图片节点会自动二次确认）
    if (editor.selection.size > 0) items.push({ label: "删除", kbd: "Del", danger: true, act: () => editor.deleteSelection() });
    return items;
  });
}

// ---------- 思维导图右键菜单 ----------
function showMmMenu(x, y) {
  showCtxMenu(x, y, () => {
    const items = [];
    // 选中分组（外框 / 概括）时：编辑 / 删除分组
    const gKey = [...editor.selection].find((k) => k.startsWith && k.startsWith("g:"));
    const g = gKey ? editor.groupById(gKey.slice(2)) : null;
    if (g) {
      const kindName = g.kind === "frame" ? "外框" : "概括";
      items.push({ label: "编辑" + kindName, act: () => openGroupModal(g.id) });
      items.push({ label: "删除" + kindName, danger: true, act: () => editor.removeGroup(g.id) });
      items.push({ sep: true });
    }
    // 选中单个节点且有图片 / 图标时：快捷移除入口
    const selIds = [...editor.selection].filter((k) => !(k.startsWith && (k.startsWith("e:") || k.startsWith("g:"))));
    const singleNode = selIds.length === 1 ? editor.nodeById(selIds[0]) : null;
    if (singleNode && singleNode.image) items.push({ label: "移除图片", act: () => editor.setNodeStyle({ image: null }) });
    if (singleNode && singleNode.icon) items.push({ label: "移除图标", act: () => editor.setNodeStyle({ icon: null }) });
    if (g || (singleNode && (singleNode.image || singleNode.icon))) items.push({ sep: true });
    items.push({ label: "回到根节点", kbd: "Ctrl+Enter", act: mmFocusRoot });
    items.push({ sep: true });
    items.push({ label: "展开所有", act: () => mmSetAllCollapsed(false) });
    items.push({ label: "收起所有", act: () => mmSetAllCollapsed(true) });
    items.push({ label: "展开到", sub: [1, 2, 3, 4, 5].map((d) => ({ label: `${d} 级主题`, act: () => mmCollapseToDepth(d) })) });
    items.push({ sep: true });
    items.push({ label: "一键整理布局", kbd: "Ctrl+L", act: mmRelayout });
    items.push({ label: "适应画布", kbd: "Ctrl+I", act: () => editor.fitView() });
    items.push({ label: "禅模式", act: toggleZen });
    items.push({ sep: true });
    items.push({ label: "一键去除所有节点自定义样式", act: resetMmStyles });
    items.push({ label: "复制到剪贴板", sub: [
      { label: "复制为 PNG", act: () => copyWbExport(true) },
      { label: "复制为 SVG", act: () => copyWbExport(false) },
      { label: "复制为 JSON", act: copyDocJSON },
    ] });
    if (editor._selEdgeId()) items.push({ label: "编辑连线样式", kbd: "双击连线", act: () => { refreshWbStylePanel(); flashPanel(document.getElementById("wbStylePanel")); } });
    // 选中节点 / 连线时提供「删除」（含图片节点会自动二次确认）
    const mmDelSel = selIds.length > 0 || editor._selEdgeId();
    if (mmDelSel && !g) items.push({ label: "删除", kbd: "Del", danger: true, act: () => editor.deleteSelection() });
    return items;
  });
}

// ---------- 脑图菜单辅助 ----------
function mmNodeDepth(n) {
  let d = 1, p = n;
  while (p && p.parentId != null) { p = editor.nodeById(p.parentId); d++; }
  return d;
}
function mmHasKids(n) { return editor.doc.nodes.some((c) => c.parentId === n.id); }
// 当前选中中的节点 id（排除连线 "e:" 键）
function selectedNodeIds() { return [...editor.selection].filter((id) => !String(id).startsWith("e:")); }
function mmSetAllCollapsed(collapsed) {
  for (const n of editor.doc.nodes) if (mmHasKids(n)) n.collapsed = collapsed;
  layoutMindmap(editor.doc); editor.render(); editor.fitView(true); editor.onChange(); editor.pushHistory();
}
function mmCollapseToDepth(depth) {
  for (const n of editor.doc.nodes) if (mmHasKids(n)) n.collapsed = mmNodeDepth(n) >= depth;
  layoutMindmap(editor.doc); editor.render(); editor.fitView(true); editor.onChange(); editor.pushHistory();
  toast(`已展开到 ${depth} 级主题`, "info");
}
function mmFocusRoot() {
  const root = editor.doc.nodes.find((n) => n.parentId == null);
  if (!root) return;
  const s = editor.sizes.get(root.id) || { w: 160, h: 56 };
  const r = editor.rect();
  editor.view.x = r.width / 2 - (root.x + s.w / 2) * editor.view.scale;
  editor.view.y = r.height / 2 - (root.y + s.h / 2) * editor.view.scale;
  editor.render();
}
function mmRelayout() {
  layoutMindmap(editor.doc); editor.render(); editor.fitView(true); editor.onChange(); editor.pushHistory();
}
function toggleZen() {
  const on = document.body.classList.toggle("gm-zen");
  toast(on ? "禅模式：按 Esc 退出" : "已退出禅模式", "info");
}
function resetMmStyles() {
  for (const n of editor.doc.nodes) {
    delete n.bold; delete n.italic; delete n.underline;
    delete n.strokeWidth; delete n.strokeStyle; delete n.roughness; delete n.opacity;
    n.shape = "rounded";
    if (n.parentId == null) { n.fontSize = 17; }
    else {
      n.fontSize = 15; n.color = "#fff"; n.textColor = "#1f2a37";
      let p = editor.nodeById(n.parentId);
      while (p && p.parentId != null) p = editor.nodeById(p.parentId);
      if (p && p.color) n.stroke = p.color;
    }
  }
  layoutMindmap(editor.doc); editor.render(); editor.onChange(); editor.pushHistory();
  toast("已去除所有节点自定义样式", "success");
}
function copyDocJSON() {
  navigator.clipboard.writeText(JSON.stringify(editor.doc, null, 2))
    .then(() => toast("已复制文档 JSON 到剪贴板", "info"))
    .catch(() => toast("复制失败", "error"));
}

// ---------- 流程图菜单辅助 ----------
function clearFcStyle() {
  const sel = new Set([...editor.selection].filter((k) => !(k.startsWith && k.startsWith("e:"))));
  const targets = sel.size ? editor.doc.nodes.filter((n) => sel.has(n.id)) : editor.doc.nodes;
  for (const n of targets) {
    delete n.roughness; delete n.strokeStyle; delete n.opacity; delete n.strokeWidth;
    delete n.bold; delete n.italic; delete n.underline;
    if (n.shape === "text") { n.color = "transparent"; n.stroke = "transparent"; }
    else { n.color = "#fff"; n.stroke = "#2f80ed"; }
    n.fontSize = 14;
  }
  editor.render(); editor.onChange(); editor.pushHistory();
  toast(sel.size ? "已清除选中节点的自定义风格" : "已清除默认风格", "info");
}

// ---------- 通用操作辅助（复制 / 样式 / 组合 / 锁定 / 翻转） ----------
function copyNodeStyle() {
  const n = editor.nodeById([...editor.selection][0]);
  if (!n) return;
  const KEYS = ["stroke", "color", "textColor", "strokeWidth", "strokeStyle", "roughness", "rounded", "opacity", "fontSize", "fontStyle", "fontFamily", "textAlign", "bold", "italic", "underline"];
  wbStyleClipboard = {};
  for (const k of KEYS) if (n[k] !== undefined && n[k] !== null) wbStyleClipboard[k] = n[k];
  toast("已拷贝样式，选中其他图形后可粘贴", "info");
}
function pasteNodeStyle() {
  if (!wbStyleClipboard) return;
  const sel = [...editor.selection].filter((k) => !(k.startsWith && k.startsWith("e:")));
  for (const id of sel) {
    const n = editor.nodeById(id);
    if (!n || ["frame", "embed", "image"].includes(n.shape)) continue;
    Object.assign(n, JSON.parse(JSON.stringify(wbStyleClipboard)));
  }
  editor.render(); editor.onChange(); editor.pushHistory();
  toast("已粘贴样式", "info");
}
function toggleGroupSelection() {
  const sel = [...editor.selection].map((id) => editor.nodeById(id)).filter(Boolean);
  if (sel.length < 2) { toast("请先选中多个图形（Shift + 点选）", "info"); return; }
  if (sel.every((n) => n.group)) {
    for (const n of sel) delete n.group;
    toast("已取消组合", "info");
  } else {
    const gid = newId();
    for (const n of sel) n.group = gid;
    toast(`已组合 ${sel.length} 个图形，拖动任一成员整组联动`, "info");
  }
  editor.render(); editor.onChange(); editor.pushHistory();
}
function toggleLockSelection() {
  const sel = [...editor.selection].map((id) => editor.nodeById(id)).filter(Boolean);
  if (!sel.length) return;
  const lock = !sel.every((n) => n.locked);
  for (const n of sel) n.locked = lock;
  editor.render(); editor.onChange(); editor.pushHistory();
  toast(lock ? "已锁定选中图形" : "已解锁选中图形", "info");
}
function setAllLocked(v) {
  for (const n of editor.doc.nodes) n.locked = v;
  editor.render(); editor.onChange(); editor.pushHistory();
  toast(v ? "已锁定全部图形" : "已解锁全部图形", "info");
}
function flipSelection(axis) {
  const key = axis === "x" ? "flipX" : "flipY";
  let flipped = 0;
  for (const id of editor.selection) {
    const n = editor.nodeById(id);
    if (!n || n.shape === "text" || n.shape === "embed") continue;
    n[key] = !n[key];
    flipped++;
  }
  if (flipped) { editor.render(); editor.onChange(); editor.pushHistory(); }
}
function copySelText() {
  const texts = [...editor.selection].map((id) => editor.nodeById(id)).filter(Boolean).map((n) => n.text || "").filter(Boolean);
  if (!texts.length) { toast("选中元素没有文本", "info"); return; }
  navigator.clipboard.writeText(texts.join("\n"))
    .then(() => toast("文本已复制到剪贴板", "info"))
    .catch(() => {});
}
function cutWbSelection() { copyWbSelection(); editor.deleteSelection(); }
function wbSelectAll() {
  const hidden = editor.hiddenNodes ? editor.hiddenNodes() : new Set();
  editor.selection = new Set(editor.doc.nodes.filter((n) => !n.locked && !hidden.has(n.id)).map((n) => n.id));
  editor.render();
}
function copyWbSelection() {
  const sel = new Set(editor.selection);
  wbClipboard = editor.doc.nodes.filter((n) => sel.has(n.id)).map((n) => JSON.parse(JSON.stringify(n)));
  const ids = new Set(wbClipboard.map((n) => n.id));
  wbClipboardEdges = editor.doc.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => JSON.parse(JSON.stringify(e)));
  if (wbClipboard.length) toast(`已复制 ${wbClipboard.length} 个元素`, "info");
}
function pasteWbClipboard() {
  if (!wbClipboard.length) return;
  // 有右键位置时贴到鼠标处，否则右下偏移 24
  let minX = Infinity, minY = Infinity;
  for (const n of wbClipboard) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
  const world = wbMenuPos ? editor.toWorld(wbMenuPos.x, wbMenuPos.y) : null;
  const idMap = new Map();
  const pasted = wbClipboard.map((n) => {
    const c = JSON.parse(JSON.stringify(n));
    idMap.set(c.id, newId());
    c.id = idMap.get(c.id);
    c.x = world ? world.x + (n.x - minX) : n.x + 24;
    c.y = world ? world.y + (n.y - minY) : n.y + 24;
    return c;
  });
  const pastedEdges = wbClipboardEdges
    .map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: newId(), from: idMap.get(e.from), to: idMap.get(e.to) }))
    .filter((e) => e.from && e.to);
  editor.doc.nodes.push(...pasted);
  editor.doc.edges.push(...pastedEdges);
  editor.selection = new Set(pasted.map((n) => n.id));
  editor.render(); editor.onChange(); editor.pushHistory();
  toast(`已粘贴 ${pasted.length} 个元素`, "info");
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
      `图形/文本选中：拖四角/四边手柄自由变换<br/>` +
      `文本选中：拖四角等比缩放字号<br/>` +
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
      `脑图：Tab 加子节点 · Enter 加同级<br/>` +
      `概括 / 外框 / 图片 / 图标 / 超链接 / 备注在顶部工具栏<br/>` +
      `备注：点「注」徽标或工具栏按钮弹框查看 / 编辑<br/>` +
      `选中节点：左侧面板改样式（颜色/字号/加粗/形状）<br/>` +
      `删除：Delete / Backspace<br/>` +
      `撤销：Ctrl/⌘ + Z · 重做：Ctrl+Y / ⌘+Shift+Z<br/>` +
      `平移：抓手 H / 中键拖拽 / Alt+拖拽 · 缩放：滚轮<br/>` +
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
      ["框选多选", ["拖空白处", "或", "Shift+拖"]], ["直线变换", ["拖端点 / 中点"]], ["自由变换", ["拖四角 / 四边手柄"]], ["删除", ["Delete"]],
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
    工具: [
      ["加子节点", ["Tab"]], ["加同级节点", ["Enter"]], ["关联线", ["L"]], ["抓手 / 平移", ["H"]],
      ["概括 / 外框", ["选中节点", "点顶部工具栏"]],
      ["图片 / 图标", ["选中节点", "点顶部工具栏"]], ["超链接 / 备注", ["选中节点", "点顶部工具栏"]],
    ],
    编辑器: [
      ["节点样式", ["选中节点", "左侧面板"]], ["备注弹框", ["点节点「注」徽标"]],
      ["框选多选", ["拖空白处", "或", "Shift+拖"]],
      ["关联线吸附", ["拖节点四角端点", "或", "悬停自动吸附"]],
      ["移动画布", ["抓手 H", "/", "中键拖拽", "或", "Alt+拖拽"]], ["缩放", ["滚轮"]], ["重置缩放", ["点击 100%"]],
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
  document.getElementById("outlineBtn").addEventListener("click", () => import("./outline.js").then((m) => m.openOutline(editor)));
  document.getElementById("delBtn").addEventListener("click", () => editor.deleteSelection());
  document.querySelectorAll("#modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  // 白板插入图片：本地图片转 dataURL 后放进画布中心
  document.getElementById("wbImageFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !editor) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const img = new Image();
      img.onload = async () => {
        // 默认压缩到 100KB 以内（按 原大小/上限 自动算缩放与质量）；设置项可关闭压缩
        const src = await compressImageDataURL(reader.result, { noCompress: !!settings.noCompressImage });
        // 脑图模式：图片附加到选中节点（图片在上、文字在下）
        if (editor.mode === "mindmap") {
          const selId = [...editor.selection][0];
          if (!selId) { toast("请先选中一个节点", "info"); return; }
          const maxW = 160;
          const sc = Math.min(1, maxW / (img.naturalWidth || maxW));
          editor.setNodeStyle({ image: src, imageW: Math.round(img.naturalWidth * sc), imageH: Math.round(img.naturalHeight * sc) });
          return;
        }
        const c = editor.viewCenterWorld();
        editor.addImageNode(src, c.x, c.y, img.naturalWidth, img.naturalHeight);
        editor.setTool("select");
        refreshWbActive();
      };
      img.onerror = () => toast("图片解码失败，请换一张试试", "error");
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });
  const titleInput = document.getElementById("titleInput");
  titleInput.addEventListener("input", () => { map.title = titleInput.value; scheduleSave(); });
  wireBottomBars();
  wireMobileDrawers();
  // 点击空白处关闭工具栏弹层（图标选择等，挂 body 的浮层统一由 closeBodyPop 管理）
  document.addEventListener("click", (e) => {
    if (_bodyPop && !_bodyPop.el.contains(e.target) && !_bodyPop.anchor.contains(e.target)) closeBodyPop();
    document.querySelectorAll(".gm-wb-more.open").forEach((m) => m.classList.remove("open"));
  });
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
    // 脑图关联线工具快捷键 L / 抓手工具快捷键 H
    if ((e.key === "l" || e.key === "L") && editor.mode === "mindmap" && !e.ctrlKey && !e.metaKey) {
      editor.setTool(editor.tool === "link" ? "select" : "link");
      refreshFcActive();
      return;
    }
    if ((e.key === "h" || e.key === "H") && editor.mode === "mindmap" && !e.ctrlKey && !e.metaKey) {
      editor.setTool(editor.tool === "hand" ? "select" : "hand");
      refreshFcActive();
      return;
    }
    // 流程图工具快捷键（V 选择 / 1-6 图形 / 7 图片 / L 关联线）
    if (editor.mode === "flowchart") {
      const fcKeys = { v: "select", "1": "shape:rect", "2": "shape:rounded", "3": "shape:diamond", "4": "shape:ellipse", "5": "shape:parallelogram", "6": "shape:text", "7": "image", l: "link" };
      const act = fcKeys[e.key.toLowerCase()];
      if (act) { e.preventDefault(); onFcAction(act); return; }
    }
    // 通用快捷键（所有模式）：创建副本 / 锁定 / 全选 / 复制
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); editor.duplicateSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); toggleLockSelection(); return; }
    if (editor.mode !== "whiteboard") {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); editor.selection = new Set(editor.doc.nodes.filter((n) => !n.locked).map((n) => n.id)); editor.render(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { e.preventDefault(); editor.duplicateSelection(); return; }
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
      // 白板：组合 / 解组 / 翻转 / 图层层级
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "g") { e.preventDefault(); toggleGroupSelection(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "g") { e.preventDefault(); toggleGroupSelection(); return; }
      if (e.shiftKey && e.key.toLowerCase() === "h") { e.preventDefault(); flipSelection("x"); return; }
      if (e.shiftKey && e.key.toLowerCase() === "v") { e.preventDefault(); flipSelection("y"); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "[") { e.preventDefault(); editor._reorderLayer("backward"); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "]") { e.preventDefault(); editor._reorderLayer("forward"); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "]") { e.preventDefault(); editor._reorderLayer("front"); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "[") { e.preventDefault(); editor._reorderLayer("back"); return; }
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

  editor = new Editor(document.getElementById("canvas"), { onChange: scheduleSave, onUndoRedoState: updateUndoRedoButtons, onToolChange: () => { refreshWbActive(); refreshWbStylePanel(); }, onSelectionChange: () => refreshWbStylePanel(), mode: map.type || "mindmap", onNoteBadge: (id) => { const n = editor.nodeById(id); if (n) openNoteModal(n); }, onEdgeEdit: (eid, childId) => openEdgeModal(eid, childId), onGroupEdit: (gid) => openGroupModal(gid), onImageZoom: openImageLightbox, onConfirmImageDelete: () => confirmDialog({ title: "删除含图片的节点", message: "该节点包含图片，确定要删除吗？此操作不可撤销。", okText: "删除", danger: true }) });
  window.__gmEditor = editor; // 测试钩子：headless 验证用
  wireContextMenus();
  editor.load(map.data);
  // 数据已加载并渲染完成，隐藏首屏 loading 遮罩
  const gmLoadingEl = document.getElementById("gmLoading");
  if (gmLoadingEl) gmLoadingEl.classList.add("gm-loading-hidden");
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
  buildSideRail();
  applySettings();
})();
