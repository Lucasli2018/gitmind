// 编辑器内核：SVG 画布、视图变换、选择/拖拽、连线、文本编辑、渲染
import { newId, sizeOf } from "./model.js";
import { layoutMindmap } from "./mindmap.js";

const SVGNS = "http://www.w3.org/2000/svg";
const PALETTE = ["#11b5a4", "#2f80ed", "#ff7a59", "#f5a623", "#9b59b6", "#16a34a", "#e5484d", "#0ea5e9"];

export class Editor {
  constructor(container, opts = {}) {
    this.container = container;
    this.onChange = opts.onChange || (() => {});
    this.mode = opts.mode || "mindmap";
    this.tool = "select";
    this.readOnly = !!opts.readOnly;
    this.doc = { type: this.mode, nodes: [], edges: [], strokes: [], view: { x: 0, y: 0, scale: 1 } };
    this.view = this.doc.view;
    this.selection = new Set();
    this.sizes = new Map();
    this._drag = null; this._pan = null; this._connect = null; this._stroke = null;
    this._pinch = null;
    // 白板扩展状态：图形拖拽创建 / 橡皮 / 激光笔 / 当前描边色
    this.toolColor = "#1f2a37";
    this._newShape = null; this._erasing = false; this._laser = null; this._laserRaf = null;
    // 撤销/重做历史栈（快照式，仅存数据不含视图）
    this._history = []; this._hidx = -1; this._restoring = false;
    this._updateUndoRedoButtons = opts.onUndoRedoState || null;

    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "gm-svg");
    svg.innerHTML =
      `<defs>
        <marker id="gm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"></path>
        </marker>
        <filter id="gm-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.12"></feDropShadow>
        </filter>
      </defs>
      <g id="gm-vp"></g>`;
    container.appendChild(svg);
    this.svg = svg;
    this.vp = svg.querySelector("#gm-vp");

    svg.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("dblclick", (e) => this.onDblClick(e));

