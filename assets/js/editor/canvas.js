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
    // 白板图形默认属性（属性面板数据源）：描边/背景/宽度/边框样式/线条风格/边角/透明度
    // 文字默认属性：字号/字体族/斜体/对齐（文字工具与文字属性面板共用）
    this.wbProps = { stroke: "#1f2a37", fill: "#ffffff", strokeWidth: 2, strokeStyle: "solid", roughness: 0, rounded: true, opacity: 1, fontSize: 18, fontStyle: "normal", fontFamily: "sans", textAlign: "center" };
    // 网格显示（右键菜单切换，localStorage 记忆）
    this.showGrid = false;
    try { this.showGrid = localStorage.getItem("gm_wb_grid") === "1"; } catch (_) {}
    this._onSelectionChange = opts.onSelectionChange || null;
    this._newShape = null; this._erasing = false; this._laser = null; this._laserRaf = null;
    this._marquee = null; this._laserDown = false;
    this._onToolChange = opts.onToolChange || null;
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
    this._newShape = null; this._erasing = false; this._marquee = null; this._laserDown = false; this._handle = null;
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
    // 白板网格（不进导出）
    if (this.showGrid && !this._forExport) html += this.gridHTML();
    // 边（脑图模式按 parentId 派生连线，保证父子之间始终有线）
    let edges = this.doc.edges;
    if (this.doc.type === "mindmap") {
      edges = [];
      for (const n of this.doc.nodes) {
        if (n.parentId && this.nodeById(n.parentId)) edges.push({ id: "p-" + n.id, from: n.parentId, to: n.id });
      }
      // 关联线（工具栏创建的任意两节点连线）附加在父子连线之上
      edges = edges.concat(this.doc.edges.filter((e) => e.assoc));
    }
    for (const e of edges) html += this.edgeHTML(e);
    // 自由画笔
    for (const s of this.doc.strokes) html += this.strokeHTML(s);
    if (this._stroke) html += this.strokeHTML(this._stroke);
    // 白板：拖拽创建中的临时图形
    if (this._newShape) html += this.tempShapeHTML();
    // 白板：框选矩形
    if (this._marquee) html += this.marqueeHTML();
    // 节点
    for (const n of this.doc.nodes) html += this.nodeHTML(n, this.selection.has(n.id));
    // 临时连线
    if (this._connect) html += this.tempConnectHTML();
    // 白板：激光笔轨迹（最上层，不持久化）
    if (this._laser && this._laser.pts.length > 1) html += this.laserHTML();

    this.vp.innerHTML = html;
    this.vp.setAttribute("transform", `translate(${this.view.x},${this.view.y}) scale(${this.view.scale})`);
    // 工具或选择集变化时通知 UI（属性面板刷新可见性/取值），签名去重避免高频 DOM 操作
    const sig = this.mode + "|" + this.tool + "|" + [...this.selection].sort().join(",");
    if (sig !== this._lastUiSig) { this._lastUiSig = sig; if (this._onSelectionChange) this._onSelectionChange(); }
  }

  // ---------- 白板图形属性辅助 ----------
  // 描边属性片段（宽度 / 边框样式：实线|虚线|点线）。baseCap：非点线时的 linecap 回退。
  _wbStrokeAttrs(n, baseCap) {
    const w = n.strokeWidth || 2;
    let s = `stroke-width="${w}"`;
    if (n.strokeStyle === "dashed") s += ` stroke-dasharray="${(7 + w * 2).toFixed(1)} ${(5 + w * 2).toFixed(1)}"`;
    else if (n.strokeStyle === "dotted") s += ` stroke-dasharray="${Math.max(0.1, w * 0.5).toFixed(2)} ${(w * 2.2).toFixed(1)}" stroke-linecap="round"`;
    else if (baseCap) s += ` stroke-linecap="${baseCap}"`;
    return s;
  }
  // 由节点 id 生成稳定随机种子（同一节点每次渲染抖动一致）
  _seed(id) {
    let h = 0;
    for (let i = 0; i < (id || "").length; i++) h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
    return h || 1;
  }
  _mkRnd(seed) {
    let s = seed || 1;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
  }
  // 手绘风多边形/折线路径：每边插入抖动中点（closed=false 用于直线/箭头）
  _roughPoly(corners, seed, amp, closed = true) {
    const rnd = this._mkRnd(seed);
    const pts = [];
    const n = corners.length;
    for (let i = 0; i < n; i++) {
      const a = corners[i], b = corners[(i + 1) % n];
      pts.push({ x: a.x + rnd() * amp * 0.6, y: a.y + rnd() * amp * 0.6 });
      if (closed || i < n - 1) pts.push({ x: (a.x + b.x) / 2 + rnd() * amp, y: (a.y + b.y) / 2 + rnd() * amp });
    }
    if (!closed) pts.push({ x: corners[n - 1].x + rnd() * amp * 0.6, y: corners[n - 1].y + rnd() * amp * 0.6 });
    return "M " + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ") + (closed ? " Z" : "");
  }
  // 手绘风椭圆：圆周采样 + 径向抖动 + 二次贝塞尔平滑闭合
  _roughEllipse(w, h, seed, amp) {
    const rnd = this._mkRnd(seed);
    const N = 14, pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const jr = 1 + rnd() * (amp / Math.max(w, h)) * 2.2;
      pts.push({ x: w / 2 + Math.cos(a) * (w / 2) * jr, y: h / 2 + Math.sin(a) * (h / 2) * jr });
    }
    let d = `M ${((pts[N - 1].x + pts[0].x) / 2).toFixed(1)},${((pts[N - 1].y + pts[0].y) / 2).toFixed(1)}`;
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[(i + 1) % N];
      d += ` Q ${p.x.toFixed(1)},${p.y.toFixed(1)} ${((p.x + q.x) / 2).toFixed(1)},${((p.y + q.y) / 2).toFixed(1)}`;
    }
    return d + " Z";
  }

  shapeHTML(n, s) {
    const { w, h } = s;
    const fill = (n.color === undefined || n.color === null) ? "#fff" : n.color;
    const stroke = n.stroke || "#94a3b8";
    const sw = n.strokeWidth || 2;
    const sa = this._wbStrokeAttrs(n);
    const amp = n.roughness ? n.roughness * 1.6 : 0;
    const seed = this._seed(n.id);
    switch (n.shape) {
      case "rect": {
        if (amp) return `<path d="${this._roughPoly([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], seed, amp)}" fill="${fill}" stroke="${stroke}" ${sa}/>`;
        const rx = n.rounded === false ? 0 : 3;
        return `<rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" ${sa}/>`;
      }
      case "diamond": {
        const c = [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }];
        if (amp) return `<path d="${this._roughPoly(c, seed, amp)}" fill="${fill}" stroke="${stroke}" ${sa}/>`;
        return `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" fill="${fill}" stroke="${stroke}" ${sa}/>`;
      }
      case "ellipse": {
        if (amp) return `<path d="${this._roughEllipse(w, h, seed, amp)}" fill="${fill}" stroke="${stroke}" ${sa}/>`;
        return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" ${sa}/>`;
      }
      case "parallelogram": return `<polygon points="18,0 ${w},0 ${w - 18},${h} 0,${h}" fill="${fill}" stroke="${stroke}" ${sa}/>`;
      case "sticky": return `<g filter="url(#gm-shadow)"><rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" ${this._wbStrokeAttrs({ ...n, strokeWidth: n.strokeWidth || 1.5 })}/></g>`;
      case "text": return ``;
      case "underline":
        // 脑图「下划线」样式：只画节点底部一条线（文字由 nodeHTML 渲染）
        return `<path d="M 1,${h - 3} H ${w - 1}" fill="none" stroke="${stroke}" ${sa} stroke-linecap="round"/>`;
      case "frame": return (
        `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="none" stroke="#aab3bf" stroke-width="1.5" stroke-dasharray="8 6"/>` +
        `<text x="2" y="-9" font-size="14" font-weight="600" fill="#8a94a6" font-family='-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'>${escapeXml(n.text || "")}</text>`
      );
      case "arrow":
      case "line": {
        // w / h 为相对起点的增量（可为负），画在本地坐标系 (0,0) -> (w,h)；
        // bend 为二次贝塞尔控制点（选中后拖中点产生，实现自由弯曲）
        const arrow = n.shape === "arrow" ? ` marker-end="url(#gm-arrow)"` : "";
        const bend = n.bend && (n.bend.x || n.bend.y) ? n.bend : null;
        const d = bend
          ? `M 0,0 Q ${bend.x.toFixed(1)},${bend.y.toFixed(1)} ${n.w},${n.h}`
          : amp ? this._roughPoly([{ x: 0, y: 0 }, { x: n.w, y: n.h }], seed, amp, false) : `M 0,0 L ${n.w},${n.h}`;
        // 加宽透明命中区（14px），方便点选细线
        const hit = `<path d="${d}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/>`;
        return hit + `<path d="${d}" fill="none" stroke="${stroke}" ${sa} stroke-linejoin="round"${arrow}/>`;
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
      default: {
        if (amp) return `<path d="${this._roughPoly([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], seed, amp)}" fill="${fill}" stroke="${stroke}" ${sa}/>`;
        return `<rect x="0" y="0" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" ${sa}/>`;
      }
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
      // 脑图节点图片：图片在上、文字在下
      const img = n.image && this.doc.type === "mindmap" ? { w: n.imageW || 120, h: n.imageH || 80 } : null;
      const baseY = img ? 8 + img.h + 8 + totalH / 2 : h / 2;
      let startY = baseY - totalH / 2 + LH / 2;
      const isTextShape = n.shape === "text";
      // 文字节点支持对齐 / 字体 / 斜体（自由文字），其余形状保持居中
      const align = isTextShape ? (n.textAlign || "center") : "center";
      const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
      const tx = align === "left" ? 2 : align === "right" ? w - 2 : w / 2;
      const fam = isTextShape && n.fontFamily === "serif" ? 'Georgia,"Songti SC","SimSun",serif'
        : isTextShape && n.fontFamily === "code" ? '"SFMono-Regular",Consolas,"Courier New",monospace'
        : '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      const italic = isTextShape && n.fontStyle === "italic" ? ` font-style="italic"` : "";
      const weight = n.bold ? 700 : isTextShape ? 600 : 500;
      const deco = n.underline ? ` text-decoration="underline"` : "";
      let tspans = "";
      lines.forEach((ln, i) => {
        const prefix = i === 0 && n.icon ? n.icon + " " : "";
        tspans += `<tspan x="${tx}" y="${(startY + i * LH).toFixed(1)}">${prefix}${escapeXml(ln) || " "}</tspan>`;
      });
      const tcolor = n.textColor || "#1f2a37";
      if (img) inner += `<image href="${escapeXml(n.image)}" x="${((w - img.w) / 2).toFixed(1)}" y="8" width="${img.w}" height="${img.h}" preserveAspectRatio="xMidYMid meet"/>`;
      inner += `<text x="${tx}" y="${baseY}" text-anchor="${anchor}" font-size="${fs}" font-family='${fam}'${italic}${deco} fill="${tcolor}" font-weight="${weight}">${tspans}</text>`;
    }
    // 脑图节点徽标：备注（橙色）/ 超链接（蓝色，可点击打开），悬停显示内容
    if (this.doc.type === "mindmap" && (n.note || n.href)) {
      let bx = w - 2;
      if (n.note) {
        inner += `<g transform="translate(${bx},-4)"><title>${escapeXml(n.note)}</title><circle r="8" fill="#ff9f43" stroke="#fff" stroke-width="1.5"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">注</text></g>`;
        bx -= 20;
      }
      if (n.href) {
        inner += `<a href="${escapeXml(n.href)}" target="_blank" rel="noopener"><g transform="translate(${bx},-4)"><title>${escapeXml(n.href)}</title><circle r="8" fill="#2f80ed" stroke="#fff" stroke-width="1.5"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">链</text></g></a>`;
      }
    }
    // 选中框（直线/箭头 w、h 可能是负增量，选中框按包围盒画）
    if (selected) {
      if (n.shape === "line" || n.shape === "arrow") {
        const bx = Math.min(0, n.w), by = Math.min(0, n.h), bw = Math.abs(n.w), bh = Math.abs(n.h);
        inner += `<rect x="${bx - 5}" y="${by - 5}" width="${bw + 10}" height="${bh + 10}" rx="6" fill="none" stroke="#11b5a4" stroke-width="1.5" stroke-dasharray="6 4"/>`;
      } else {
        inner += `<rect x="-5" y="-5" width="${w + 10}" height="${h + 10}" rx="14" fill="none" stroke="#11b5a4" stroke-width="2" stroke-dasharray="6 4"/>`;
      }
    }
    // 白板：直线/箭头选中时的自由变换手柄——两端端点 + 中点（拖动弯曲）
    if (selected && this.mode === "whiteboard" && !this._forExport && (n.shape === "line" || n.shape === "arrow")) {
      const mid = this._lineMid(n);
      const H = (hx, hy, kind) => `<circle class="gm-handle" data-id="${n.id}" data-h="${kind}" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="6" fill="#fff" stroke="#11b5a4" stroke-width="2"/>`;
      inner += H(0, 0, "p0") + H(n.w, n.h, "p1") + H(mid.x, mid.y, "mid");
    }
    // 流程图连线端口
    if (this.mode === "flowchart" && !this._forExport) {
      const ports = [["top", w / 2, 0], ["bottom", w / 2, h], ["left", 0, h / 2], ["right", w, h / 2]];
      for (const [p, px, py] of ports) inner += `<circle class="gm-port" data-id="${n.id}" data-port="${p}" cx="${px}" cy="${py}" r="6" fill="#fff" stroke="#11b5a4" stroke-width="2"/>`;
    }
    const op = n.opacity != null && n.opacity < 1 ? ` opacity="${n.opacity}"` : "";
    return `<g class="gm-node${selected ? " sel" : ""}" data-id="${n.id}" transform="translate(${n.x},${n.y})"${op}>${inner}</g>`;
  }

  edgeHTML(e) {
    const a = this.nodeById(e.from), b = this.nodeById(e.to);
    if (!a || !b) return "";
    const sa = this.sizes.get(a.id), sb = this.sizes.get(b.id);
    if (!sa || !sb) return "";
    // 关联线：任意两节点间的橙色虚线曲线（脑图模式工具栏创建）
    if (e.assoc) {
      const ax = a.x + sa.w / 2, ay = a.y + sa.h / 2, bx = b.x + sb.w / 2, by = b.y + sb.h / 2;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      const bow = Math.min(46, L * 0.18);
      const d = `M ${ax.toFixed(1)},${ay.toFixed(1)} Q ${(mx - dy / L * bow).toFixed(1)},${(my + dx / L * bow).toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
      const lbl = e.label
        ? `<rect x="${mx - 14}" y="${my - 11}" width="28" height="20" rx="5" fill="#fff" stroke="#ffe0c2"/><text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="12" fill="#d97706">${escapeXml(e.label)}</text>`
        : "";
      return `<path d="${d}" fill="none" stroke="#ff9f43" stroke-width="2" stroke-dasharray="7 5" stroke-linecap="round"/>${lbl}`;
    }
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

  // 直线/箭头：二次贝塞尔中点 B(0.5) = 0.25·P0 + 0.5·C + 0.25·P1（局部坐标，P0=(0,0)）
  _lineMid(n) {
    if (n.bend && (n.bend.x || n.bend.y)) return { x: 0.5 * n.bend.x + 0.25 * n.w, y: 0.5 * n.bend.y + 0.25 * n.h };
    return { x: n.w / 2, y: n.h / 2 };
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
    if (this._pinch) return;
    // 中键：所有模式下拖拽平移（左键空白拖拽已用于框选）
    if (e.button === 1) {
      e.preventDefault();
      const r0 = this.rect();
      this._pan = { sx: e.clientX - r0.left, sy: e.clientY - r0.top, ox: this.view.x, oy: this.view.y };
      return;
    }
    if (e.button !== 0) return;
    const r = this.rect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const target = e.target;

    if (this.readOnly) {
      if (!e.shiftKey) this.clearSelection();
      this._pan = { sx, sy, ox: this.view.x, oy: this.view.y };
      return;
    }

    // ---------- 白板：直线/箭头自由变换手柄（端点 p0/p1、中点 mid）----------
    const handleEl = target.closest && target.closest(".gm-handle");
    if (handleEl && this.mode === "whiteboard") {
      const hid = handleEl.getAttribute("data-id");
      const hn = this.nodeById(hid);
      if (hn) {
        this.selection = new Set([hid]);
        this._handle = {
          id: hid, kind: handleEl.getAttribute("data-h"), sx, sy, moved: false,
          orig: { x: hn.x, y: hn.y, w: hn.w, h: hn.h, bend: hn.bend ? { ...hn.bend } : null },
        };
        this.render();
      }
      return;
    }

    // ---------- 关联线工具（流程图 / 脑图）：点击起点节点 -> 点击目标节点建立连线 ----------
    if ((this.mode === "flowchart" || this.mode === "mindmap") && this.tool === "link") {
      const hitEl = target.closest && target.closest("[data-id]");
      const id = hitEl ? hitEl.getAttribute("data-id") : null;
      if (!this._linkFrom) {
        if (id) { this._linkFrom = id; this.selection = new Set([id]); this.render(); }
      } else {
        if (id && id !== this._linkFrom) {
          // 脑图关联线（虚线自由连线）；流程图保持原有箭头连线
          if (this.mode === "mindmap") this.addAssocEdge(this._linkFrom, id);
          else this.addEdge(this._linkFrom, id);
          this.onChange();
          this.pushHistory();
        }
        this._linkFrom = null;
        this.selection.clear();
        this.render();
      }
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
          this._stroke = { id: newId(), points: [{ x: w.x, y: w.y }], color: this.toolColor, width: Math.max(1.5, (this.wbProps.strokeWidth || 2) * 1.5) };
          return;
        }
        case "laser":
          this._laserDown = true;
          this._laser = { pts: [{ x: w.x, y: w.y, t: performance.now() }] };
          this._startLaserLoop();
          return;
        case "eraser":
          this._erasing = true;
          this._erased = false;
          this.eraseAt(w);
          return;
        case "text":
          // 阻止 pointerdown 默认行为把焦点转移走（否则编辑框刚聚焦即 blur 关闭）
          e.preventDefault();
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
    // 空白：选择工具下左键拖拽框选多个元素（脑图 / 流程图 / 白板通用）；
    // Alt+左键拖拽 = 平移画布（中键拖拽 / 抓手工具也可平移）
    if (!this.readOnly && this.tool === "select" && !e.altKey) {
      if (!e.shiftKey) this.clearSelection();
      const w = this.toWorld(e.clientX, e.clientY);
      this._marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, base: e.shiftKey ? new Set(this.selection) : new Set() };
      this.render();
      return;
    }
    if (!e.shiftKey) this.clearSelection();
    this._pan = { sx, sy, ox: this.view.x, oy: this.view.y };
  }

  onMove(e) {
    if (this._pinch) return;
    // 白板：直线/箭头手柄拖拽（自由变换）
    if (this._handle) {
      const r = this.rect();
      const dx = (e.clientX - r.left - this._handle.sx) / this.view.scale;
      const dy = (e.clientY - r.top - this._handle.sy) / this.view.scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this._handle.moved = true;
      const n = this.nodeById(this._handle.id);
      const o = this._handle.orig;
      if (n && o) {
        if (this._handle.kind === "p0") {
          // 拖起点：起点跟随、终点保持不动（w/h 为终点相对起点的增量）
          n.x = o.x + dx; n.y = o.y + dy;
          n.w = o.w - dx; n.h = o.h - dy;
          if (o.bend) n.bend = { x: o.bend.x - dx, y: o.bend.y - dy };
        } else if (this._handle.kind === "p1") {
          n.w = o.w + dx; n.h = o.h + dy;
        } else if (this._handle.kind === "mid") {
          // 拖中点：把拖到的位置设为曲线中点，反解二次贝塞尔控制点 C = 2M - (P0+P1)/2
          const w = this.toWorld(e.clientX, e.clientY);
          n.bend = { x: 2 * (w.x - n.x) - n.w / 2, y: 2 * (w.y - n.y) - n.h / 2 };
        }
        this.render();
      }
      return;
    }
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
    if (this._laser && this._laserDown) {
      this._laser.pts.push({ x: this.toWorld(e.clientX, e.clientY).x, y: this.toWorld(e.clientX, e.clientY).y, t: performance.now() });
      this._startLaserLoop();
      this.render();
      return;
    }
    if (this._connect) { this._connect.cx = e.clientX; this._connect.cy = e.clientY; this.render(); return; }
    if (this._marquee) {
      const w = this.toWorld(e.clientX, e.clientY);
      this._marquee.x1 = w.x; this._marquee.y1 = w.y;
      this.applyMarquee(); // 实时高亮框内元素
      this.render();
      return;
    }
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
    if (this._marquee) { this._marquee = null; this.render(); return; } // 选择已在拖拽中实时应用
    if (this._handle) { if (this._handle.moved) { this.onChange(); this.pushHistory(); } this._handle = null; return; }
    if (this._newShape) { this.finishNewShape(); return; }
    if (this._erasing) { this._erasing = false; if (this._erased) { this.onChange(); this.pushHistory(); } this._erased = false; return; }
    if (this._laser) { this._laserDown = false; this._startLaserLoop(); return; } // 松开即停止绘制，轨迹交给淡出循环清理
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
    const isTextShape = n.shape === "text";
    const fg = isTextShape ? (n.textColor || "#1f2a37")
      : solid ? (n.textColor || "#fff") : (isLightColor(bg) ? "#1f2a37" : "#fff");
    const align = isTextShape ? (n.textAlign || "center") : "center";
    const fam = isTextShape && n.fontFamily === "serif" ? 'Georgia,"Songti SC","SimSun",serif'
      : isTextShape && n.fontFamily === "code" ? '"SFMono-Regular",Consolas,"Courier New",monospace'
      : "inherit";
    const fs = n.fontSize || 15;
    const ta = document.createElement("textarea");
    ta.value = n.text || "";
    ta.className = "gm-edit";
    ta.spellcheck = false;
    if (isTextShape) {
      // 自由文字：Excalidraw 风格透明编辑区——无边框无底色，光标（竖线）直接落在创建/点击位置等待输入
      const LH = (fs + 7) * this.view.scale;
      const ew = Math.max(48, Math.min(360 * this.view.scale, r.right - left - 16));
      const padTop = Math.max(0, (s.h * this.view.scale - LH) / 2);
      ta.style.cssText =
        `position:fixed; left:${left}px; top:${top + padTop}px; width:${ew}px; height:${LH + 4}px;` +
        `font-size:${fs * this.view.scale}px; font-weight:600; line-height:${LH}px;` +
        `border:none; border-radius:2px; padding:0 2px; margin:0; resize:none; outline:none;` +
        `text-align:${align}; box-sizing:border-box; font-family:${fam};` +
        (n.fontStyle === "italic" ? " font-style:italic;" : "") +
        ` color:${fg}; caret-color:${fg}; background:transparent; z-index:50; overflow:hidden;`;
    } else {
      ta.style.cssText =
        `position:fixed; left:${left}px; top:${top}px; width:${Math.max(s.w * this.view.scale, 60)}px; height:${Math.max(s.h * this.view.scale, 30)}px;` +
        `font-size:${fs * this.view.scale}px; border:2px solid #11b5a4; border-radius:12px; padding:6px 8px;` +
        `resize:none; outline:none; text-align:${align}; box-sizing:border-box; font-family:${fam};` +
        ` color:${fg}; background:${bg}; z-index:50; overflow:hidden;`;
    }
    document.body.appendChild(ta);
    // 延迟聚焦：等指针事件默认行为（焦点转移）跑完，避免编辑框刚出现即失焦关闭
    setTimeout(() => { ta.focus(); ta.select(); }, 0);
    // 自由文字：输入时编辑区自动增高（多行可见），同步渲染节点尺寸
    if (isTextShape) {
      ta.addEventListener("input", () => {
        const maxH = (fs + 7) * 14 * this.view.scale;
        ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
      });
    }
    let done = false;
    let cancelled = false;
    // 自由文字提交/取消时若内容为空：直接丢弃节点（Excalidraw 同款，不留隐形空节点）
    const cleanupEmpty = () => {
      if (isTextShape && !(n.text || "").trim()) {
        this.doc.nodes = this.doc.nodes.filter((x) => x.id !== n.id);
        this.selection.delete(n.id);
      }
    };
    const commit = () => {
      if (done) return;
      done = true;
      const val = ta.value;
      ta.remove();
      if (cancelled) { cleanupEmpty(); this.render(); return; }
      const changed = val !== n.text;
      if (changed) n.text = val;
      cleanupEmpty();
      const gone = !this.doc.nodes.some((x) => x.id === n.id);
      if (changed || gone) { this.render(); this.pushHistory(); this.onChange(); }
      else { this.render(); }
    };
    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !isTextShape) { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancelled = true; commit(); }
      ev.stopPropagation();
    });
  }

  // ---------- 增删 ----------
  addEdge(from, to, label) {
    if (from === to) return;
    if (this.doc.edges.some((e) => e.from === from && e.to === to)) return;
    this.doc.edges.push({ id: newId(), from, to, label: label || "", arrow: true });
  }

  // 脑图关联线：任意两节点之间的自由连线（虚线曲线，随节点删除自动清理）
  addAssocEdge(from, to, label) {
    if (from === to) return;
    if (this.doc.edges.some((e) => e.assoc && e.from === from && e.to === to)) return;
    this.doc.edges.push({ id: newId(), from, to, label: label || "", assoc: true });
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
    const dims = { rect: [140, 50], diamond: [150, 92], ellipse: [130, 64], parallelogram: [150, 64], rounded: [140, 50], text: [240, 44] }[shape] || [140, 50];
    const id = newId();
    const isText = shape === "text";
    const node = {
      id, x: wx - dims[0] / 2, y: wy - dims[1] / 2, w: dims[0], h: dims[1],
      text: isText ? "双击编辑文本" : shape === "diamond" ? "判断?" : "文本",
      shape, color: isText ? "transparent" : "#fff",
      textColor: "#1f2a37", stroke: isText ? "transparent" : "#2f80ed",
      fontSize: isText ? 18 : 14, parentId: null, collapsed: false,
    };
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
    this._linkFrom = null; // 切换工具时放弃未完成的关联线
    if (tool === "select" || tool === "hand") this.container.style.cursor = "default";
    else if (tool === "laser") this.container.style.cursor = "crosshair";
    else this.container.style.cursor = "crosshair";
    if (tool !== "laser") this._laser = null;
    if (this._onToolChange) this._onToolChange(tool); // 通知工具栏刷新高亮
  }

  // ---------- 白板属性面板 ----------
  // 应用属性：写入默认 wbProps（影响后续新建图形），并同步到当前选中的节点
  // 脑图节点样式：批量应用到所有选中节点（字段透传到节点，布局重算后渲染）
  setNodeStyle(patch) {
    const sel = [...this.selection];
    if (!sel.length) return;
    for (const id of sel) {
      const n = this.nodeById(id);
      if (!n) continue;
      for (const k of Object.keys(patch)) {
        if (patch[k] === null) delete n[k]; // null = 移除该属性（备注/超链接/图片/图标）
        else n[k] = patch[k];
      }
    }
    if (this.doc.type === "mindmap") layoutMindmap(this.doc);
    this.render(); this.onChange(); this.pushHistory();
  }

  setWbProps(patch, useHistory = true) {
    Object.assign(this.wbProps, patch);
    if ("stroke" in patch) this.toolColor = patch.stroke;
    const sel = [...this.selection];
    if (!sel.length) return;
    for (const id of sel) {
      const n = this.nodeById(id);
      if (!n || n.shape === "frame" || n.shape === "embed" || n.shape === "image") continue;
      if ("stroke" in patch) {
        if (n.shape === "text") n.textColor = patch.stroke; // 文字节点：描边色即文字色
        else if (n.shape !== "sticky") n.stroke = patch.stroke;
      }
      if ("fill" in patch && n.shape !== "arrow" && n.shape !== "line" && n.shape !== "text") n.color = patch.fill;
      if ("strokeWidth" in patch) n.strokeWidth = patch.strokeWidth;
      if ("strokeStyle" in patch) n.strokeStyle = patch.strokeStyle;
      if ("roughness" in patch) n.roughness = patch.roughness;
      if ("rounded" in patch && n.shape === "rect") n.rounded = patch.rounded;
      if ("opacity" in patch) n.opacity = patch.opacity;
      // 文字专属属性
      if ("fontSize" in patch && n.shape === "text") n.fontSize = patch.fontSize;
      if ("fontStyle" in patch && n.shape === "text") n.fontStyle = patch.fontStyle;
      if ("fontFamily" in patch && n.shape === "text") n.fontFamily = patch.fontFamily;
      if ("textAlign" in patch && n.shape === "text") n.textAlign = patch.textAlign;
    }
    this.render();
    this.onChange();
    if (useHistory) this.pushHistory();
  }
  // 面板取值：单选时读节点属性，否则读默认 wbProps
  getWbProps() {
    const sel = [...this.selection].map((id) => this.nodeById(id)).filter(Boolean)
      .filter((n) => n.shape !== "frame" && n.shape !== "embed" && n.shape !== "image");
    if (sel.length === 1) {
      const n = sel[0];
      const isText = n.shape === "text";
      const props = {
        stroke: isText ? (n.textColor || this.wbProps.stroke) : (n.stroke || this.wbProps.stroke),
        fill: n.color == null ? "#ffffff" : n.color,
        strokeWidth: n.strokeWidth || 2,
        strokeStyle: n.strokeStyle || "solid",
        roughness: n.roughness || 0,
        rounded: n.rounded !== false,
        opacity: n.opacity == null ? 1 : n.opacity,
      };
      if (isText) Object.assign(props, {
        fontSize: n.fontSize || 18,
        fontStyle: n.fontStyle || "normal",
        fontFamily: n.fontFamily || "sans",
        textAlign: n.textAlign || "center",
      });
      return props;
    }
    return { ...this.wbProps };
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
    // 面板当前属性带入新节点
    const P = this.wbProps;
    const styleProps = { strokeWidth: P.strokeWidth, strokeStyle: P.strokeStyle, roughness: P.roughness, opacity: P.opacity };
    let node;
    if (t.tool === "arrow" || t.tool === "line") {
      const w = tiny ? 180 : dx, h = tiny ? 0 : dy;
      node = { id: newId(), shape: t.tool, x: t.x0, y: t.y0, w, h, text: "", color: "transparent", textColor: "#1f2a37", stroke: color, fontSize: 14, parentId: null, collapsed: false, ...styleProps };
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
      node = { id: newId(), shape: t.tool, x, y, w, h, text: "", color: P.fill || "#fff", textColor: "#1f2a37", stroke: color, fontSize: 15, parentId: null, collapsed: false, rounded: P.rounded, ...styleProps };
    }
    this.doc.nodes.push(node);
    this.selection = new Set([node.id]);
    this.render();
    this.onChange();
    this.pushHistory();
    // 用完图形工具自动回到选择工具（除文字编辑即将开始的场景也一样）
    this.setTool("select");
    // 基础图形创建后直接进入文字编辑，画框不进入
    if (["rect", "diamond", "ellipse"].includes(t.tool)) this.beginTextEdit(node.id);
  }

  _nextFrameName() {
    const n = this.doc.nodes.filter((x) => x.shape === "frame").length + 1;
    return `Frame ${n}`;
  }

  // ---------- 网格 / 图层 ----------
  toggleGrid() {
    this.showGrid = !this.showGrid;
    try { localStorage.setItem("gm_wb_grid", this.showGrid ? "1" : "0"); } catch (_) {}
    this.render();
    return this.showGrid;
  }
  // 背景网格线（随视图平移缩放，40 世界单位间距）
  gridHTML() {
    const r = this.rect();
    const s = this.view.scale || 1;
    const x0 = -this.view.x / s, y0 = -this.view.y / s;
    const x1 = (r.width - this.view.x) / s, y1 = (r.height - this.view.y) / s;
    const step = 40, sw = 1 / s;
    let out = `<g stroke="#e9edf3" stroke-width="${sw}">`;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) out += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`;
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) out += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`;
    return out + "</g>";
  }
  // 图层排序：doc.nodes 数组顺序即 z 序（越靠后越在上层）
  // mode: front 置顶 / back 置底 / forward 上移一层 / backward 下移一层
  _reorderLayer(mode) {
    const sel = new Set(this.selection);
    if (!sel.size || this.doc.nodes.length < 2) return;
    const nodes = this.doc.nodes;
    if (mode === "front" || mode === "back") {
      const selNodes = nodes.filter((n) => sel.has(n.id));
      const rest = nodes.filter((n) => !sel.has(n.id));
      this.doc.nodes = mode === "front" ? [...rest, ...selNodes] : [...selNodes, ...rest];
    } else if (mode === "forward") {
      for (let i = nodes.length - 2; i >= 0; i--) {
        if (sel.has(nodes[i].id) && !sel.has(nodes[i + 1].id)) { const t = nodes[i]; nodes[i] = nodes[i + 1]; nodes[i + 1] = t; }
      }
    } else if (mode === "backward") {
      for (let i = 1; i < nodes.length; i++) {
        if (sel.has(nodes[i].id) && !sel.has(nodes[i - 1].id)) { const t = nodes[i]; nodes[i] = nodes[i - 1]; nodes[i - 1] = t; }
      }
    }
    this.render();
    this.onChange();
    this.pushHistory();
  }

  // ---------- 框选 ----------
  marqueeHTML() {
    const m = this._marquee;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(47,128,237,0.08)" stroke="#2f80ed" stroke-width="${1 / this.view.scale}" stroke-dasharray="4 3"/>`;
  }

  // 框选命中：节点包围盒与选框相交即选中（Shift 保留已有选择）
  applyMarquee() {
    const m = this._marquee; if (!m) return;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    const hit = new Set(m.base || []);
    for (const n of this.doc.nodes) {
      const b = this.nodeBBox(n);
      if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) hit.add(n.id);
    }
    this.selection = hit;
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
      const now = performance.now();
      if (this._laserDown) { this.render(); this._laserRaf = requestAnimationFrame(tick); return; } // 按住期间保持轨迹，只按时间淡出
      if (!this._laser || !this._laser.pts.length) { this._laserRaf = null; return; }
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
    const P = this.wbProps;
    const fs = P.fontSize || 18;
    // 点击即输入：起点锚定在点击位置（左对齐起笔，Excalidraw 同款）；对齐方式创建后仍可在面板调整
    const align = "left";
    const w0 = 240;
    const x = wx - 2;
    const node = {
      id, x, y: wy - fs / 2 - 6, w: w0, h: fs + 12, text: "", shape: "text", color: "transparent",
      textColor: this.toolColor, stroke: "transparent", fontSize: fs,
      fontStyle: P.fontStyle || "normal", fontFamily: P.fontFamily || "sans", textAlign: align,
      parentId: null, collapsed: false,
    };
    this.doc.nodes.push(node);
    this.selection = new Set([id]);
    // 参考流程图文本工具：用完自动回到选择工具（先切工具再开编辑框，避免重渲染干扰）
    this.setTool("select");
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
