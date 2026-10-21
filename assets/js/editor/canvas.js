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
  }
  setMode(mode) {
    this.mode = mode;
    this.doc.type = mode;
    this.tool = "select";
    this.selection.clear();
    if (mode === "mindmap") layoutMindmap(this.doc);
    this.render();
    this.fitView(true);
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
    // 节点
    for (const n of this.doc.nodes) html += this.nodeHTML(n, this.selection.has(n.id));
    // 临时连线
    if (this._connect) html += this.tempConnectHTML();

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
      case "rounded":
      default: return `<rect x="0" y="0" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    }
  }

  nodeHTML(n, selected) {
    const s = this.sizes.get(n.id) || sizeOf(n, this.doc.type);
    const { w, h, lines } = s;
    let inner = this.shapeHTML(n, s);
    // 文本
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
  getBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.doc.nodes) {
      const s = this.sizes.get(n.id); if (!s) continue;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + s.w); maxY = Math.max(maxY, n.y + s.h);
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

    if (this.mode === "whiteboard" && this.tool === "pen") {
      const w = this.toWorld(e.clientX, e.clientY);
      this._stroke = { id: newId(), points: [{ x: w.x, y: w.y }], color: this.toolColor || "#1f2a37", width: 3 };
      return;
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
    if (this._stroke) {
      if (this._stroke.points.length > 1) this.doc.strokes.push(this._stroke);
      this._stroke = null; this.render(); this.onChange(); return;
    }
    if (this._connect) {
      const hitEl = e.target.closest && e.target.closest("[data-id]");
      const to = hitEl ? hitEl.getAttribute("data-id") : null;
      if (to && to !== this._connect.from) this.addEdge(this._connect.from, to);
      this._connect = null; this.render(); this.onChange(); return;
    }
    if (this._drag) { if (this._drag.moved) this.onChange(); this._drag = null; return; }
    if (this._pan) { this._pan = null; return; }
  }

  onDblClick(e) {
    if (this.readOnly) return;
    const hitEl = e.target.closest && e.target.closest("[data-id]");
    if (hitEl) this.beginTextEdit(hitEl.getAttribute("data-id"));
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
      n.text = ta.value;
      ta.remove();
      this.render();
      this.onChange();
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
  }

  addFlowShape(shape, wx, wy) {
    const dims = { rect: [140, 50], diamond: [150, 92], ellipse: [130, 64], parallelogram: [150, 64], rounded: [140, 50] }[shape] || [140, 50];
    const id = newId();
    const node = { id, x: wx - dims[0] / 2, y: wy - dims[1] / 2, w: dims[0], h: dims[1], text: shape === "diamond" ? "判断?" : "文本", shape, color: "#fff", textColor: "#1f2a37", stroke: "#2f80ed", fontSize: 14, parentId: null, collapsed: false };
    this.doc.nodes.push(node);
    this.selection = new Set([id]);
    this.render(); this.onChange();
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
    this.beginTextEdit(id);
    return id;
  }

  setTool(tool) { this.tool = tool; if (tool === "select") this.container.style.cursor = "default"; else this.container.style.cursor = "crosshair"; }
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