    // 双指捏合缩放（移动端）：与 pointer 单指平移/拖拽共存
    svg.addEventListener("touchstart", (e) => this.onTouchStart(e), { passive: false });
    svg.addEventListener("touchmove", (e) => this.onTouchMove(e), { passive: false });
    svg.addEventListener("touchend", (e) => this.onTouchEnd(e), { passive: false });
    svg.addEventListener("touchcancel", (e) => this.onTouchEnd(e), { passive: false });
  }

  onTouchStart(e) {
    if (e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    const midX = (a.clientX + b.clientX) / 2, midY = (a.clientY + b.clientY) / 2;
    const w = this.toWorld(midX, midY);
    this._pinch = {
      startDist: Math.hypot(dx, dy) || 1,
      startScale: this.view.scale,
      worldX: w.x, worldY: w.y,
    };
    // 进入双指模式，放弃单指已开始的操作，避免冲突
    this._drag = null; this._pan = null; this._connect = null; this._stroke = null;
    this._newShape = null; this._erasing = false;
  }
  onTouchMove(e) {
    if (!this._pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    const dist = Math.hypot(dx, dy) || 1;
    const midX = (a.clientX + b.clientX) / 2, midY = (a.clientY + b.clientY) / 2;
    const scale = Math.min(3, Math.max(0.2, this._pinch.startScale * (dist / this._pinch.startDist)));
    this.view.scale = scale;
    const r = this.rect();
    this.view.x = (midX - r.left) - this._pinch.worldX * scale;
    this.view.y = (midY - r.top) - this._pinch.worldY * scale;
    this.render();
  }
  onTouchEnd(e) {
    if (e.touches.length < 2 && this._pinch) { this._pinch = null; this.onChange(); }
  }

  // ---------- 加载 / 模式 ----------
  load(doc) {
    this.doc = doc;
    this.doc.nodes = this.doc.nodes || [];
    this.doc.edges = this.doc.edges || [];
    this.doc.strokes = this.doc.strokes || [];
    this.doc.view = this.doc.view || { x: 0, y: 0, scale: 1 };
    this.view = this.doc.view;
    this.mode = this.doc.type || "mindmap";
    this.selection.clear();
    if (this.mode === "mindmap") layoutMindmap(this.doc);
    this.render();
    this.fitView(true);
    this._initHistory();
  }
  setMode(mode) {
    this.mode = mode;
    this.doc.type = mode;
    this.tool = "select";
    this.selection.clear();
    if (mode === "mindmap") layoutMindmap(this.doc);
    this.render();
    this.fitView(true);
    this.pushHistory();
  }

  // ---------- 撤销 / 重做 ----------
  _snapshot() {
    return JSON.stringify({
      type: this.doc.type,
      layout: this.doc.layout || "mindmap",
      nodes: this.doc.nodes,
      edges: this.doc.edges,
      strokes: this.doc.strokes,
    });
  }
  _initHistory() {
    this._history = [this._snapshot()];
    this._hidx = 0;
    this._notifyUndoRedo();
  }
  pushHistory() {
    if (this._restoring) return;
    // 截断 redo 分支：从历史当前点之后重新开始
    if (this._hidx < this._history.length - 1) this._history = this._history.slice(0, this._hidx + 1);
    this._history.push(this._snapshot());
    if (this._history.length > 80) this._history.shift();
    this._hidx = this._history.length - 1;
    this._notifyUndoRedo();
  }
  undo() {
    if (this._hidx <= 0) return;
    this._hidx--;
    this._restore(this._history[this._hidx]);
  }
  redo() {
    if (this._hidx >= this._history.length - 1) return;
    this._hidx++;
    this._restore(this._history[this._hidx]);
  }
  _restore(snap) {
    this._restoring = true;
    let s;
    try { s = JSON.parse(snap); } catch (_) { this._restoring = false; return; }
    this.doc.type = s.type || "mindmap";
    this.doc.layout = s.layout || "mindmap";
    this.doc.nodes = s.nodes || [];
    this.doc.edges = s.edges || [];
    this.doc.strokes = s.strokes || [];
    this.mode = this.doc.type;
    this.selection.clear();
    if (this.doc.type === "mindmap") layoutMindmap(this.doc);
    this.render();
    this._restoring = false;
    this._notifyUndoRedo();
    this.onChange();
  }
  _notifyUndoRedo() {
    if (this._updateUndoRedoButtons) this._updateUndoRedoButtons(this._hidx > 0, this._hidx < this._history.length - 1);
  }

  // ---------- 坐标转换 ----------
  rect() { return this.svg.getBoundingClientRect(); }
  toWorld(clientX, clientY) {
    const r = this.rect();
    return { x: (clientX - r.left - this.view.x) / this.view.scale, y: (clientY - r.top - this.view.y) / this.view.scale };
  }
  viewCenterWorld() {
    const r = this.rect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  // ---------- 渲染 ----------
  render() {
    this.sizes.clear();
    for (const n of this.doc.nodes) this.sizes.set(n.id, sizeOf(n, this.doc.type));

    let html = "";
    // 边（脑图模式按 parentId 派生连线，保证父子之间始终有线）
    let edges = this.doc.edges;
    if (this.doc.type === "mindmap") {
      edges = [];
      for (const n of this.doc.nodes) {
        if (n.parentId && this.nodeById(n.parentId)) edges.push({ id: "p-" + n.id, from: n.parentId, to: n.id });
      }
    }
    for (const e of edges) html += this.edgeHTML(e);
    // 自由画笔
    for (const s of this.doc.strokes) html += this.strokeHTML(s);
    if (this._stroke) html += this.strokeHTML(this._stroke);
    // 白板：拖拽创建中的临时图形
    if (this._newShape) html += this.tempShapeHTML();
    // 节点
    for (const n of this.doc.nodes) html += this.nodeHTML(n, this.selection.has(n.id));
    // 临时连线
    if (this._connect) html += this.tempConnectHTML();
    // 白板：激光笔轨迹（最上层，不持久化）
    if (this._laser && this._laser.pts.length > 1) html += this.laserHTML();

    this.vp.innerHTML = html;
    this.vp.setAttribute("transform", `translate(${this.view.x},${this.view.y}) scale(${this.view.scale})`);
  }

  shapeHTML(n, s) {
    const { w, h } = s;
    const fill = n.color || "#fff";
    const stroke = n.stroke || "#94a3b8";
    switch (n.shape) {
      case "rect": return `<rect x="0" y="0" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      case "diamond": return `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      case "ellipse": return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      case "parallelogram": return `<polygon points="18,0 ${w},0 ${w - 18},${h} 0,${h}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      case "sticky": return `<g filter="url(#gm-shadow)"><rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></g>`;
      case "text": return ``;
      case "frame": return (
        `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="none" stroke="#aab3bf" stroke-width="1.5" stroke-dasharray="8 6"/>` +
        `<text x="2" y="-9" font-size="14" font-weight="600" fill="#8a94a6" font-family='-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'>${escapeXml(n.text || "")}</text>`
      );
      case "arrow":
      case "line": {
        // w / h 为相对起点的增量（可为负），画在本地坐标系 (0,0) -> (w,h)
        const arrow = n.shape === "arrow" ? ` marker-end="url(#gm-arrow)"` : "";
        return `<path d="M 0,0 L ${n.w},${n.h}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"${arrow}/>`;
      }
      case "image": return `<image href="${n.src || ""}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
      case "embed": {
        // 底框始终绘制（导出 PNG/SVG 时 iframe 不可渲染，仍有边框提示）
        let out = `<rect x="0" y="0" width="${w}" height="${h}" rx="10" fill="#fff" stroke="#aab3bf" stroke-width="1.5"/>` +
          `<rect x="0" y="0" width="${w}" height="26" rx="10" fill="#f2f5f8" stroke="#aab3bf" stroke-width="1.5"/>` +
          `<text x="10" y="17" font-size="12" fill="#64748b" font-family='-apple-system,"PingFang SC",sans-serif'>${escapeXml(this._shortUrl(n.url))}</text>`;
        if (!this._forExport) {
          out += `<foreignObject x="0" y="26" width="${w}" height="${h - 26}">` +
            `<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;">` +
            `<iframe src="${escapeXml(n.url || "")}" style="width:100%;height:100%;border:0;" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>` +
            `</div></foreignObject>` +
            // 透明遮罩：拦截 iframe 事件，保证节点可选中 / 可拖动
            `<rect x="0" y="0" width="${w}" height="${h}" fill="transparent"/>`;
        }
        return out;
      }
      case "rounded":
      default: return `<rect x="0" y="0" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    }
  }

  _shortUrl(u) {
    try { return new URL(u).hostname; } catch (_) { return u || "网页"; }
  }

  nodeHTML(n, selected) {
    const s = this.sizes.get(n.id) || sizeOf(n, this.doc.type);
    const { w, h, lines } = s;
    let inner = this.shapeHTML(n, s);
    // 文本（箭头/直线/图片/嵌入网页/画框标签已自绘，跳过居中文本）
    const TEXTLESS = ["arrow", "line", "image", "embed", "frame"];
    if (!TEXTLESS.includes(n.shape)) {
      const fs = n.fontSize || 15;
      const LH = fs + 7;
      const totalH = lines.length * LH;
      let startY = h / 2 - totalH / 2 + LH / 2;
      let tspans = "";
      lines.forEach((ln, i) => {
        tspans += `<tspan x="${w / 2}" y="${(startY + i * LH).toFixed(1)}">${escapeXml(ln) || " "}</tspan>`;
      });
      const tcolor = n.textColor || "#1f2a37";
      inner += `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="${fs}" font-family='-apple-system,"PingFang SC","Microsoft YaHei",sans-serif' fill="${tcolor}" font-weight="${n.shape === "text" ? 600 : 500}">${tspans}</text>`;
    }
    // 选中框
    if (selected) inner += `<rect x="-5" y="-5" width="${w + 10}" height="${h + 10}" rx="14" fill="none" stroke="#11b5a4" stroke-width="2" stroke-dasharray="6 4"/>`;
    // 流程图连线端口
    if (this.mode === "flowchart" && !this._forExport) {
      const ports = [["top", w / 2, 0], ["bottom", w / 2, h], ["left", 0, h / 2], ["right", w, h / 2]];
      for (const [p, px, py] of ports) inner += `<circle class="gm-port" data-id="${n.id}" data-port="${p}" cx="${px}" cy="${py}" r="6" fill="#fff" stroke="#11b5a4" stroke-width="2"/>`;
    }
    return `<g class="gm-node${selected ? " sel" : ""}" data-id="${n.id}" transform="translate(${n.x},${n.y})">${inner}</g>`;
  }

  edgeHTML(e) {
    const a = this.nodeById(e.from), b = this.nodeById(e.to);
    if (!a || !b) return "";
    const sa = this.sizes.get(a.id), sb = this.sizes.get(b.id);
    if (!sa || !sb) return "";
    let d, stroke, marker = "";
    if (this.doc.type === "mindmap") {
      const side = b.side || "right";
      const isList = this.doc.layout === "list";
      let px, py, cx, cy;
      if (side === "left") { px = a.x; py = a.y + sa.h / 2; cx = b.x + sb.w; cy = b.y + sb.h / 2; }
      else if (side === "down") { px = a.x + sa.w / 2; py = a.y + sa.h; cx = b.x + sb.w / 2; cy = b.y; }
      else { px = a.x + sa.w; py = a.y + sa.h / 2; cx = b.x; cy = b.y + sb.h / 2; }
      stroke = b.stroke || "#11b5a4";
      if (side === "down") {
        const my = (py + cy) / 2;
        d = `M ${px},${py} C ${px},${my} ${cx},${my} ${cx},${cy}`;
      } else if (isList) {
        const mx = (px + cx) / 2;
        d = `M ${px},${py} H ${mx} V ${cy} H ${cx}`;
      } else {
        const dx = cx - px;
        d = `M ${px},${py} C ${px + dx * 0.5},${py} ${cx - dx * 0.5},${cy} ${cx},${cy}`;
      }
    } else {
      const ax = a.x + sa.w / 2, ay = a.y + sa.h / 2, bx = b.x + sb.w / 2, by = b.y + sb.h / 2;
      const sBottom = ay < by;
      const sx = ax, sy = sBottom ? a.y + sa.h : a.y;
      const tx = bx, ty = sBottom ? b.y : b.y + sb.h;
      const my = (sy + ty) / 2;
      d = `M ${sx},${sy} C ${sx},${my} ${tx},${my} ${tx},${ty}`;
      stroke = "#94a3b8";
      marker = ` marker-end="url(#gm-arrow)"`;
    }
    let label = "";
    if (e.label) {
      const mx = (a.x + b.x) / 2 + sa.w / 4, my = (a.y + b.y) / 2;
      label = `<rect x="${mx - 14}" y="${my - 11}" width="28" height="20" rx="5" fill="#fff" stroke="#e2e8f0"/><text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="12" fill="#64748b">${escapeXml(e.label)}</text>`;
    }
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="2"${marker}/>${label}`;
  }

  strokeHTML(s) {
    if (!s.points || s.points.length < 2) return "";
    const d = "M " + s.points.map((p) => `${p.x},${p.y}`).join(" L ");
    return `<path d="${d}" fill="none" stroke="${s.color || "#1f2a37"}" stroke-width="${s.width || 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  tempConnectHTML() {
    const a = this.nodeById(this._connect.from);
    if (!a) return "";
    const s = this.sizes.get(a.id);
    const sx = a.x + s.w / 2, sy = a.y + s.h;
    const p = this.toWorld(this._connect.cx, this._connect.cy);
    return `<path d="M ${sx},${sy} C ${sx},${(sy + p.y) / 2} ${p.x},${(sy + p.y) / 2} ${p.x},${p.y}" fill="none" stroke="#11b5a4" stroke-width="2" stroke-dasharray="5 4"/>`;
  }

  // ---------- 查找 ----------
  nodeById(id) { return this.doc.nodes.find((n) => n.id === id); }
  childrenMap() {
    const m = new Map();
    for (const n of this.doc.nodes) { if (n.parentId) { if (!m.has(n.parentId)) m.set(n.parentId, []); m.get(n.parentId).push(n.id); } }
    return m;
  }
  descendants(id, set = new Set()) {
    const cm = this.childrenMap();
    for (const c of cm.get(id) || []) { set.add(c); this.descendants(c, set); }
    return set;
  }

  // ---------- 选择 ----------
  select(id, additive) {
    if (!additive) this.selection.clear();
    if (this.selection.has(id) && additive) this.selection.delete(id);
    else this.selection.add(id);
    this.render();
  }
  clearSelection() { this.selection.clear(); this.render(); }

  // ---------- 平移 / 缩放 ----------
  panBy(dx, dy) { this.view.x += dx; this.view.y += dy; this.render(); }
  zoomAt(factor, clientX, clientY) {
    const r = this.rect();
    const px = clientX - r.left, py = clientY - r.top;
    const wx = (px - this.view.x) / this.view.scale, wy = (py - this.view.y) / this.view.scale;
    this.view.scale = Math.min(3, Math.max(0.2, this.view.scale * factor));
    this.view.x = px - wx * this.view.scale;
    this.view.y = py - wy * this.view.scale;
    this.render();
  }
  onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomAt(factor, e.clientX, e.clientY);
  }
  fitView(immediate) {
    const b = this.getBounds();
    const r = this.rect();
    if (!b) { this.view = { x: r.width * 0.12, y: r.height / 2, scale: 1 }; this.render(); return; }
    const pad = 60;
    const scale = Math.min(1.3, Math.max(0.2, Math.min((r.width - pad) / b.w, (r.height - pad) / b.h)));
    this.view.scale = scale;
    this.view.x = (r.width - b.w * scale) / 2 - b.x * scale;
    this.view.y = (r.height - b.h * scale) / 2 - b.y * scale;
    this.render();
  }
  // 节点包围盒（箭头 / 直线的 w、h 是增量，可能为负）
  nodeBBox(n) {
    const s = this.sizes.get(n.id) || sizeOf(n, this.doc.type);
    if (n.shape === "arrow" || n.shape === "line") {
      return { x: Math.min(n.x, n.x + (n.w || 0)), y: Math.min(n.y, n.y + (n.h || 0)), w: Math.max(2, Math.abs(n.w || 0)), h: Math.max(2, Math.abs(n.h || 0)) };
    }
    return { x: n.x, y: n.y, w: s.w, h: s.h };
  }

  getBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.doc.nodes) {
      const b = this.nodeBBox(n); if (!b) continue;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    for (const st of this.doc.strokes) for (const p of st.points || []) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    if (minX === Infinity) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // ---------- 指针事件 ----------
  onDown(e) {
    if (e.button !== 0) return;
    if (this._pinch) return;
    const r = this.rect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const target = e.target;

    if (this.readOnly) {
      if (!e.shiftKey) this.clearSelection();
      this._pan = { sx, sy, ox: this.view.x, oy: this.view.y };
      return;
    }

    // ---------- 白板各工具 ----------
    if (this.mode === "whiteboard") {
      const w = this.toWorld(e.clientX, e.clientY);
      switch (this.tool) {
        case "hand":
          this._pan = { sx, sy, ox: this.view.x, oy: this.view.y };
          return;
        case "pen": {
          this._stroke = { id: newId(), points: [{ x: w.x, y: w.y }], color: this.toolColor, width: 3 };
          return;
        }
        case "laser":
          this._laser = { pts: [{ x: w.x, y: w.y, t: performance.now() }] };
          this._startLaserLoop();
          return;
        case "eraser":
          this._erasing = true;
          this._erased = false;
          this.eraseAt(w);
          return;
        case "text":
          this.addTextNode(w.x, w.y);
          return;
        case "image":
          return; // 图片由 main.js 通过文件选择器插入
        case "select":
          break; // 走下方通用选择 / 拖拽逻辑
        default: // frame / rect / diamond / ellipse / arrow / line：拖拽创建
          this._newShape = { tool: this.tool, x0: w.x, y0: w.y, x1: w.x, y1: w.y };
          return;
      }
    }

    const portEl = target.closest && target.closest(".gm-port");
    const hitEl = target.closest && target.closest("[data-id]");
    const id = hitEl ? hitEl.getAttribute("data-id") : null;

    if (portEl && id) { this._connect = { from: id, cx: e.clientX, cy: e.clientY }; return; }

    if (id) {
      if (e.shiftKey) this.select(id, true);
      else if (!this.selection.has(id)) this.select(id, false);
      const movable = this.getMovable(this.selection);
      const orig = {};
      movable.forEach((mid) => { const nd = this.nodeById(mid); orig[mid] = { x: nd.x, y: nd.y }; });
      this._drag = { sx, sy, moved: false, orig, movable };
      return;
    }
    // 空白：平移
    if (!e.shiftKey) this.clearSelection();
    this._pan = { sx, sy, ox: this.view.x, oy: this.view.y };
  }

  onMove(e) {
    if (this._pinch) return;
    if (this._stroke) {
      const w = this.toWorld(e.clientX, e.clientY);
      this._stroke.points.push({ x: w.x, y: w.y });
      this.render();
      return;
    }
    if (this._newShape) {
      const w = this.toWorld(e.clientX, e.clientY);
      this._newShape.x1 = w.x; this._newShape.y1 = w.y;
      // Shift 吸附：箭头 / 直线按 45° 角
      if ((this._newShape.tool === "arrow" || this._newShape.tool === "line") && e.shiftKey) {
        const dx = w.x - this._newShape.x0, dy = w.y - this._newShape.y0;
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        this._newShape.x1 = this._newShape.x0 + Math.cos(ang) * len;
        this._newShape.y1 = this._newShape.y0 + Math.sin(ang) * len;
      }
      this.render();
      return;
    }
    if (this._erasing) { this.eraseAt(this.toWorld(e.clientX, e.clientY)); return; }
    if (this._laser) {
      this._laser.pts.push({ x: this.toWorld(e.clientX, e.clientY).x, y: this.toWorld(e.clientX, e.clientY).y, t: performance.now() });
      this._startLaserLoop();
      this.render();
      return;
    }
    if (this._connect) { this._connect.cx = e.clientX; this._connect.cy = e.clientY; this.render(); return; }
    if (this._drag) {
      const r = this.rect();
      const dx = (e.clientX - r.left - this._drag.sx) / this.view.scale;
      const dy = (e.clientY - r.top - this._drag.sy) / this.view.scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this._drag.moved = true;
      for (const mid of this._drag.movable) {
        const nd = this.nodeById(mid); const o = this._drag.orig[mid];
        if (nd && o) { nd.x = o.x + dx; nd.y = o.y + dy; }
      }
      this.render();
      return;
    }
    if (this._pan) {
      this.view.x = this._pan.ox + (e.clientX - this.rect().left - this._pan.sx);
      this.view.y = this._pan.oy + (e.clientY - this.rect().top - this._pan.sy);
      this.render();
      return;
    }
  }

  onUp(e) {
    if (this._newShape) { this.finishNewShape(); return; }
    if (this._erasing) { this._erasing = false; if (this._erased) { this.onChange(); this.pushHistory(); } this._erased = false; return; }
    if (this._laser) { this._startLaserLoop(); return; } // 轨迹交给淡出循环清理
    if (this._stroke) {
      if (this._stroke.points.length > 1) this.doc.strokes.push(this._stroke);
      this._stroke = null; this.render(); this.onChange(); this.pushHistory(); return;
    }
    if (this._connect) {
      const hitEl = e.target.closest && e.target.closest("[data-id]");
      const to = hitEl ? hitEl.getAttribute("data-id") : null;
      if (to && to !== this._connect.from) this.addEdge(this._connect.from, to);
      this._connect = null; this.render(); this.onChange(); this.pushHistory(); return;
    }
    if (this._drag) { if (this._drag.moved) { this.onChange(); this.pushHistory(); } this._drag = null; return; }
    if (this._pan) { this._pan = null; return; }
  }

  onDblClick(e) {
    if (this.readOnly) return;
    const hitEl = e.target.closest && e.target.closest("[data-id]");
    if (!hitEl) return;
    const n = this.nodeById(hitEl.getAttribute("data-id"));
    if (!n) return;
    if (n.shape === "embed") {
      const url = prompt("输入要嵌入的网页地址", n.url || "https://");
      if (url && url !== n.url) { n.url = url.trim(); this.render(); this.onChange(); this.pushHistory(); }
      return;
    }
    this.beginTextEdit(n.id);
  }

  getMovable(set) {
    if (this.mode !== "mindmap") return new Set(set);
    const out = new Set(set);
    for (const id of set) this.descendants(id, out);
    return out;
  }

  // ---------- 文本编辑 ----------
  beginTextEdit(id) {
    const n = this.nodeById(id); if (!n) return;
    const s = this.sizes.get(n.id) || sizeOf(n, this.doc.type);
    const r = this.rect();
    const left = r.left + this.view.x + n.x * this.view.scale;
    const top = r.top + this.view.y + n.y * this.view.scale;
    // 底色跟随节点填充色，保证文字始终可见（避免白字白底）
    const solid = n.color && n.color !== "#fff" && n.color !== "transparent" && n.color.toLowerCase() !== "#ffffff";
    const bg = solid ? n.color : "#fff";
    const fg = solid ? (n.textColor || "#fff") : (isLightColor(bg) ? "#1f2a37" : "#fff");
    const ta = document.createElement("textarea");
    ta.value = n.text || "";
    ta.className = "gm-edit";
    ta.style.cssText =
      `position:fixed; left:${left}px; top:${top}px; width:${Math.max(s.w * this.view.scale, 60)}px; height:${Math.max(s.h * this.view.scale, 30)}px;` +
      `font-size:${ (n.fontSize || 15) * this.view.scale }px; border:2px solid #11b5a4; border-radius:12px; padding:6px 8px;` +
      `resize:none; outline:none; text-align:center; box-sizing:border-box; font-family:inherit; color:${fg}; background:${bg}; z-index:50; overflow:hidden;`;
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const commit = () => {
      const old = n.text;
      const val = ta.value;
      ta.remove();
      if (val !== old) { n.text = val; this.render(); this.pushHistory(); this.onChange(); }
      else { this.render(); }
    };
    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); ta.remove(); }
      ev.stopPropagation();
    });
  }

  // ---------- 增删 ----------
  addEdge(from, to, label) {
    if (from === to) return;
    if (this.doc.edges.some((e) => e.from === from && e.to === to)) return;
    this.doc.edges.push({ id: newId(), from, to, label: label || "", arrow: true });
  }

  addMindmapChild(parentId) {
    const parent = this.nodeById(parentId); if (!parent) return null;
    const id = newId();
    const node = { id, x: parent.x + 200, y: parent.y, w: 124, h: 44, text: "新节点", shape: "rounded", color: "#fff", textColor: "#1f2a37", stroke: parent.stroke || "#11b5a4", fontSize: 15, parentId, collapsed: false };
    this.doc.nodes.push(node);
    layoutMindmap(this.doc);
    this.selection = new Set([id]);
    this.render(); this.onChange();
    this.pushHistory();
    this.beginTextEdit(id);
    return id;
  }
  addMindmapSibling(nodeId) {
    const node = this.nodeById(nodeId); if (!node || node.parentId == null) return this.addMindmapChild(nodeId);
    const id = newId();
    const pNode = this.nodeById(node.parentId);
    const newNode = { id, x: node.x, y: node.y + 60, w: 124, h: 44, text: "新节点", shape: "rounded", color: "#fff", textColor: "#1f2a37", stroke: pNode ? pNode.stroke : "#11b5a4", fontSize: 15, parentId: node.parentId, collapsed: false };
    this.doc.nodes.push(newNode);
    layoutMindmap(this.doc);
    this.selection = new Set([id]);
    this.render(); this.onChange();
    this.pushHistory();
    this.beginTextEdit(id);
    return id;
  }
  deleteSelection() {
    const ids = [...this.selection]; if (!ids.length) return;
    const toDelete = this.getMovable(new Set(ids));
    this.doc.nodes = this.doc.nodes.filter((n) => !toDelete.has(n.id));
    this.doc.edges = this.doc.edges.filter((e) => !toDelete.has(e.from) && !toDelete.has(e.to));
    if (this.mode === "mindmap") layoutMindmap(this.doc);
    this.selection.clear();
    this.render(); this.onChange();
    this.pushHistory();
  }

  addFlowShape(shape, wx, wy) {
    const dims = { rect: [140, 50], diamond: [150, 92], ellipse: [130, 64], parallelogram: [150, 64], rounded: [140, 50] }[shape] || [140, 50];
    const id = newId();
    const node = { id, x: wx - dims[0] / 2, y: wy - dims[1] / 2, w: dims[0], h: dims[1], text: shape === "diamond" ? "判断?" : "文本", shape, color: "#fff", textColor: "#1f2a37", stroke: "#2f80ed", fontSize: 14, parentId: null, collapsed: false };
    this.doc.nodes.push(node);
    this.selection = new Set([id]);
    this.render(); this.onChange();
    this.pushHistory();
    this.beginTextEdit(id);
    return id;
  }
  addWhiteboardNode(shape, wx, wy) {
    const id = newId();
    const node = shape === "sticky"
      ? { id, x: wx - 90, y: wy - 65, w: 180, h: 130, text: "双击编辑便签", shape: "sticky", color: "#fff3bf", textColor: "#7a5b00", stroke: "#ffe08a", fontSize: 15, parentId: null, collapsed: false }
      : { id, x: wx - 120, y: wy - 20, w: 240, h: 40, text: "双击编辑文字", shape: "text", color: "transparent", textColor: "#1f2a37", stroke: "transparent", fontSize: 18, parentId: null, collapsed: false };
    this.doc.nodes.push(node);
    this.selection = new Set([id]);
    this.render(); this.onChange();
    this.pushHistory();
    this.beginTextEdit(id);
    return id;
  }

  setTool(tool) {
    this.tool = tool;
    if (tool === "select" || tool === "hand") this.container.style.cursor = "default";
    else if (tool === "laser") this.container.style.cursor = "crosshair";
    else this.container.style.cursor = "crosshair";
    if (tool !== "laser") this._laser = null;
  }

  // ===================== 白板扩展 =====================

  // 结束拖拽，创建图形（拖动距离过小则用默认尺寸）
  finishNewShape() {
    const t = this._newShape;
    this._newShape = null;
    if (!t) return;
    const dx = t.x1 - t.x0, dy = t.y1 - t.y0;
    const tiny = Math.hypot(dx, dy) < 8;
    const color = this.toolColor;
    let node;
    if (t.tool === "arrow" || t.tool === "line") {
      const w = tiny ? 180 : dx, h = tiny ? 0 : dy;
      node = { id: newId(), shape: t.tool, x: t.x0, y: t.y0, w, h, text: "", color: "transparent", textColor: "#1f2a37", stroke: color, fontSize: 14, parentId: null, collapsed: false };
    } else if (t.tool === "frame") {
      const w = tiny ? 360 : Math.abs(dx), h = tiny ? 260 : Math.abs(dy);
      const x = tiny ? t.x0 - w / 2 : Math.min(t.x0, t.x1);
      const y = tiny ? t.y0 - h / 2 : Math.min(t.y0, t.y1);
      node = { id: newId(), shape: "frame", x, y, w, h, text: this._nextFrameName(), color: "transparent", textColor: "#8a94a6", stroke: "#aab3bf", fontSize: 14, parentId: null, collapsed: false };
    } else {
      const defs = { rect: [140, 100], diamond: [160, 110], ellipse: [140, 100] };
      const [dw, dh] = defs[t.tool] || [140, 100];
      const w = tiny ? dw : Math.abs(dx), h = tiny ? dh : Math.abs(dy);
      const x = tiny ? t.x0 - w / 2 : Math.min(t.x0, t.x1);
      const y = tiny ? t.y0 - h / 2 : Math.min(t.y0, t.y1);
      node = { id: newId(), shape: t.tool, x, y, w, h, text: "", color: "#fff", textColor: "#1f2a37", stroke: color, fontSize: 15, parentId: null, collapsed: false };
    }
    this.doc.nodes.push(node);
    this.selection = new Set([node.id]);
    this.render();
    this.onChange();
    this.pushHistory();
    // 基础图形创建后直接进入文字编辑，画框不进入
    if (["rect", "diamond", "ellipse"].includes(t.tool)) this.beginTextEdit(node.id);
  }

  _nextFrameName() {
    const n = this.doc.nodes.filter((x) => x.shape === "frame").length + 1;
    return `Frame ${n}`;
  }

  // 拖拽创建中的虚线预览
  tempShapeHTML() {
    const t = this._newShape;
    const x = Math.min(t.x0, t.x1), y = Math.min(t.y0, t.y1);
    const w = Math.abs(t.x1 - t.x0), h = Math.abs(t.y1 - t.y0);
    const dash = `fill="none" stroke="${this.toolColor}" stroke-width="2" stroke-dasharray="6 4" opacity="0.8"`;
    switch (t.tool) {
      case "frame": return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ${dash}/>`;
      case "rect": return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" ${dash}/>`;
      case "diamond": return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${dash}/>`;
      case "ellipse": return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${dash}/>`;
      case "arrow": return `<path d="M ${t.x0},${t.y0} L ${t.x1},${t.y1}" fill="none" stroke="${this.toolColor}" stroke-width="2" stroke-dasharray="6 4" opacity="0.8" marker-end="url(#gm-arrow)"/>`;
      case "line": return `<path d="M ${t.x0},${t.y0} L ${t.x1},${t.y1}" fill="none" stroke="${this.toolColor}" stroke-width="2" stroke-dasharray="6 4" opacity="0.8"/>`;
      default: return "";
    }
  }

  // ---------- 橡皮 ----------
  eraseAt(w) {
    const tol = 6 / this.view.scale;
    // 命中笔画：点到各线段距离
    const strokeHit = (s) => (s.points || []).some((p) => Math.hypot(p.x - w.x, p.y - w.y) <= tol + (s.width || 3) / 2);
    // 命中节点：包围盒外扩容差
    const nodeHit = (n) => {
      const b = this.nodeBBox(n);
      return w.x >= b.x - tol && w.x <= b.x + b.w + tol && w.y >= b.y - tol && w.y <= b.y + b.h + tol;
    };
    const before = { nodes: this.doc.nodes.length, strokes: this.doc.strokes.length };
    this.doc.strokes = this.doc.strokes.filter((s) => !strokeHit(s));
    const hit = this.doc.nodes.find(nodeHit);
    if (hit) {
      this.doc.nodes = this.doc.nodes.filter((n) => n.id !== hit.id);
      this.selection.delete(hit.id);
      this.doc.edges = this.doc.edges.filter((ed) => ed.from !== hit.id && ed.to !== hit.id);
    }
    if (this.doc.nodes.length !== before.nodes || this.doc.strokes.length !== before.strokes) {
      this._erased = true;
      this.render();
    }
  }

  // ---------- 激光笔 ----------
  laserHTML() {
    const now = performance.now();
    const LIFE = 900;
    const pts = this._laser.pts.filter((p) => now - p.t < LIFE);
    this._laser.pts = pts;
    let out = "";
    for (let i = 1; i < pts.length; i++) {
      const age = (now - pts[i].t) / LIFE;
      out += `<path d="M ${pts[i - 1].x},${pts[i - 1].y} L ${pts[i].x},${pts[i].y}" fill="none" stroke="#e5484d" stroke-width="3.5" stroke-linecap="round" opacity="${(1 - age).toFixed(2)}"/>`;
    }
    const last = pts[pts.length - 1];
    if (last) {
      const age = (now - last.t) / LIFE;
      out += `<circle cx="${last.x}" cy="${last.y}" r="5" fill="#e5484d" opacity="${(1 - age).toFixed(2)}"/>`;
    }
    return out;
  }
  _startLaserLoop() {
    if (this._laserRaf) return;
    const tick = () => {
      if (!this._laser || !this._laser.pts.length) { this._laserRaf = null; return; }
      const now = performance.now();
      if (this._laser.pts.some((p) => now - p.t < 900)) {
        this.render();
        this._laserRaf = requestAnimationFrame(tick);
      } else {
        this._laser = null;
        this.render();
        this._laserRaf = null;
      }
    };
    this._laserRaf = requestAnimationFrame(tick);
  }

  // ---------- 白板元素创建 ----------
  addTextNode(wx, wy) {
    const id = newId();
    const node = { id, x: wx - 120, y: wy - 20, w: 240, h: 40, text: "", shape: "text", color: "transparent", textColor: this.toolColor, stroke: "transparent", fontSize: 18, parentId: null, collapsed: false };
    this.doc.nodes.push(node);
    this.selection = new Set([id]);
    this.render(); this.onChange(); this.pushHistory();
    this.beginTextEdit(id);
    return id;
  }
  addImageNode(src, wx, wy, nw, nh) {
    const maxW = 360;
    const scale = Math.min(1, maxW / (nw || maxW));
    const w = Math.round((nw || maxW) * scale), h = Math.round((nh || maxW * 0.6) * scale);
    const id = newId();
    const node = { id, x: wx - w / 2, y: wy - h / 2, w, h, text: "", shape: "image", src, color: "transparent", textColor: "#1f2a37", stroke: "transparent", fontSize: 14, parentId: null, collapsed: false };
    this.doc.nodes.push(node);
    this.selection = new Set([id]);
    this.render(); this.onChange(); this.pushHistory();
    return id;
  }
  addEmbedNode(url, wx, wy) {
    const id = newId();
    const node = { id, x: wx - 240, y: wy - 170, w: 480, h: 340, text: "", shape: "embed", url, color: "transparent", textColor: "#1f2a37", stroke: "#aab3bf", fontSize: 14, parentId: null, collapsed: false };
    this.doc.nodes.push(node);
    this.selection = new Set([id]);
    this.render(); this.onChange(); this.pushHistory();
    return id;
  }
  clearWhiteboard() {
    this.doc.nodes = [];
    this.doc.edges = [];
    this.doc.strokes = [];
    this.selection.clear();
    this.render(); this.onChange(); this.pushHistory();
  }
}

function escapeXml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 判断颜色是否为浅色（用于编辑框文字取对比色）
function isLightColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return true;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

export { PALETTE };
