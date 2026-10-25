// 编辑器内核：SVG 画布、视图变换、选择/拖拽、连线、文本编辑、渲染
import { newId, sizeOf, normalizeDoc } from "./model.js";
import { layoutMindmap, adaptMindmap } from "./mindmap.js";

const SVGNS = "http://www.w3.org/2000/svg";
const PALETTE = ["#11b5a4", "#2f80ed", "#ff7a59", "#f5a623", "#9b59b6", "#16a34a", "#e5484d", "#0ea5e9"];

// 流程图形状工具名（点击画布处创建组件，用完自动回到选择工具）
const FC_SHAPE_TOOLS = ["rect", "rounded", "diamond", "ellipse", "parallelogram", "text"];

// 画笔 / 文字 / 橡皮的自定义光标（与工具栏图标同款，data-URI SVG，热点随工具）
const TOOL_CURSORS = {
  pen: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4.5 19.5l1-4L16 5l3 3L8.5 18.5l-4 1z" fill="#fff" stroke="#1f2a37" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 7l3 3" stroke="#1f2a37" stroke-width="1.4"/></svg>`)}") 4 20, crosshair`,
  text: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8 4h8M12 4v16M8 20h8" stroke="#1f2a37" stroke-width="1.8" stroke-linecap="round"/></svg>`)}") 12 12, text`,
  eraser: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g transform="rotate(-45 12 12)"><rect x="4" y="9" width="16" height="7" rx="2" fill="#fff" stroke="#1f2a37" stroke-width="1.6"/><path d="M9 9v7" stroke="#1f2a37" stroke-width="1.2"/></g></svg>`)}") 4 18, crosshair`,
};

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
    this._rmbLastDown = 0;                       // 右键上次按下时间（双击检测：右键双击切换抓手工具）
    this._rmbDblAt = 0;                          // 右键双击发生时间（contextmenu 抑制菜单用）
    this._edgeDrag = null;                       // 连线中点手柄拖拽（调节弯曲）
    this._pendingCollapse = null;                // 脑图折叠徽标（pointerup 时切换）
    this._connectHover = null;                   // 连线拖拽中的吸附高亮
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
    this._onRender = opts.onRender || null;       // 每次渲染后回调（小地图等外部组件同步）
    this._renderListeners = new Set();            // 外部订阅渲染（大纲面板随文档/选中刷新）
    // 编辑器行为设置（侧栏「设置」面板驱动，main.js 持久化）
    this.autoEditNewNode = true;  // 新节点自动进入文字编辑
    this.dblClickCreate = false;  // 双击空白处创建子节点（脑图）
    this.wheelPan = false;        // 滚轮上下平移视图（false = 缩放）
    this.autoRelayout = false;    // 脑图结构操作后整图重新布局（会覆盖手动位置，默认关）
    this.autoAdjust = true;       // 脑图结构操作（增/删/收起/展开）后局部自适应（默认开，不覆盖无关节点）
    this._onNoteBadge = opts.onNoteBadge || null; // 点击节点备注徽标 -> 弹框查看/编辑
    this._onEdgeEdit = opts.onEdgeEdit || null;   // 双击连线 -> 弹出连线编辑弹框
    this._onGroupEdit = opts.onGroupEdit || null; // 双击外框/概括 -> 弹出分组编辑弹框
    this.onImageZoom = opts.onImageZoom || null;   // 单击图片 -> 放大查看（灯箱）
    this.onConfirmImageDelete = opts.onConfirmImageDelete || null; // 删除含图片节点 -> 二次确认
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
    // 右键按下即阻止默认行为：抑制浏览器/鼠标手势插件把"右键拖拽"解释成后退/前进
    container.addEventListener("mousedown", (e) => { if (e.button === 2) e.preventDefault(); });
    // 右键双击检测（window 捕获层）：第二次右键可能落在右键菜单上（pointerdown 到不了 svg），
    // 因此挂 window 并把「右键菜单上的右键」也视作画布右键。双击（350ms 内且位置接近）-> 切换抓手工具
    window.addEventListener("pointerdown", (e) => {
      if (e.button !== 2) return;
      const t = e.target;
      const inCanvas = this.container.contains(t) || (t.closest && t.closest(".gm-ctx-menu"));
      if (!inCanvas) return;
      const now = Date.now();
      const near = this._rmbLastXY && Math.hypot(e.clientX - this._rmbLastXY.x, e.clientY - this._rmbLastXY.y) < 15;
      if (now - this._rmbLastDown < 500 && near) {
        this._rmbLastDown = 0;
        this._rmbLastXY = null;
        this._rmbDblAt = now;
        this.setTool(this.tool === "hand" ? "select" : "hand");
        document.querySelectorAll(".gm-ctx-menu").forEach((m) => m.remove()); // 双击生效，顺手收起菜单
      } else {
        this._rmbLastDown = now;
        this._rmbLastXY = { x: e.clientX, y: e.clientY };
      }
    }, true);
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("dblclick", (e) => this.onDblClick(e));
    // 窗口失焦兜底：右键/中键拖拽中切走窗口收不到 pointerup，立即还原光标与拖拽态
    window.addEventListener("blur", () => this._rmbCancel());

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
    this.doc.groups = this.doc.groups || [];
    this.doc.view = this.doc.view || { x: 0, y: 0, scale: 1 };
    normalizeDoc(this.doc); // 迁移旧版 framed/summary 布尔字段为分组
    this.view = this.doc.view;
    this.mode = this.doc.type || "mindmap";
    this.selection.clear();
    // 加载时不再自动重排：保留文档里已保存的节点位置（用户手动拖动过的布局原样还原），
    // 只有主动点「整理布局」才重排。首次进入的空脑图由 ensureRoot 布局。
    if (this.mode === "mindmap" && !this.doc.nodes.some((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && (n.x || n.y))) {
      layoutMindmap(this.doc);
    }
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
      groups: this.doc.groups || [],
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
    this.doc.groups = s.groups || [];
    this.mode = this.doc.type;
    this.selection.clear();
    // 撤销/重做按快照还原（含节点坐标），不重排，避免拖动位置被布局覆盖
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
    // 每个节点的后代总数（折叠徽标显示用）
    this._descCounts = this._calcDescCounts();

    let html = "";
    // 白板网格（不进导出）
    if (this.showGrid && !this._forExport) html += this.gridHTML();
    // 折叠隐藏的节点集合（脑图）：用于跳过隐藏节点及其连线 / 外框 / 概括
    const hidden = this.hiddenNodes();
    // 脑图：外框 / 概括（分组框选多个子节点），垫在连线之下
    // 范围只按「当前可见成员」计算：成员被子树收起时不出框，全部隐藏则不展示
    if (this.doc.type === "mindmap" && this.doc.groups && this.doc.groups.length) {
      for (const g of this.doc.groups) {
        const members = g.ids.map((id) => this.nodeById(id)).filter((n) => n && !hidden.has(n.id));
        if (!members.length) continue;
        const gsel = this.selection.has("g:" + g.id);
        html += g.kind === "frame" ? this.frameHTML(members, g, gsel) : this.summaryHTML(members, g, gsel);
      }
    }
    // 边（脑图模式按 parentId 派生连线，保证父子之间始终有线）
    let edges = this.doc.edges;
    if (this.doc.type === "mindmap") {
      edges = [];
      for (const n of this.doc.nodes) {
        if (n.parentId && this.nodeById(n.parentId)) edges.push({
          id: "p-" + n.id, from: n.parentId, to: n.id, derived: true,
          label: n.edgeLabel || null, bend: n.edgeBend || null, arrowMode: n.edgeArrowMode || null,
          // 端点被拖动拉伸过：相对锚点 / 世界坐标固定点（与普通连线同样语义）
          aPt: n.edgeAPt || null, aPtRel: n.edgeAPtRel || null,
          bPt: n.edgeBPt || null, bPtRel: n.edgeBPtRel || null,
        });
      }
      // 关联线（工具栏创建的任意两节点连线）附加在父子连线之上
      edges = edges.concat(this.doc.edges.filter((e) => e.assoc));
    }
    for (const e of edges) {
      if (hidden.has(e.from) || hidden.has(e.to)) continue;
      html += this.edgeHTML(e);
    }
    // 节点
    for (const n of this.doc.nodes) { if (!hidden.has(n.id)) html += this.nodeHTML(n, this.selection.has(n.id)); }
    // 自由画笔（画在节点之上：压着图形标注也不会被遮挡）
    for (const s of this.doc.strokes) html += this.strokeHTML(s);
    if (this._stroke) html += this.strokeHTML(this._stroke);
    // 白板：拖拽创建中的临时图形
    if (this._newShape) html += this.tempShapeHTML();
    // 白板：框选矩形
    if (this._marquee) html += this.marqueeHTML();
    // 临时连线
    if (this._connect) html += this.tempConnectHTML();
    // 选中连线的中点手柄（拖动调节弯曲）
    if (this._selEdgeId() && !this._forExport) html += this.edgeHandleHTML();
    // 白板：激光笔轨迹（最上层，不持久化）
    if (this._laser && this._laser.pts.length > 1) html += this.laserHTML();

    this.vp.innerHTML = html;
    this.vp.setAttribute("transform", `translate(${this.view.x},${this.view.y}) scale(${this.view.scale})`);
    // 工具或选择集变化时通知 UI（属性面板刷新可见性/取值），签名去重避免高频 DOM 操作
    const sig = this.mode + "|" + this.tool + "|" + [...this.selection].sort().join(",");
    if (sig !== this._lastUiSig) { this._lastUiSig = sig; if (this._onSelectionChange) this._onSelectionChange(); }
    if (this._onRender) this._onRender();
    // 外部订阅者（大纲面板等）：随文档/选中状态实时同步，异常不影响渲染
    if (this._renderListeners.size) for (const fn of [...this._renderListeners]) { try { fn(); } catch (_) {} }
  }

  // 订阅渲染回调（返回取消订阅函数）
  onRender(fn) {
    this._renderListeners.add(fn);
    return () => this._renderListeners.delete(fn);
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
      case "image": {
        const ph = `<g class="gm-img-ph"><rect x="0" y="0" width="${w}" height="${h}" rx="8" stroke-dasharray="6 5"/><text x="${(w / 2).toFixed(1)}" y="${(h / 2 + 4).toFixed(1)}" text-anchor="middle">图片</text></g>`;
        const im = `<image data-img="1" href="${n.src || ""}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
        return ph + im;
      }
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
    let shape = this.shapeHTML(n, s);
    // 白板：水平/垂直翻转（只翻图形不翻文字；embed 网页除外）
    if ((n.flipX || n.flipY) && n.shape !== "embed" && n.shape !== "text") {
      const tx = n.flipX ? `translate(${w},0) scale(-1,1)` : "";
      const ty = n.flipY ? `translate(0,${h}) scale(1,-1)` : "";
      shape = `<g transform="${tx} ${ty}">${shape}</g>`;
    }
    let inner = shape;
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
      if (img) {
        const px = ((w - img.w) / 2).toFixed(1);
        inner += `<g class="gm-img-ph"><rect x="${px}" y="8" width="${img.w}" height="${img.h}" rx="6"/><text x="${(parseFloat(px) + img.w / 2).toFixed(1)}" y="${(8 + img.h / 2 + 4).toFixed(1)}" text-anchor="middle">图片</text></g>`;
        inner += `<image data-img="1" href="${escapeXml(n.image)}" x="${px}" y="8" width="${img.w}" height="${img.h}" preserveAspectRatio="xMidYMid meet"/>`;
      }
      inner += `<text x="${tx}" y="${baseY}" text-anchor="${anchor}" font-size="${fs}" font-family='${fam}'${italic}${deco} fill="${tcolor}" font-weight="${weight}">${tspans}</text>`;
    }
    // 白板：线段 / 箭头 中点文本（参考脑图连线文本，白色描边光晕保证跨线可读）
    if ((n.shape === "arrow" || n.shape === "line") && n.text) {
      const m = this._lineMid(n);
      inner += `<text class="gm-line-label" x="${m.x.toFixed(1)}" y="${(m.y + 4).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="600" fill="${n.textColor || "#1f2a37"}" stroke="#fff" stroke-width="3" paint-order="stroke" style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(n.text)}</text>`;
    }
    // 脑图节点徽标：备注（橙色，点击弹框查看/编辑）/ 超链接（蓝色，可点击打开）
    if (this.doc.type === "mindmap" && (n.note || n.href)) {
      let bx = w - 6;
      if (n.note) {
        const click = this._forExport ? "" : `class="gm-note-badge" data-note="${n.id}" style="cursor:pointer"`;
        inner += `<g ${click} transform="translate(${bx},-6)"><title>备注：${escapeXml(n.note)}</title><circle r="8" fill="#ff9f43" stroke="#fff" stroke-width="1.5"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">注</text></g>`;
        bx -= 21;
      }
      if (n.href) {
        inner += `<a href="${escapeXml(n.href)}" target="_blank" rel="noopener"><g transform="translate(${bx},-6)"><title>${escapeXml(n.href)}</title><circle r="8" fill="#2f80ed" stroke="#fff" stroke-width="1.5"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">链</text></g></a>`;
      }
    }
    // 白板：锁定节点徽标（灰色小锁，锁定后不可选中/拖动/删除）
    if (this.doc.type === "whiteboard" && n.locked && !this._forExport) {
      inner += `<g transform="translate(${w - 6},-6)"><circle r="8" fill="#94a3b8" stroke="#fff" stroke-width="1.5"/><text y="3.5" text-anchor="middle" font-size="9">🔒</text></g>`;
    }
    // 脑图：折叠 / 展开徽标（点击切换子树显隐）；收起时显示被隐藏的后代节点总数
    if (this.doc.type === "mindmap" && !this._forExport) {
      const hasKids = this.doc.nodes.some((c) => c.parentId === n.id);
      if (hasKids) {
        const side = n.side === "left" ? "left" : n.side === "down" ? "down" : "right";
        const bx = side === "left" ? -14 : side === "down" ? w / 2 : w + 14;
        const by = side === "down" ? h + 14 : h / 2;
        const col = n.stroke || "#94a3b8";
        const cnt = this._descCounts ? (this._descCounts.get(n.id) || 0) : 0;
        const label = n.collapsed ? String(cnt) : "−";
        // 数字位数多时放宽徽标，避免挤出圆外
        const r = label.length >= 3 ? 11.5 : label.length === 2 ? 9.5 : 8;
        const fs = label.length >= 3 ? 9.5 : label.length === 2 ? 10.5 : 11;
        inner += `<g class="gm-collapse-badge" data-collapse="${n.id}"><title>${n.collapsed ? `已收起 ${cnt} 个后代节点，点击展开` : "点击收起子节点"}</title><circle cx="${bx}" cy="${by}" r="${r}" fill="#fff" stroke="${col}" stroke-width="1.5"/><text x="${bx}" y="${by + fs * 0.35}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#4b5563">${label}</text></g>`;
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
    // 关联线工具：悬停吸附 / 拖拽中吸附的节点高亮（橙色虚线框）
    if (this.tool === "link" && (this._linkHover === n.id || this._connectHover === n.id) && !this._forExport) {
      inner += `<rect x="-8" y="-8" width="${w + 16}" height="${h + 16}" rx="16" fill="none" stroke="#ff9f43" stroke-width="2.5" stroke-dasharray="7 5"/>`;
    }
    // 白板：选中元素的自由变换手柄
    if (selected && this.mode === "whiteboard" && !this._forExport) {
      if (n.shape === "line" || n.shape === "arrow") {
        // 直线/箭头：两端端点 + 中点（拖动弯曲）
        const mid = this._lineMid(n);
        const H = (hx, hy, kind) => `<circle class="gm-handle" data-id="${n.id}" data-h="${kind}" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="6" fill="#fff" stroke="#11b5a4" stroke-width="2"/>`;
        inner += H(0, 0, "p0") + H(n.w, n.h, "p1") + H(mid.x, mid.y, "mid");
      } else if (n.shape !== "embed") {
        // 通用自由变换：四角手柄；文本仅四角（等比缩放字号），其余图形加四边中点手柄
        const H = (hx, hy, kind, cur) => `<rect class="gm-handle" data-id="${n.id}" data-h="${kind}" x="${(hx - 5).toFixed(1)}" y="${(hy - 5).toFixed(1)}" width="10" height="10" rx="2" fill="#fff" stroke="#11b5a4" stroke-width="2" style="cursor:${cur}"/>`;
        for (const [hx, hy, k, cur] of [[0, 0, "nw", "nwse-resize"], [w, 0, "ne", "nesw-resize"], [0, h, "sw", "nesw-resize"], [w, h, "se", "nwse-resize"]]) inner += H(hx, hy, k, cur);
        if (n.shape !== "text") inner += H(w / 2, 0, "n", "ns-resize") + H(w / 2, h, "s", "ns-resize") + H(0, h / 2, "w", "ew-resize") + H(w, h / 2, "e", "ew-resize");
      }
    }
    // 脑图：选中节点四角端点（作为关联线起点，可拖出连线，目标节点自动吸附）
    if (selected && this.mode === "mindmap" && !this._forExport) {
      const A = (hx, hy, c) => `<circle class="gm-anchor" data-id="${n.id}" data-c="${c}" cx="${hx}" cy="${hy}" r="5" fill="#11b5a4" stroke="#fff" stroke-width="1.5"/>`;
      inner += A(0, 0, "nw") + A(w, 0, "ne") + A(0, h, "sw") + A(w, h, "se");
    }
    // 流程图连线端口
    if (this.mode === "flowchart" && !this._forExport) {
      const ports = [["top", w / 2, 0], ["bottom", w / 2, h], ["left", 0, h / 2], ["right", w, h / 2]];
      for (const [p, px, py] of ports) inner += `<circle class="gm-port" data-id="${n.id}" data-port="${p}" cx="${px}" cy="${py}" r="6" fill="#fff" stroke="#11b5a4" stroke-width="2"/>`;
    }
    const op = n.opacity != null && n.opacity < 1 ? ` opacity="${n.opacity}"` : "";
    return `<g class="gm-node${selected ? " sel" : ""}" data-id="${n.id}" transform="translate(${n.x},${n.y})"${op}>${inner}</g>`;
  }

  // 流程图端口坐标（世界坐标）：p ∈ top / bottom / left / right
  _portPoint(n, s, p) {
    if (p === "top") return { x: n.x + s.w / 2, y: n.y };
    if (p === "left") return { x: n.x, y: n.y + s.h / 2 };
    if (p === "right") return { x: n.x + s.w, y: n.y + s.h / 2 };
    return { x: n.x + s.w / 2, y: n.y + s.h };
  }
  // 离参考点最近的端口名（自动选向用）
  _nearestPort(n, s, rx, ry) {
    const cands = ["top", "bottom", "left", "right"];
    let best = "top", bestD = Infinity;
    for (const p of cands) {
      const pt = this._portPoint(n, s, p);
      const d = Math.hypot(pt.x - rx, pt.y - ry);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // 脑图父子连线的接出方向：按两节点相对位置实时判断（不再依赖布局遗留的 side，
  // 取消自动重排后节点可被随意拖动，几何方向才可靠）
  // 直角布局（直角导图 / 目录组织）统一从右侧接出：所有子节点连线同侧、共用一条主干
  _mmSide(a, sa, b, sb) {
    if (this.doc.layout === "list" || this.doc.layout === "elbow") return "right";
    const acx = a.x + sa.w / 2, acy = a.y + sa.h / 2, bcx = b.x + sb.w / 2, bcy = b.y + sb.h / 2;
    const dx = bcx - acx, dy = bcy - acy;
    if (Math.abs(dy) > Math.abs(dx)) return dy >= 0 ? "down" : "up";
    return dx >= 0 ? "right" : "left";
  }

  // 关联线默认弧线的二次贝塞尔控制点
  _assocCtrl(ax, ay, bx, by) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const bow = Math.min(46, L * 0.18);
    return { x: mx - dy / L * bow, y: my + dx / L * bow };
  }

  // 连线的两个拉杆控制点（同时就是两个可拖动圆柄的位置）
  // 未调节时返回与默认曲线完全一致的控制点，保证调节前后形状连续；
  // aLev / bLev 是相对端点的偏移（世界单位），用户拖圆柄时写入
  _edgeCtrl(e, ends) {
    const { ax, ay, bx, by } = ends;
    const dx = bx - ax, dy = by - ay;
    let c1, c2;
    if (e.assoc) {
      const q = (e.bend && (e.bend.x || e.bend.y)) ? e.bend : this._assocCtrl(ax, ay, bx, by);
      // 二次 → 三次等价换算，保证拖动瞬间曲线不跳变
      c1 = { x: ax + (q.x - ax) * 2 / 3, y: ay + (q.y - ay) * 2 / 3 };
      c2 = { x: bx + (q.x - bx) * 2 / 3, y: by + (q.y - by) * 2 / 3 };
    } else {
      // 普通连线（流程图等）：控制点沿连线方向均匀分布，未调节时退化为直线
      c1 = { x: ax + dx * 0.28, y: ay + dy * 0.28 };
      c2 = { x: bx - dx * 0.28, y: by - dy * 0.28 };
    }
    if (e.aLev) c1 = { x: ax + e.aLev.x, y: ay + e.aLev.y };
    if (e.bLev) c2 = { x: bx + e.bLev.x, y: by + e.bLev.y };
    return { c1, c2 };
  }

  // 连线端点（世界坐标）：assoc 关联线吸附到两侧节点边框；脑图父子连线按几何方向接出；
  // 流程图四向端口——优先用连线记录的 fromPort/toPort，否则按两节点相对位置自动选向
  _edgeEnds(e) {
    const a = this.nodeById(e.from), b = this.nodeById(e.to);
    const sa = this.sizes.get(a.id), sb = this.sizes.get(b.id);
    if (e.assoc) {
      const acx = a.x + sa.w / 2, acy = a.y + sa.h / 2, bcx = b.x + sb.w / 2, bcy = b.y + sb.h / 2;
      // 头/尾调节点拖拽后的固定端点：优先相对锚点（aPtRel/bPtRel，随节点移动），其次世界坐标固定点，未调节过则吸附到节点边框
      const pa = e.aPtRel && a ? { x: a.x + e.aPtRel.dx, y: a.y + e.aPtRel.dy } : (e.aPt || this._rectEdgePoint(sa.w, sa.h, acx, acy, bcx, bcy));
      const pb = e.bPtRel && b ? { x: b.x + e.bPtRel.dx, y: b.y + e.bPtRel.dy } : (e.bPt || this._rectEdgePoint(sb.w, sb.h, bcx, bcy, acx, acy));
      return { ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y };
    }
    if (this.doc.type === "mindmap") {
      const side = this._mmSide(a, sa, b, sb);
      let pa, pb;
      if (side === "left") { pa = { x: a.x, y: a.y + sa.h / 2 }; pb = { x: b.x + sb.w, y: b.y + sb.h / 2 }; }
      else if (side === "right") { pa = { x: a.x + sa.w, y: a.y + sa.h / 2 }; pb = { x: b.x, y: b.y + sb.h / 2 }; }
      else if (side === "down") { pa = { x: a.x + sa.w / 2, y: a.y + sa.h }; pb = { x: b.x + sb.w / 2, y: b.y }; }
      else { pa = { x: a.x + sa.w / 2, y: a.y }; pb = { x: b.x + sb.w / 2, y: b.y + sb.h }; }
      // 端点被拉伸过：相对锚点优先（随节点移动），其次世界固定点
      if (e.aPtRel) pa = { x: a.x + e.aPtRel.dx, y: a.y + e.aPtRel.dy };
      else if (e.aPt) pa = e.aPt;
      if (e.bPtRel) pb = { x: b.x + e.bPtRel.dx, y: b.y + e.bPtRel.dy };
      else if (e.bPt) pb = e.bPt;
      return { ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y };
    }
    // 流程图：四向端口（头尾端点优先级：相对锚点 > 世界坐标固定点 > 端口 > 自动选向）
    const acx = a.x + sa.w / 2, acy = a.y + sa.h / 2, bcx = b.x + sb.w / 2, bcy = b.y + sb.h / 2;
    let pa = (e.aPtRel && a) ? { x: a.x + e.aPtRel.dx, y: a.y + e.aPtRel.dy } : (e.aPt || (e.fromPort ? this._portPoint(a, sa, e.fromPort) : null));
    let pb = (e.bPtRel && b) ? { x: b.x + e.bPtRel.dx, y: b.y + e.bPtRel.dy } : (e.bPt || (e.toPort ? this._portPoint(b, sb, e.toPort) : null));
    if (!pa && !pb) {
      // 自动选向：左右差大走横向端口，上下差大走纵向端口
      const dx = bcx - acx, dy = bcy - acy;
      if (Math.abs(dx) > Math.abs(dy)) {
        pa = this._portPoint(a, sa, dx > 0 ? "right" : "left");
        pb = this._portPoint(b, sb, dx > 0 ? "left" : "right");
      } else {
        pa = this._portPoint(a, sa, dy > 0 ? "bottom" : "top");
        pb = this._portPoint(b, sb, dy > 0 ? "top" : "bottom");
      }
    } else if (!pb) {
      pb = this._portPoint(b, sb, this._nearestPort(b, sb, pa.x, pa.y));
    } else if (!pa) {
      pa = this._portPoint(a, sa, this._nearestPort(a, sa, pb.x, pb.y));
    }
    return { ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y };
  }

  // 二次贝塞尔中点（按弧长取真实中点，弯曲较大时也不会偏）
  _quadMid(ax, ay, bx, by, bend) {
    if (!bend || (!bend.x && !bend.y)) return { x: (ax + bx) / 2, y: (ay + by) / 2 };
    const N = 32, pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      pts.push([mt * mt * ax + 2 * mt * t * bend.x + t * t * bx, mt * mt * ay + 2 * mt * t * bend.y + t * t * by]);
    }
    return this._polylineMid(pts);
  }
  // 三次贝塞尔中点（按弧长取真实中点：拉杆把曲线拉弯后，参数中点≠视觉中点）
  _cubicMid(ax, ay, c1, c2, bx, by) {
    const N = 40, pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
      pts.push([a * ax + b * c1.x + c * c2.x + d * bx, a * ay + b * c1.y + c * c2.y + d * by]);
    }
    return this._polylineMid(pts);
  }
  // 折线总长度一半处的中点
  _polylineMid(pts) {
    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push(len); total += len;
    }
    let half = total / 2;
    for (let i = 0; i < segs.length; i++) {
      if (half <= segs[i] || i === segs.length - 1) {
        const r = segs[i] ? half / segs[i] : 0;
        return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r };
      }
      half -= segs[i];
    }
    return { x: pts[0][0], y: pts[0][1] };
  }

  // 连线文字标签宽度（按中英文混排估算，保证文字完整落在框内）
  _labelWidth(text) {
    let w = 0;
    for (const ch of String(text || "")) w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 12 : 7;
    return Math.max(28, Math.min(280, w + 16));
  }

  // 连线避障：其它可见节点的包围盒（排除两端节点），用于判断连线是否压住节点
  _edgeObstacles(exA, exB, region) {
    const hidden = this.hiddenNodes();
    const out = [];
    for (const n of this.doc.nodes) {
      if (n.id === exA || n.id === exB || hidden.has(n.id)) continue;
      const b = this.nodeBBox(n);
      if (!Number.isFinite(b.x + b.y + b.w + b.h)) continue;
      const o = { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 };
      // 只保留与「两端点包围盒（外扩）」相交的节点，节点很多时避免逐条边全量扫描
      if (region && !(o.x < region.x2 && o.x + o.w > region.x1 && o.y < region.y2 && o.y + o.h > region.y1)) continue;
      out.push(o);
    }
    return out;
  }
  _bezierHits(ax, ay, c1, c2, bx, by, obstacles, n = 18) {
    if (!obstacles.length) return 0;
    let hits = 0;
    for (let i = 1; i < n; i++) {
      const t = i / n, u = 1 - t;
      const px = u * u * u * ax + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * bx;
      const py = u * u * u * ay + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * by;
      for (const o of obstacles) if (px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h) { hits++; break; }
    }
    return hits;
  }
  _polylineHits(pts, obstacles, seg = 8) {
    if (!obstacles.length) return 0;
    let hits = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      for (let j = 1; j < seg; j++) {
        const px = x1 + (x2 - x1) * j / seg, py = y1 + (y2 - y1) * j / seg;
        for (const o of obstacles) if (px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h) { hits++; break; }
      }
    }
    return hits;
  }
  // 绕行折线：从父节点接出方向外移，找一条不压节点的「通道」通到目标节点一侧
  _mmDetour(side, ax, ay, bx, by, obstacles) {
    const G = 24;
    if (side === "right" || side === "left") {
      const dir = side === "right" ? 1 : -1;
      let ch = ax + dir * G;
      for (let iter = 0; iter < 8; iter++) {
        let moved = false;
        for (const o of obstacles) {
          const overlap = Math.min(Math.max(ay, by), o.y + o.h) - Math.max(Math.min(ay, by), o.y);
          if (overlap <= 0) continue;
          if (ch > o.x - 6 && ch < o.x + o.w + 6) { ch = dir > 0 ? o.x + o.w + 12 : o.x - 12; moved = true; }
        }
        if (!moved) break;
      }
      const pts = [[ax, ay], [ch, ay], [ch, by], [bx, by]];
      return { pts, hits: this._polylineHits(pts, obstacles), d: `M ${ax},${ay} L ${ch.toFixed(1)},${ay} L ${ch.toFixed(1)},${by} L ${bx},${by}` };
    }
    const dir = side === "down" ? 1 : -1;
    let ch = ay + dir * G;
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (const o of obstacles) {
        const overlap = Math.min(Math.max(ax, bx), o.x + o.w) - Math.max(Math.min(ax, bx), o.x);
        if (overlap <= 0) continue;
        if (ch > o.y - 6 && ch < o.y + o.h + 6) { ch = dir > 0 ? o.y + o.h + 12 : o.y - 12; moved = true; }
      }
      if (!moved) break;
    }
    const pts = [[ax, ay], [ax, ch], [bx, ch], [bx, by]];
    return { pts, hits: this._polylineHits(pts, obstacles), d: `M ${ax},${ay} L ${ax},${ch.toFixed(1)} L ${bx},${ch.toFixed(1)} L ${bx},${by}` };
  }
  // 脑图父子连线路径（唯一出口，渲染与文字中点共用）：
  // 默认按接出方向画贝塞尔；若压到其它节点，逐步加大弧度避让；仍压则走折线绕行
  _mmEdgePath(e, ends) {
    const a = this.nodeById(e.from), b = this.nodeById(e.to);
    const { ax, ay, bx, by } = ends;
    if (!a || !b) return { d: `M ${ax},${ay} L ${bx},${by}`, mid: { x: (ax + bx) / 2, y: (ay + by) / 2 } };
    const sa = this.sizes.get(a.id), sb = this.sizes.get(b.id);
    const side = (sa && sb) ? this._mmSide(a, sa, b, sb) : "right";
    const isElbow = this.doc.layout === "list" || this.doc.layout === "elbow";
    if (isElbow) {
      // 直角布局：统一从父节点侧边接出并在固定偏移处共用主干（不参与避障，保持同侧单干）
      const G = 20;
      let d, pts;
      if (side === "down") { d = `M ${ax},${ay} V ${ay + G} H ${bx} V ${by}`; pts = [[ax, ay], [ax, ay + G], [bx, ay + G], [bx, by]]; }
      else if (side === "up") { d = `M ${ax},${ay} V ${ay - G} H ${bx} V ${by}`; pts = [[ax, ay], [ax, ay - G], [bx, ay - G], [bx, by]]; }
      else if (side === "left") { d = `M ${ax},${ay} H ${ax - G} V ${by} H ${bx}`; pts = [[ax, ay], [ax - G, ay], [ax - G, by], [bx, by]]; }
      else { d = `M ${ax},${ay} H ${ax + G} V ${by} H ${bx}`; pts = [[ax, ay], [ax + G, ay], [ax + G, by], [bx, by]]; }
      return { d, mid: this._polylineMid(pts) };
    }
    // 用户调过形状（拉直 / 调弯）：以弯曲控制点为二次贝塞尔；控制点位于端点连线上时退化为直线
    // 必须为首个命中分支，否则后面的避障 / 默认曲线会覆盖形状选择，导致「形状」不生效
    if (e.bend && (e.bend.x || e.bend.y)) {
      const d = `M ${ax},${ay} Q ${e.bend.x.toFixed(1)},${e.bend.y.toFixed(1)} ${bx},${by}`;
      return { d, mid: this._quadMid(ax, ay, bx, by, e.bend) };
    }
    const region = {
      x1: Math.min(ax, bx) - 140, y1: Math.min(ay, by) - 140,
      x2: Math.max(ax, bx) + 140, y2: Math.max(ay, by) + 140,
    };
    const obstacles = this._edgeObstacles(a.id, b.id, region);
    const horiz = side === "right" || side === "left";
    const mk = (off) => horiz
      ? { c1: { x: ax + (bx - ax) * 0.5, y: ay + off }, c2: { x: bx - (bx - ax) * 0.5, y: by + off } }
      : { c1: { x: ax + off, y: ay + (by - ay) * 0.5 }, c2: { x: bx + off, y: by - (by - ay) * 0.5 } };
    const cands = [mk(0)];
    // 弧度避让只取较小偏移，避免为躲一个小节点把线甩出很夸张的大弯；实在躲不开再走绕行折线
    for (const off of [40, 78, 120]) { cands.push(mk(off)); cands.push(mk(-off)); }
    let best = mk(0), bestHits = Infinity;
    for (const c of cands) {
      const hits = this._bezierHits(ax, ay, c.c1, c.c2, bx, by, obstacles);
      if (hits < bestHits) { bestHits = hits; best = c; if (hits === 0) break; }
    }
    if (bestHits > 0) {
      const detour = this._mmDetour(side, ax, ay, bx, by, obstacles);
      if (detour && detour.hits < bestHits) return { d: detour.d, mid: this._polylineMid(detour.pts) };
    }
    return {
      d: `M ${ax},${ay} C ${best.c1.x.toFixed(1)},${best.c1.y.toFixed(1)} ${best.c2.x.toFixed(1)},${best.c2.y.toFixed(1)} ${bx},${by}`,
      mid: this._cubicMid(ax, ay, best.c1, best.c2, bx, by),
    };
  }

  // 连线实际绘制路径的中点（文字标签 / 中点柄用）：必须和 edgeHTML 里画出来的曲线一致
  _edgePathMid(e, ends) {
    const { ax, ay, bx, by } = ends;
    // 先判定「这条线实际怎么画」：拉杆 / 弯曲 / 关联线弧形 / 脑图父子线 / 普通线
    if (e.aLev || e.bLev) {
      const { c1, c2 } = this._edgeCtrl(e, ends);
      return this._cubicMid(ax, ay, c1, c2, bx, by);
    }
    if (e.bend && (e.bend.x || e.bend.y)) return this._quadMid(ax, ay, bx, by, e.bend);
    if (e.assoc) {
      const q = this._assocCtrl(ax, ay, bx, by);
      return { x: 0.25 * ax + 0.5 * q.x + 0.25 * bx, y: 0.25 * ay + 0.5 * q.y + 0.25 * by };
    }
    if (this.doc.type === "mindmap" && e.derived) return this._mmEdgePath(e, ends).mid;
    const { c1, c2 } = this._edgeCtrl(e, ends);
    return this._cubicMid(ax, ay, c1, c2, bx, by);
  }

  // 选中集中的唯一连线 id（选择集里以 "e:" 前缀标识连线），无则 null
  _selEdgeId() {
    for (const k of this.selection) if (k.startsWith && k.startsWith("e:")) return k.slice(2);
    return null;
  }
  edgeById(id) { return this.doc.edges.find((e) => e.id === id); }

  edgeHTML(e) {
    const a = this.nodeById(e.from), b = this.nodeById(e.to);
    if (!a || !b) return "";
    const sa = this.sizes.get(a.id), sb = this.sizes.get(b.id);
    if (!sa || !sb) return "";
    const selKey = "e:" + e.id;
    const sel = this.selection.has(selKey);
    const dataEdge = ` data-edge="${e.id}"`;
    const hitPath = (d) => `<path class="gm-edge" d="${d}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"${dataEdge}/>`;
    // 连线样式（选中高亮）：颜色 / 宽度 / 线型，均可按连线覆盖
    const stroke = sel ? "#11b5a4" : (e.stroke || (e.derived ? (b.stroke || "#11b5a4") : e.assoc ? "#ff9f43" : "#94a3b8"));
    const sw = e.strokeWidth || 2;
    const style = e.strokeStyle || (e.assoc || e.derived ? (e.assoc ? "dashed" : "solid") : "solid");
    const dash = style === "dashed" ? ` stroke-dasharray="${(7 + sw * 2).toFixed(1)} ${(5 + sw * 2).toFixed(1)}"`
      : style === "dotted" ? ` stroke-dasharray="${Math.max(0.1, sw * 0.5).toFixed(2)} ${(sw * 2.2).toFixed(1)}" stroke-linecap="round"` : "";
    // 箭头模式：none 无 / end 右(尾) / start 左(头) / both 双向；默认：流程线带尾箭头，其余无
    const am = e.arrowMode || (e.arrow === false ? "none" : (e.assoc || e.derived ? "none" : "end"));
    const mkEnd = am === "end" || am === "both" ? ` marker-end="url(#gm-arrow)"` : "";
    const mkStart = am === "start" || am === "both" ? ` marker-start="url(#gm-arrow)"` : "";
    // 关联线：任意两节点间的曲线（端点自动吸附到两侧节点边框），拉杆可调弧度
    if (e.assoc) {
      const ends = this._edgeEnds(e);
      const { ax, ay, bx, by } = ends;
      let d;
      if (e.aLev || e.bLev) {
        // 已用拉杆调过弧度：三次贝塞尔，控制点就是两个圆柄
        const { c1, c2 } = this._edgeCtrl(e, ends);
        d = `M ${ax.toFixed(1)},${ay.toFixed(1)} C ${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
      } else if (e.bend && (e.bend.x || e.bend.y)) d = `M ${ax.toFixed(1)},${ay.toFixed(1)} Q ${e.bend.x.toFixed(1)},${e.bend.y.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
      else {
        const q = this._assocCtrl(ax, ay, bx, by);
        d = `M ${ax.toFixed(1)},${ay.toFixed(1)} Q ${q.x.toFixed(1)},${q.y.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
      }
      // 文字标签固定在曲线中点（随端点和弧度实时居中）
      const mid = this._edgePathMid(e, ends);
      const lw = this._labelWidth(e.label);
      const lbl = e.label
        ? `<rect x="${(mid.x - lw / 2).toFixed(1)}" y="${(mid.y - 10).toFixed(1)}" width="${lw.toFixed(1)}" height="20" rx="5" fill="#fff" stroke="${sel ? "#11b5a4" : "#ffe0c2"}"/><text x="${mid.x.toFixed(1)}" y="${(mid.y + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="#d97706">${escapeXml(e.label)}</text>`
        : "";
      return hitPath(d) + `<path d="${d}" fill="none" stroke="${stroke}" ${`stroke-width="${sw}"`}${dash} stroke-linecap="round"${mkStart}${mkEnd}${dataEdge}/>${lbl}`;
    }
    let d;
    const ends = this._edgeEnds(e);
    const { ax, ay, bx, by } = ends;
    if ((e.aLev || e.bLev) && this.doc.type !== "mindmap") {
      // 流程图等普通连线：拉杆调过弧度 -> 三次贝塞尔
      const { c1, c2 } = this._edgeCtrl(e, ends);
      d = `M ${ax.toFixed(1)},${ay.toFixed(1)} C ${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
    } else if (e.bend && (e.bend.x || e.bend.y)) {
      // 自由弯曲：拖中点后的二次贝塞尔
      d = `M ${ax},${ay} Q ${e.bend.x.toFixed(1)},${e.bend.y.toFixed(1)} ${bx},${by}`;
    } else if (this.doc.type === "mindmap") {
      // 脑图父子连线：接出方向按节点相对位置实时判断，路径统一由 _mmEdgePath 生成（含避障）
      d = this._mmEdgePath(e, ends).d;
    } else {
      // 流程图等普通连线：三次贝塞尔（控制点即两个拉杆；未调节时控制点共线 => 直线）
      const { c1, c2 } = this._edgeCtrl(e, ends);
      d = `M ${ax.toFixed(1)},${ay.toFixed(1)} C ${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
    }
    const marker = `${mkStart}${mkEnd}`;
    let label = "";
    if (e.label) {
      // 文字标签固定在曲线中点（随端点 / 弧度 / 布局实时居中）
      const mid = this._edgePathMid(e, ends);
      const lw = this._labelWidth(e.label);
      label = `<rect x="${(mid.x - lw / 2).toFixed(1)}" y="${(mid.y - 10).toFixed(1)}" width="${lw.toFixed(1)}" height="20" rx="5" fill="#fff" stroke="${sel ? "#11b5a4" : "#e2e8f0"}"/><text x="${mid.x.toFixed(1)}" y="${(mid.y + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="#64748b">${escapeXml(e.label)}</text>`;
    }
    return hitPath(d) + `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash}${marker}${dataEdge}/>${label}`;
  }

  // 选中连线时的两个「拉杆」圆柄（仅关联线 / 流程图连线这类真正的连线；
  // 脑图父子线属于结构连接，不给调节点）
  // 圆柄位置 = 三次贝塞尔控制点，圆柄与端点之间画细引导线；
  // 拖圆柄 = 拉伸/收缩拉杆调节弧度，拖到其它节点上松手 = 重新吸附端点
  edgeHandleHTML() {
    const eid = this._selEdgeId();
    if (!eid) return "";
    const e = this.edgeById(eid);
    // 脑图派生线（父子连接）无需调节点
    if (!e) return "";
    const a = this.nodeById(e.from), b = this.nodeById(e.to);
    if (!a || !b) return "";
    const ends = this._edgeEnds(e);
    const { ax, ay, bx, by } = ends;
    const { c1, c2 } = this._edgeCtrl(e, ends);
    const lead = (x1, y1, x2, y2) => `<line class="gm-edge-lead" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#11b5a4" stroke-width="1.3" stroke-opacity="0.7" pointer-events="none"/>`;
    // 拉杆柄：空心小圆（调弧度）
    const LEV = (hx, hy, kind, title) =>
      `<circle class="gm-edge-handle" data-edge="${eid}" data-h="${kind}" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="5.5" fill="#fff" stroke="#11b5a4" stroke-width="1.8"><title>${title}</title></circle>` +
      `<circle class="gm-edge-handle-hit" data-edge="${eid}" data-h="${kind}" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="12" fill="transparent" stroke="none" pointer-events="all"/>`;
    // 位置柄：实心小圆（拖端点 / 中点）
    const POS = (hx, hy, kind, title) =>
      `<circle class="gm-edge-handle" data-edge="${eid}" data-h="${kind}" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="5" fill="#11b5a4" stroke="#fff" stroke-width="1.6"><title>${title}</title></circle>` +
      `<circle class="gm-edge-handle-hit" data-edge="${eid}" data-h="${kind}" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="11" fill="transparent" stroke="none" pointer-events="all"/>`;
    const TIP_L0 = "起点拉杆：拖动伸缩调节弧度；拖到其它节点上松手可重新吸附";
    const TIP_L1 = "终点拉杆：拖动伸缩调节弧度；拖到其它节点上松手可重新吸附";
    let out = lead(ax, ay, c1.x, c1.y) + lead(bx, by, c2.x, c2.y) +
      LEV(c1.x, c1.y, "levA", TIP_L0) + LEV(c2.x, c2.y, "levB", TIP_L1);
    // 关联线额外保留原来的 3 个位置调节点：起点 / 中点（弯曲）/ 终点
    // 3 个位置调节点（关联线 / 流程图连线通用）：起点 / 中点（弯曲）/ 终点
    {
      const mc = this._edgePathMid(e, ends);
      out += POS(ax, ay, "p0", "起点：拖动可移动 / 吸附到其它节点，拖到空白处固定")
        + POS(mc.x, mc.y, "mid", "中点：拖动调节弯曲")
        + POS(bx, by, "p1", "终点：拖动可移动 / 吸附到其它节点，拖到空白处固定");
    }
    return out;
  }

  // 连线样式：批量应用到选中的连线（stroke/strokeWidth/strokeStyle）；bend: null 移除 / "straight" 拉直
  // 注意：bend（形状）优先级须高于拉杆（aLev/bLev）——设置形状时同步清除拉杆，否则渲染时拉杆分支先行命中导致形状不生效
  setEdgeStyle(patch) {
    const ids = [];
    for (const k of this.selection) if (k.startsWith && k.startsWith("e:")) ids.push(k.slice(2));
    if (!ids.length) return;
    for (const e of this.doc.edges) {
      if (!ids.includes(e.id)) continue;
      for (const k of Object.keys(patch)) {
        if (patch[k] === null) delete e[k];
        else e[k] = patch[k];
      }
      if ("bend" in patch) {
        delete e.aLev; delete e.bLev; // 形状选择覆盖拉杆弧度
        if (patch.bend === "straight") {
          const { ax, ay, bx, by } = this._edgeEnds(e);
          e.bend = { x: (ax + bx) / 2, y: (ay + by) / 2 };
        }
      }
    }
    this.render(); this.onChange(); this.pushHistory();
  }
  // 按 id 精确设置单条连线样式（双击连线弹框用，避免依赖当前选择）
  setEdgeStyleFor(id, patch) {
    const e = this.edgeById(id); if (!e) return;
    for (const k of Object.keys(patch)) { if (patch[k] === null) delete e[k]; else e[k] = patch[k]; }
    if ("bend" in patch) {
      delete e.aLev; delete e.bLev;
      if (patch.bend === "straight") { const { ax, ay, bx, by } = this._edgeEnds(e); e.bend = { x: (ax + bx) / 2, y: (ay + by) / 2 }; }
    }
    this.render(); this.onChange(); this.pushHistory();
  }

  // 脑图父子连线（派生线）弯曲调节：bend 存于子节点 edgeBend（重渲染不丢）。
  // mode: "curve" 恢复默认曲线 / "straight" 拉直（bend 取两端中点）
  setDerivedEdgeBend(childId, mode) {
    const n = this.nodeById(childId); if (!n || !n.parentId) return;
    const p = this.nodeById(n.parentId); if (!p) return;
    if (mode === "curve") { delete n.edgeBend; }
    else {
      // 复用 _edgeEnds：与渲染完全一致的端点计算（含 side 判断 / 端点吸附），避免自算中点偏差
      const de = { id: "p-" + n.id, from: p.id, to: n.id, derived: true };
      const { ax, ay, bx, by } = this._edgeEnds(de);
      n.edgeBend = { x: (ax + bx) / 2, y: (ay + by) / 2 };
    }
    this.render(); this.onChange(); this.pushHistory();
  }

  strokeHTML(s) {
    if (!s.points || s.points.length < 2) return "";
    const d = "M " + s.points.map((p) => `${p.x},${p.y}`).join(" L ");
    return `<path d="${d}" fill="none" stroke="${s.color || "#1f2a37"}" stroke-width="${s.width || 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  tempConnectHTML() {
    const a = this.nodeById(this._connect.from);
    if (!a) return "";
    const p = this.toWorld(this._connect.cx, this._connect.cy);
    // 脑图关联线拖拽中：从四角端点出发的橙色虚线
    if (this._connect.assoc) {
      const s = this.sizes.get(a.id);
      const sx = this._connect.ax != null ? this._connect.ax : a.x + s.w / 2;
      const sy = this._connect.ay != null ? this._connect.ay : a.y + s.h;
      return `<circle cx="${sx}" cy="${sy}" r="5" fill="#11b5a4" stroke="#fff" stroke-width="1.5"/>` +
        `<path d="M ${sx},${sy} L ${p.x.toFixed(1)},${p.y.toFixed(1)}" fill="none" stroke="#ff9f43" stroke-width="2" stroke-dasharray="7 5"/>` +
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#fff" stroke="#ff9f43" stroke-width="2"/>`;
    }
    const s = this.sizes.get(a.id);
    const sx = this._connect.ax != null ? this._connect.ax : a.x + s.w / 2;
    const sy = this._connect.ay != null ? this._connect.ay : a.y + s.h;
    return `<path d="M ${sx},${sy} C ${sx},${(sy + p.y) / 2} ${p.x},${(sy + p.y) / 2} ${p.x},${p.y}" fill="none" stroke="#11b5a4" stroke-width="2" stroke-dasharray="5 4"/>`;
  }

  // 从矩形中心指向目标点的射线与矩形边框的交点（关联线端点吸附）
  _rectEdgePoint(w, h, cx, cy, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    let t = Infinity;
    if (dx !== 0) t = Math.min(t, w / 2 / Math.abs(dx));
    if (dy !== 0) t = Math.min(t, h / 2 / Math.abs(dy));
    if (!isFinite(t)) return { x: cx, y: cy };
    return { x: cx + dx * t, y: cy + dy * t };
  }

  // ---------- 脑图：外框 / 概括 ----------
  // 节点及其全部后代的包围盒（世界坐标）
  subtreeBBox(id) {
    const ids = this.descendants(id); ids.add(id);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const nid of ids) {
      const n = this.nodeById(nid); if (!n) continue;
      const b = this.nodeBBox(n);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    if (minX === Infinity) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  // 外框：虚线圆角矩形圈住一组成员节点（世界坐标）；g.text 为可选标题；sel 选中高亮
  frameHTML(members, g, sel) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of members) {
      const b = this.nodeBBox(n);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    if (minX === Infinity) return "";
    const pad = 14;
    const col = sel ? "#11b5a4" : (g.stroke || "#aab3bf");
    const box = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    const title = g.text ? String(g.text) : "";
    // 标题自动避让：优先用框顶预留带（框向上扩 TH，标题落在带内左上），被节点占用时在带内向右平移；
    // 整条带都被占则改用框底预留带；两处都占才回落到框顶——无论如何都不会压住框内成员节点
    let r = box, labelX = box.x + 10, labelY = 0;
    if (title) {
      const tw = Math.min(320, this._labelWidth(title) + 6);
      const TH = 24;
      const obstacles = this._obstacles(new Set(members.map((m) => m.id)), 4);
      const topR = { x: box.x, y: box.y - TH, w: box.w, h: box.h + TH };
      const botR = { x: box.x, y: box.y, w: Math.max(box.w, 10 + tw + 18), h: box.h + TH };
      const topBandY = box.y - TH + 3;
      const botBandY = box.y + box.h + 3;
      // 在带内沿水平方向找空位（步进 16px）
      const scan = (bandY, limitX) => {
        for (let startX = box.x + 10; startX + tw <= limitX; startX += 16) {
          if (!this._rectHitAny({ x: startX, y: bandY, w: tw, h: 18 }, obstacles)) return startX;
        }
        return null;
      };
      const topX = scan(topBandY, Math.max(box.x + box.w - 8, box.x + 10 + tw));
      const botX = scan(botBandY, Math.max(botR.x + botR.w - 8, box.x + 10 + tw));
      if (topX !== null) { r = topR; labelX = topX; labelY = topBandY + 14; }
      else if (botX !== null) { r = botR; labelX = botX; labelY = botBandY + 14; }
      else { r = topR; labelX = box.x + 10; labelY = topBandY + 14; }
      // 标题比框宽时把框向右扩，避免标题溢出框外
      const needW = labelX + tw + 8;
      if (r.x + r.w < needW) r.w = needW - r.x;
    }
    const titleEl = title
      ? `<text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="14" font-weight="600" fill="${col}" font-family='-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'>${escapeXml(title)}</text>`
      : "";
    return `<g class="gm-group gm-frame" data-g="${g.id}">` +
      `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" rx="12" fill="${col}14" stroke="${col}" stroke-width="${sel ? 2.5 : 1.8}" stroke-dasharray="7 5"/>` + titleEl + `</g>`;
  }
  // 概括：一组成员右侧的大括号 + 标签（g.text，默认「概要」）；sel 选中高亮
  summaryHTML(members, g, sel) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of members) {
      const b = this.nodeBBox(n);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    if (minX === Infinity) return "";
    const col = sel ? "#11b5a4" : (g.stroke || "#f5a623");
    const obstacles = this._obstacles(new Set(members.map((m) => m.id)), 4);
    const y0 = minY, y1 = maxY, ym = (y0 + y1) / 2;
    // 大括号默认贴成员右侧 10px；右侧紧邻别的节点时整体外移，避免线压节点
    let x = maxX + 10;
    if (this._rectHitAny({ x, y: y0, w: 24, h: Math.max(8, y1 - y0) }, obstacles)) x = maxX + 28;
    const k = Math.min(9, Math.max(5, (y1 - y0) * 0.25));
    const d = `M ${x.toFixed(1)},${y0.toFixed(1)} Q ${(x + 9).toFixed(1)},${y0.toFixed(1)} ${(x + 9).toFixed(1)},${(y0 + k).toFixed(1)} L ${(x + 9).toFixed(1)},${(ym - k).toFixed(1)} Q ${(x + 9).toFixed(1)},${ym.toFixed(1)} ${(x + 16).toFixed(1)},${ym.toFixed(1)} Q ${(x + 9).toFixed(1)},${ym.toFixed(1)} ${(x + 9).toFixed(1)},${(ym + k).toFixed(1)} L ${(x + 9).toFixed(1)},${(y1 - k).toFixed(1)} Q ${(x + 9).toFixed(1)},${y1.toFixed(1)} ${x.toFixed(1)},${y1.toFixed(1)}`;
    const label = g.text || "概要";
    const lw = Math.max(36, this._labelWidth(label) + 16);
    // 标签跟着括号走；若与其它节点重叠则继续向右平移找空位（最多 220px）
    let lx = x + 24;
    for (let i = 0; i < 10; i++) {
      if (!this._rectHitAny({ x: lx, y: ym - 15, w: lw, h: 30 }, obstacles)) break;
      lx += 22;
    }
    return `<g class="gm-group gm-summary" data-g="${g.id}">` +
      `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>` +
      `<rect x="${lx.toFixed(1)}" y="${(ym - 15).toFixed(1)}" width="${lw}" height="30" rx="8" fill="#fff" stroke="${col}" stroke-width="1.5"/>` +
      `<text x="${(lx + lw / 2).toFixed(1)}" y="${(ym + 5).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="600" fill="#1f2a37" font-family='-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'>${escapeXml(label)}</text>` +
      `</g>`;
  }

  // 关联线自动吸附：光标所在 / 附近（26px 容差）的最近节点 id，无则 null
  snapNodeAt(clientX, clientY) {
    const w = this.toWorld(clientX, clientY);
    const tol = 26 / this.view.scale;
    let best = null, bestD = Infinity;
    for (const n of this.doc.nodes) {
      const b = this.nodeBBox(n);
      const dx = Math.max(b.x - w.x, 0, w.x - (b.x + b.w));
      const dy = Math.max(b.y - w.y, 0, w.y - (b.y + b.h));
      const d = Math.hypot(dx, dy);
      if (d <= tol && d < bestD) { bestD = d; best = n.id; }
    }
    return best;
  }

  // ---------- 查找 ----------
  nodeById(id) { return this.doc.nodes.find((n) => n.id === id); }
  childrenMap() {
    const m = new Map();
    for (const n of this.doc.nodes) { if (n.parentId) { if (!m.has(n.parentId)) m.set(n.parentId, []); m.get(n.parentId).push(n.id); } }
    return m;
  }
  // 每个节点的「后代节点总数」（含间接后代），用于折叠徽标上显示数字
  _calcDescCounts() {
    const kids = this.childrenMap();
    const memo = new Map();
    const count = (id, guard) => {
      if (memo.has(id)) return memo.get(id);
      if (guard.has(id)) return 0; // 数据异常成环时兜底
      guard.add(id);
      let c = 0;
      for (const k of kids.get(id) || []) c += 1 + count(k, guard);
      memo.set(id, c);
      return c;
    };
    for (const n of this.doc.nodes) count(n.id, new Set());
    return memo;
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
    // 设置：滚轮行为可切换为上下平移视图
    if (this.wheelPan) { this.panBy(0, -e.deltaY); return; }
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomAt(factor, e.clientX, e.clientY);
  }
  fitView(immediate) {
    const b = this.getBounds();
    const r = this.rect();
    if (!b || !Number.isFinite(b.x + b.y + b.w + b.h) || b.w <= 0 || b.h <= 0) {
      // 空画布：视图归位到画布中心（缩放 1），避免内容落到左上角
      this.view = { x: r.width / 2, y: r.height / 2, scale: 1 }; this.render(); return;
    }
    const pad = 60;
    // 下限放到 0.05：超大画布也能整体缩进屏幕（整理布局要求「大小适配屏幕」）
    const scale = Math.min(1.3, Math.max(0.05, Math.min((r.width - pad) / b.w, (r.height - pad) / b.h)));
    this.view.scale = scale;
    this.view.x = (r.width - b.w * scale) / 2 - b.x * scale;
    this.view.y = (r.height - b.h * scale) / 2 - b.y * scale;
    this.render();
  }
  // 节点包围盒（箭头 / 直线的 w、h 是增量，可能为负）
  // 障碍矩形集合（用于外框标题 / 概括标签 / 新节点的避让检测）：默认取所有节点包围盒并外扩 pad
  _obstacles(excludeIds = null, pad = 6) {
    const out = [];
    const hidden = this.hiddenNodes();  // 折叠隐藏的子树不可见，不参与避让
    for (const n of this.doc.nodes) {
      if (excludeIds && excludeIds.has(n.id)) continue;
      if (hidden.has(n.id)) continue;
      const b = this.nodeBBox(n);
      out.push({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 });
    }
    return out;
  }
  _rectHitAny(r, list) {
    for (const o of list) {
      if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) return true;
    }
    return false;
  }
  // 给待放置节点找空位：从 (x,y) 向下逐格试探，其次向上；保证不与已有节点重叠（留 10px 呼吸间距）
  _freeSpotFor(x, y, w, h, excludeIds = null, maxTry = 160) {
    const obst = this._obstacles(excludeIds, 10);
    const hit = (px, py) => this._rectHitAny({ x: px, y: py, w, h }, obst);
    if (!hit(x, y)) return { x, y };
    const STEP = 8;
    for (let i = 1; i <= maxTry; i++) {
      if (!hit(x, y + i * STEP)) return { x, y: y + i * STEP };
      if (i <= 30 && !hit(x, y - i * STEP)) return { x, y: y - i * STEP };
    }
    return { x, y };
  }

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
    // 脑图折叠隐藏的子树不计入包围盒：整理布局 / 适配屏幕只按当前可见内容计算
    const hidden = this.hiddenNodes();
    for (const n of this.doc.nodes) {
      if (hidden.has(n.id)) continue;
      const b = this.nodeBBox(n); if (!b) continue;
      // 坐标异常（undefined/NaN，如旧数据孤儿节点）的节点不参与包围盒，避免视图变 NaN 整图消失
      if (!Number.isFinite(b.x + b.y + b.w + b.h)) continue;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    for (const st of this.doc.strokes) for (const p of st.points || []) { if (!Number.isFinite(p.x + p.y)) continue; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    if (!Number.isFinite(minX)) return null;
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
    // 右键：仅阻止默认行为；双击检测统一在 window 捕获层（见下方），此处只短路
    if (e.button === 2) {
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const r = this.rect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const target = e.target;

    // 图片（脑图节点图片 / 白板图片节点）：记录待放大源，单击（未拖动）时由 onUp 触发灯箱
    const imgEl = target.closest && target.closest("[data-img]");
    if (imgEl) this._pendingImgZoom = imgEl.getAttribute("href") || imgEl.getAttribute("xlink:href") || null;

    if (this.readOnly) {
      if (!e.shiftKey) this.clearSelection();
      this._pan = { sx, sy, ox: this.view.x, oy: this.view.y };
      return;
    }

    // ---------- 抓手工具（脑图 / 流程图 / 白板通用）：拖拽平移画布 ----------
    if (this.tool === "hand") {
      this._pan = { sx, sy, ox: this.view.x, oy: this.view.y };
      return;
    }

    // ---------- 备注徽标：按下即记录（pointerup 时弹框），不触发选择/拖拽 ----------
    // （不能用 click 委托：按下后 select() 重渲染会替换 DOM，click 目标丢失）
    const badgeEl = target.closest && target.closest(".gm-note-badge");
    if (badgeEl && this.mode === "mindmap") {
      this._pendingBadge = badgeEl.getAttribute("data-note");
      return;
    }

    // 脑图折叠徽标：按下即记录（pointerup 时切换折叠状态）
    const colEl = target.closest && target.closest(".gm-collapse-badge");
    if (colEl && this.mode === "mindmap") {
      this._pendingCollapse = colEl.getAttribute("data-collapse");
      return;
    }

    // 选中连线的调节点：按下开始拖拽（mid 调弯曲 / p0、p1 调端点）
    // 端点柄画在端点外侧 18px，记录「光标 - 端点」偏移，拖动时端点跟着手柄稳定移动（不会瞬移到光标）
    const edgeHandleEl = target.closest && target.closest(".gm-edge-handle, .gm-edge-handle-hit");
    if (edgeHandleEl) {
      const eid0 = edgeHandleEl.getAttribute("data-edge");
      const kind0 = edgeHandleEl.getAttribute("data-h") || "levA";
      this._edgeDrag = { id: eid0, kind: kind0, moved: false, snapTo: null, off: null };
      const e0 = this.edgeById(eid0);
      if (e0) {
        const ends0 = this._edgeEnds(e0);
        const w0 = this.toWorld(e.clientX, e.clientY);
        if (kind0 === "levA" || kind0 === "levB") {
          // 拉杆柄：记录「光标 - 控制点」偏移，拖动时手感连续不跳
          const { c1, c2 } = this._edgeCtrl(e0, ends0);
          const c = kind0 === "levA" ? c1 : c2;
          this._edgeDrag.off = { x: w0.x - c.x, y: w0.y - c.y };
        } else if (kind0 === "p0" || kind0 === "p1") {
          const ap = kind0 === "p0" ? { x: ends0.ax, y: ends0.ay } : { x: ends0.bx, y: ends0.by };
          this._edgeDrag.off = { x: w0.x - ap.x, y: w0.y - ap.y };
        }
      }
      return;
    }

    // ---------- 白板：自由变换手柄（直线/箭头端点与弯曲、通用四角/四边缩放）----------
    // 仅选择工具下响应：图形/画笔等创建工具按下时不受手柄拦截，保证「任意位置都能画」
    const handleEl = target.closest && target.closest(".gm-handle");
    if (handleEl && this.mode === "whiteboard" && this.tool === "select") {
      const hid = handleEl.getAttribute("data-id");
      const hn = this.nodeById(hid);
      if (hn) {
        this.selection = new Set([hid]);
        const hs = this.sizes.get(hid) || sizeOf(hn, this.doc.type);
        this._handle = {
          id: hid, kind: handleEl.getAttribute("data-h"), sx, sy, moved: false,
          orig: {
            x: hn.x, y: hn.y, fs: hn.fontSize || 18,
            w: hn.w != null ? hn.w : hs.w, h: hn.h != null ? hn.h : hs.h,
            bend: hn.bend ? { ...hn.bend } : null,
          },
        };
        this.render();
      }
      return;
    }

    // ---------- 关联线（流程图 / 脑图）：按住左键拖拽，遇吸附点自动吸附，松开完成并切回选择工具 ----------
    if ((this.mode === "flowchart" || this.mode === "mindmap") && this.tool === "link") {
      // 脑图：从选中节点四角端点按下 -> 拖拽连线，松开自动吸附目标节点
      const anchorEl = target.closest && target.closest(".gm-anchor");
      if (anchorEl && this.mode === "mindmap") {
        const aid = anchorEl.getAttribute("data-id");
        const an = this.nodeById(aid);
        const as = this.sizes.get(aid);
        if (an && as) {
          const c = anchorEl.getAttribute("data-c") || "se";
          this._connect = {
            from: aid, assoc: true,
            ax: an.x + (c.includes("e") ? as.w : 0), ay: an.y + (c.includes("s") ? as.h : 0),
            cx: e.clientX, cy: e.clientY,
          };
        }
        return;
      }
      // 从节点本体（或光标附近吸附到的节点）按下：起点取节点边框上朝向光标的点
      const hitEl0 = target.closest && target.closest("[data-id]");
      const fromId = hitEl0 ? hitEl0.getAttribute("data-id") : this.snapNodeAt(e.clientX, e.clientY);
      if (fromId) {
        const fn = this.nodeById(fromId), fs = this.sizes.get(fromId);
        if (fn && fs) {
          const wp = this.toWorld(e.clientX, e.clientY);
          const ep = this._rectEdgePoint(fs.w, fs.h, fn.x + fs.w / 2, fn.y + fs.h / 2, wp.x, wp.y);
          this.selection = new Set([fromId]);
          this.render();
          this._connect = { from: fromId, cx: e.clientX, cy: e.clientY, assoc: this.mode === "mindmap", ax: ep.x, ay: ep.y };
        }
      }
      return;
    }

    // ---------- 白板各工具 ----------
    if (this.mode === "whiteboard") {
      const w = this.toWorld(e.clientX, e.clientY);
      switch (this.tool) {
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

    // ---------- 流程图：形状工具激活时，点击处创建组件（先选工具再点画布，不自动落点）----------
    // 点击在已有节点包围盒内（文字节点无背景矩形，须按 bbox 命中）：文字工具原地编辑该节点文字，
    // 其余形状工具转为选中，均不再叠加新建
    if (this.mode === "flowchart" && FC_SHAPE_TOOLS.includes(this.tool)) {
      const w0 = this.toWorld(e.clientX, e.clientY);
      let hitId0 = null;
      for (let i = this.doc.nodes.length - 1; i >= 0; i--) {
        const nd = this.doc.nodes[i];
        const bb = this.nodeBBox(nd);
        if (w0.x >= bb.x && w0.x <= bb.x + bb.w && w0.y >= bb.y && w0.y <= bb.y + bb.h) { hitId0 = nd.id; break; }
      }
      if (hitId0) {
        if (this.tool === "text") this.beginTextEdit(hitId0);
        else { this.selection = new Set([hitId0]); this.render(); }
        this.setTool("select");
        return;
      }
      const w = this.toWorld(e.clientX, e.clientY);
      this.addFlowShape(this.tool, w.x, w.y);
      this.setTool("select");
      return;
    }

    const portEl = target.closest && target.closest(".gm-port");
    const hitEl = target.closest && target.closest("[data-id]");
    let id = hitEl ? hitEl.getAttribute("data-id") : null;

    // 连线：选中（Shift 叠加多选）；中点手柄已在上方处理（脑图派生线也可选中调节弯曲）
    const edgeEl = target.closest && target.closest("[data-edge]");
    const edgeIdAttr = edgeEl && edgeEl.getAttribute("data-edge");
    if (edgeEl && edgeIdAttr && this.tool === "select" && this.mode !== "whiteboard") {
      const key = "e:" + edgeIdAttr;
      if (e.shiftKey) {
        if (this.selection.has(key)) this.selection.delete(key); else this.selection.add(key);
        this.render();
      } else if (!this.selection.has(key)) {
        this.selection = new Set([key]);
        this.render();
      }
      return;
    }

    // 分组（外框 / 概括）：单击选中，450ms 内再次点击 = 双击打开编辑弹框
    // （不能用原生 dblclick：首次点击会重渲染替换 DOM，dblclick 事件丢失）
    const groupEl = target.closest && target.closest(".gm-group");
    if (groupEl && this.doc.type === "mindmap" && this.tool === "select") {
      const gid = groupEl.getAttribute("data-g");
      if (gid) {
        const now = performance.now();
        if (this._lastGroupClick && this._lastGroupClick.gid === gid && now - this._lastGroupClick.t < 450) {
          this._lastGroupClick = null;
          if (this._onGroupEdit) this._onGroupEdit(gid);
        } else {
          this._lastGroupClick = { gid, t: now };
          this.selection = new Set(["g:" + gid]);
          this.render();
        }
        return;
      }
    }

    if (portEl && id && !(this.nodeById(id) && this.nodeById(id).locked)) {
      // 从端口按下：起点固定在该端口上（top/bottom/left/right 四向吸附）
      const n0 = this.nodeById(id), s0 = this.sizes.get(id);
      const p0 = portEl.getAttribute("data-port");
      const pt = n0 && s0 ? this._portPoint(n0, s0, p0) : null;
      this._connect = { from: id, fromPort: p0, ax: pt ? pt.x : undefined, ay: pt ? pt.y : undefined, cx: e.clientX, cy: e.clientY };
      return;
    }

    // 锁定的节点：不可选中 / 拖动（视为空白，走框选或平移）
    if (id && this.nodeById(id) && this.nodeById(id).locked) id = null;

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
    // 关联线工具悬停：自动吸附高亮光标附近的节点（点击 / 松开连线时直接采用）
    if (this.tool === "link" && (this.mode === "mindmap" || this.mode === "flowchart") && !this._connect) {
      const hid = this.snapNodeAt(e.clientX, e.clientY);
      if (hid !== this._linkHover) { this._linkHover = hid; this.render(); }
      return;
    }
    // 连线调节柄拖拽：
    //  · levA / levB（空心圆）= 拉杆，拖动伸缩调节弧度（写入 aLev / bLev）；
    //  · p0 / p1（实心圆）= 移动端点（可吸附到其它节点），mid（实心圆）= 调节弯曲
    // 松手时若拉杆落在其它节点上，则把该端点重新吸附到那个节点（见 onUp）
    if (this._edgeDrag) {
      const dId = this._edgeDrag.id;
      const ed = this.edgeById(dId);
      const off = this._edgeDrag.off || { x: 0, y: 0 };
      const kind = this._edgeDrag.kind;
      if (ed) {
        const ends = this._edgeEnds(ed);
        const wc = this.toWorld(e.clientX, e.clientY);
        const pos = { x: wc.x - off.x, y: wc.y - off.y };
        if (kind === "levA" || kind === "levB") {
          const isA = kind === "levA";
          const ap = isA ? { x: ends.ax, y: ends.ay } : { x: ends.bx, y: ends.by };
          const lev = { x: pos.x - ap.x, y: pos.y - ap.y };
          if (isA) ed.aLev = lev; else ed.bLev = lev;
          const other = isA ? ed.to : ed.from;
          const snapId = this.snapNodeAt(e.clientX, e.clientY);
          this._edgeDrag.snapTo = snapId && snapId !== other ? snapId : null;
        } else if (kind === "mid") {
          // 中点柄：反解二次贝塞尔控制点 C = 2M - (P0+P1)/2；同时清掉拉杆弧度，避免两套参数打架
          ed.bend = { x: 2 * pos.x - (ends.ax + ends.bx) / 2, y: 2 * pos.y - (ends.ay + ends.by) / 2 };
          delete ed.aLev; delete ed.bLev;
          this._edgeDrag.snapTo = null;
        } else {
          // p0 / p1：移动端点（吸附到附近节点边框）
          const isP0 = kind === "p0";
          const other = isP0 ? ed.to : ed.from;
          let pt = { x: pos.x, y: pos.y };
          const snapId = this.snapNodeAt(e.clientX, e.clientY);
          if (snapId && snapId !== other) {
            const sn = this.nodeById(snapId), ss = this.sizes.get(snapId);
            if (sn && ss) {
              const scx = sn.x + ss.w / 2, scy = sn.y + ss.h / 2;
              pt = this._rectEdgePoint(ss.w, ss.h, scx, scy, wc.x, wc.y);
            }
          }
          if (isP0) { ed.aPt = pt; delete ed.aPtRel; } else { ed.bPt = pt; delete ed.bPtRel; }
          this._edgeDrag.snapTo = snapId && snapId !== other ? snapId : null;
        }
        this._edgeDrag.moved = true;
        this.render();
      }
      return;
    }
    // 白板：手柄拖拽（直线/箭头端点与弯曲 + 通用自由变换）
    if (this._handle) {
      const r = this.rect();
      const dx = (e.clientX - r.left - this._handle.sx) / this.view.scale;
      const dy = (e.clientY - r.top - this._handle.sy) / this.view.scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this._handle.moved = true;
      const n = this.nodeById(this._handle.id);
      const o = this._handle.orig;
      if (n && o) {
        const k = this._handle.kind;
        if (k === "p0") {
          // 拖起点：起点跟随、终点保持不动（w/h 为终点相对起点的增量）
          n.x = o.x + dx; n.y = o.y + dy;
          n.w = o.w - dx; n.h = o.h - dy;
          if (o.bend) n.bend = { x: o.bend.x - dx, y: o.bend.y - dy };
        } else if (k === "p1") {
          n.w = o.w + dx; n.h = o.h + dy;
        } else if (k === "mid") {
          // 拖中点：把拖到的位置设为曲线中点，反解二次贝塞尔控制点 C = 2M - (P0+P1)/2
          const w = this.toWorld(e.clientX, e.clientY);
          n.bend = { x: 2 * (w.x - n.x) - n.w / 2, y: 2 * (w.y - n.y) - n.h / 2 };
        } else if (n.shape === "text") {
          // 文本：从对角等比缩放，字号随之缩放（宽高由字号重新推导）
          const ratio = Math.max(0.15, Math.min(8,
            ((o.w + (k.includes("e") ? dx : -dx)) / o.w + (o.h + (k.includes("s") ? dy : -dy)) / o.h) / 2));
          const fs = Math.max(8, Math.min(128, o.fs * ratio));
          n.fontSize = fs;
          const nw = o.w * (fs / o.fs), nh = o.h * (fs / o.fs);
          n.x = k.includes("e") ? o.x : o.x + o.w - nw;
          n.y = k.includes("s") ? o.y : o.y + o.h - nh;
          n.w = nw; n.h = nh;
        } else {
          // 通用自由变换：四角 / 四边手柄调整 x/y/w/h（设最小尺寸防拖没）
          let x = o.x, y = o.y, w2 = o.w, h2 = o.h;
          if (k.includes("e")) w2 = o.w + dx;
          if (k.includes("w")) { w2 = o.w - dx; x = o.x + dx; }
          if (k.includes("s")) h2 = o.h + dy;
          if (k.includes("n")) { h2 = o.h - dy; y = o.y + dy; }
          const minW = n.shape === "embed" ? 200 : 12, minH = n.shape === "embed" ? 150 : 10;
          if (w2 < minW) { if (k.includes("w")) x = o.x + o.w - minW; w2 = minW; }
          if (h2 < minH) { if (k.includes("n")) y = o.y + o.h - minH; h2 = minH; }
          n.x = x; n.y = y; n.w = w2; n.h = h2;
          // 流程图节点手动调过尺寸后不再自动适配（文本仍按 20 字截断显示）
          if (this.doc.type === "flowchart" && n.shape !== "text") n.manualSize = true;
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
    if (this._connect) {
      this._connect.cx = e.clientX; this._connect.cy = e.clientY;
      const snapId = this.snapNodeAt(e.clientX, e.clientY); // 拖拽中吸附点实时高亮
      if (snapId !== this._connectHover) this._connectHover = snapId;
      this.render(); return;
    }
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
    // 备注徽标：pointerup 时打开备注弹框（任何拖拽分支之前处理）
    if (this._pendingBadge) {
      const id = this._pendingBadge;
      this._pendingBadge = null;
      if (this._onNoteBadge) this._onNoteBadge(id);
      return;
    }
    // 折叠徽标：pointerup 时切换折叠状态
    if (this._pendingCollapse) {
      const cid = this._pendingCollapse;
      this._pendingCollapse = null;
      this.toggleCollapse(cid);
      return;
    }
    if (this._marquee) { this._marquee = null; this.render(); return; } // 选择已在拖拽中实时应用
    if (this._edgeDrag) {
      const d = this._edgeDrag;
      this._edgeDrag = null;
      if (d.moved) {
        const ed = this.edgeById(d.id);
        const isLev = d.kind === "levA" || d.kind === "levB";
        const isPos = d.kind === "p0" || d.kind === "p1";
        if (ed && isLev) {
          // 拉杆收尾：落在第三方节点上 -> 该端点重新吸附到那个节点并复位该侧拉杆；
          // 落在空白 / 原节点 -> 保留弧度
          const isA = d.kind === "levA";
          const otherRef = isA ? ed.to : ed.from;
          const origRef = isA ? ed.from : ed.to;
          const clearLev = () => { if (isA) { delete ed.aLev; delete ed.aPt; delete ed.aPtRel; } else { delete ed.bLev; delete ed.bPt; delete ed.bPtRel; } };
          if (d.snapTo && d.snapTo !== otherRef && d.snapTo !== origRef) {
            const dup = this.doc.edges.some((x) => x !== ed && x.assoc && x.from === (isA ? d.snapTo : ed.from) && x.to === (isA ? ed.to : d.snapTo));
            if (!dup) {
              if (isA) { ed.from = d.snapTo; delete ed.fromPort; } else { ed.to = d.snapTo; delete ed.toPort; }
            }
            clearLev();
          }
        } else if (ed && isPos) {
          // 端点位置柄收尾（关联线原有的 3 点调节之一）：
          // 吸附到第三方节点 -> 重绑 from/to；吸附回原节点 -> 保留边框相对锚点；落空白 -> 固定端点
          const isP0 = d.kind === "p0";
          const otherRef = isP0 ? ed.to : ed.from;
          const origRef = isP0 ? ed.from : ed.to;
          const dropPt = isP0 ? ed.aPt : ed.bPt;
          const anchorRel = (nid) => {
            const nn = this.nodeById(nid);
            if (!nn || !dropPt) return false;
            const rel = { dx: dropPt.x - nn.x, dy: dropPt.y - nn.y };
            if (isP0) { ed.aPtRel = rel; delete ed.aPt; } else { ed.bPtRel = rel; delete ed.bPt; }
            return true;
          };
          const resetAuto = () => {
            if (isP0) { delete ed.aPt; delete ed.aPtRel; } else { delete ed.bPt; delete ed.bPtRel; }
          };
          if (d.snapTo && d.snapTo !== otherRef) {
            if (d.snapTo === origRef) {
              anchorRel(origRef); // 同节点上换个接出位置
            } else {
              const dup = this.doc.edges.some((x) => x !== ed && x.assoc && x.from === (isP0 ? d.snapTo : ed.from) && x.to === (isP0 ? ed.to : d.snapTo));
              if (!dup) {
                if (isP0) { ed.from = d.snapTo; delete ed.fromPort; } else { ed.to = d.snapTo; delete ed.toPort; }
                anchorRel(d.snapTo);
              } else {
                resetAuto();
              }
            }
          } else if (d.snapTo === otherRef) {
            resetAuto(); // 吸附到对端节点无效，回退自动吸附
          } else if (!d.snapTo) {
            if (isP0) delete ed.aPtRel; else delete ed.bPtRel; // 落空白：保留世界坐标固定端点
          }
        }
        this.render(); this.onChange(); this.pushHistory();
      }
      return;
    }
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
      let to = hitEl ? hitEl.getAttribute("data-id") : null;
      if (!to || to === this._connect.from) to = this.snapNodeAt(e.clientX, e.clientY); // 松开时自动吸附附近节点
      if (to && to !== this._connect.from) {
        // 落点若正好在目标节点的端口上，连线固定接该端口（四向吸附）
        const toPortEl = e.target.closest && e.target.closest(".gm-port");
        const toPort = toPortEl ? toPortEl.getAttribute("data-port") : null;
        if (this._connect.assoc) this.addAssocEdge(this._connect.from, to);
        else this.addEdge(this._connect.from, to, null, this._connect.fromPort || null, toPort);
        this.onChange();
        this.pushHistory();
        this.setTool("select"); // 关联完成自动切回默认选择工具
      }
      this._connect = null; this._connectHover = null; this.render(); return;
    }
    if (this._drag) {
      const moved = this._drag.moved;
      if (moved) { this.onChange(); this.pushHistory(); }
      this._drag = null;
      // 单击图片（未拖动）-> 放大查看；拖动则正常移动节点
      if (!moved && this._pendingImgZoom) {
        const src = this._pendingImgZoom; this._pendingImgZoom = null;
        if (this.onImageZoom) this.onImageZoom(src);
      }
      return;
    }
    if (this._pan) { this._pan = null; return; }
  }

  // 刚发生右键双击（450ms 内）：contextmenu 不弹菜单（双击用于切换抓手工具）
  rmbDoubleJustNow() { return Date.now() - this._rmbDblAt < 450; }

  // 平移拖拽态兜底清理（窗口失焦等收不到 pointerup 的场景）：立刻还原光标与拖拽态
  _rmbCancel() {
    if (!this._pan) return;
    this._pan = null;
    this.svg.classList.remove("panning");
  }

  // 切换节点折叠状态（脑图）：设置开启时收起/展开后自动重排布局，否则只切换显隐（保留拖动位置）
  toggleCollapse(id) {
    const n = this.nodeById(id);
    if (!n || !this.doc.nodes.some((c) => c.parentId === n.id)) return;
    n.collapsed = !n.collapsed;
    if (this.autoAdjust) adaptMindmap(this.doc, id);
    else if (this.autoRelayout) layoutMindmap(this.doc);
    this.render(); this.onChange(); this.pushHistory();
  }

  // 折叠隐藏的节点集合：所有「已折叠节点的后代」
  hiddenNodes() {
    if (this.doc.type !== "mindmap") return new Set();
    const out = new Set();
    const cm = this.childrenMap();
    const stack = this.doc.nodes.filter((n) => n.collapsed && (cm.get(n.id) || []).length).map((n) => n.id);
    while (stack.length) {
      const id = stack.pop();
      // cm 的值是 id 字符串数组（非节点对象），直接收集 id
      for (const c of cm.get(id) || []) if (!out.has(c)) { out.add(c); stack.push(c); }
    }
    return out;
  }

  onDblClick(e) {
    if (this.readOnly) return;
    // 双击连线：弹出连线编辑弹框（替代原生 prompt）；派生连线（脑图父子）label 存于子节点
    const edgeEl = e.target.closest && e.target.closest("[data-edge]");
    if (edgeEl) {
      const eid = edgeEl.getAttribute("data-edge");
      const ed = this.edgeById(eid);
      if (ed) { if (this._onEdgeEdit) this._onEdgeEdit(ed.id); }
      else {
        const childId = eid.startsWith("p-") ? eid.slice(2) : null;
        if (childId && this._onEdgeEdit) this._onEdgeEdit(null, childId);
      }
      return;
    }
    // 分组（外框 / 概括）编辑由 onDown 的手动双击检测处理（原生 dblclick 会因重渲染丢事件）
    const hitEl = e.target.closest && e.target.closest("[data-id]");
    let hitId = hitEl ? hitEl.getAttribute("data-id") : null;
    if (!hitId) {
      // 文字 / 透明背景节点无背景矩形，SVG 命中只认字形——双击节点空白区按包围盒兜底（三模式通用），
      // 避免双击命中失败后走到空白分支（脑图会误建子节点、编辑框开在别处）
      const w = this.toWorld(e.clientX, e.clientY);
      for (let i = this.doc.nodes.length - 1; i >= 0; i--) {
        const nd = this.doc.nodes[i];
        if (nd.shape === "arrow" || nd.shape === "line" || nd.shape === "embed") continue;
        const bb = this.nodeBBox(nd);
        if (w.x >= bb.x && w.x <= bb.x + bb.w && w.y >= bb.y && w.y <= bb.y + bb.h) { hitId = nd.id; break; }
      }
    }
    if (!hitId) {
      // 设置：双击空白处创建子节点（脑图，挂在中心主题下）
      if (this.mode === "mindmap" && this.dblClickCreate) {
        const root = this.doc.nodes.find((n) => n.parentId == null);
        if (root) this.addMindmapChild(root.id);
      }
      return;
    }
    const n = this.nodeById(hitId);
    if (!n) return;
    if (n.shape === "embed") {
      const url = prompt("输入要嵌入的网页地址", n.url || "https://");
      if (url && url !== n.url) { n.url = url.trim(); this.render(); this.onChange(); this.pushHistory(); }
      return;
    }
    this.beginTextEdit(n.id);
  }

  getMovable(set) {
    if (this.mode !== "mindmap") {
      // 白板：组合联动——选中任一成员时整组一起动（锁定节点除外）
      const out = new Set(set);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of this.doc.nodes) {
          if (n.locked || !n.group || out.has(n.id)) continue;
          for (const id of out) {
            const m = this.nodeById(id);
            if (m && m.group === n.group) { out.add(n.id); changed = true; break; }
          }
        }
      }
      return out;
    }
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
  addEdge(from, to, label, fromPort, toPort) {
    if (from === to) return;
    if (this.doc.edges.some((e) => e.from === from && e.to === to)) return;
    const e = { id: newId(), from, to, label: label || "", arrow: true };
    // 从端口拖出的连线固定接在该端口上（四向吸附）
    if (fromPort) e.fromPort = fromPort;
    if (toPort) e.toPort = toPort;
    this.doc.edges.push(e);
  }

  // 脑图关联线：任意两节点之间的自由连线（虚线曲线，随节点删除自动清理）
  addAssocEdge(from, to, label) {
    if (from === to) return;
    if (this.doc.edges.some((e) => e.assoc && e.from === from && e.to === to)) return;
    this.doc.edges.push({ id: newId(), from, to, label: label || "", assoc: true });
  }

  // ---------- 按 id 精确更新单个节点（备注等独立属性，不受当前选择影响）----------
  updateNodeById(id, patch) {
    const n = this.nodeById(id);
    if (!n) return;
    for (const k of Object.keys(patch)) {
      if (patch[k] === null) delete n[k];
      else n[k] = patch[k];
    }
    // 只改属性不重排（备注/超链接等不影响结构），保留拖动位置
    this.render(); this.onChange(); this.pushHistory();
  }

  // ---------- 分组（外框 / 概括）：框选多个子节点 ----------
  groupById(id) { return (this.doc.groups || []).find((g) => g.id === id); }
  addGroup(kind, ids, opts = {}) {
    if (!this.doc.groups) this.doc.groups = [];
    const g = {
      id: newId(), kind,
      ids: [...new Set(ids)],
      text: opts.text != null ? opts.text : (kind === "summary" ? "概要" : ""),
      stroke: opts.stroke || (kind === "summary" ? "#f5a623" : "#aab3bf"),
    };
    this.doc.groups.push(g);
    this.render(); this.onChange(); this.pushHistory();
    return g;
  }
  updateGroup(id, patch) {
    const g = this.groupById(id); if (!g) return;
    for (const k of Object.keys(patch)) { if (patch[k] === null) delete g[k]; else g[k] = patch[k]; }
    this.render(); this.onChange(); this.pushHistory();
  }
  removeGroup(id) {
    if (!this.doc.groups) return;
    this.doc.groups = this.doc.groups.filter((g) => g.id !== id);
    this.render(); this.onChange(); this.pushHistory();
  }

  // 新增子节点：就地放在父节点侧边（不重排整图，保留用户拖动位置）
  addMindmapChild(parentId) {
    const parent = this.nodeById(parentId); if (!parent) return null;
    if (parent.collapsed) parent.collapsed = false; // 折叠节点先展开再添加子节点
    const id = newId();
    const ps = this.sizes.get(parent.id) || sizeOf(parent, "mindmap");
    const H_GAP = 56, V_GAP = 14;
    // 已有子节点：接在最后一个子节点下方；没有子节点：与父节点同高
    const kids = this.doc.nodes.filter((n) => n.parentId === parent.id);
    let x, y;
    if (kids.length) {
      const last = kids[kids.length - 1];
      const ls = this.sizes.get(last.id) || sizeOf(last, "mindmap");
      x = last.x; y = last.y + ls.h + V_GAP;
    } else {
      const side = parent.side === "left" ? "left" : "right";
      x = side === "left" ? parent.x - 124 - H_GAP : parent.x + ps.w + H_GAP;
      y = parent.y;
    }
    const node = { id, x, y, w: 124, h: 44, text: "新节点", shape: "rounded", color: "#fff", textColor: "#1f2a37", stroke: parent.stroke || "#11b5a4", fontSize: 15, parentId, collapsed: false };
    // 位置自适应：与已有节点重叠时向下（其次向上）寻找空位，保证新节点不遮挡任何节点
    const ns0 = sizeOf(node, "mindmap");
    const spot = this._freeSpotFor(x, y, ns0.w, ns0.h);
    node.x = spot.x; node.y = spot.y;
    this.doc.nodes.push(node);
    // 外框 / 概括：往被框住的节点里加子节点时，新节点自动纳入分组范围（范围随内容自动扩展）
    if (this.doc.groups && this.doc.groups.length) {
      for (const g of this.doc.groups) if (Array.isArray(g.ids) && g.ids.includes(parentId)) g.ids.push(id);
    }
    if (this.autoAdjust) adaptMindmap(this.doc, parentId); // 设置开启：新增后局部自适应
    else if (this.autoRelayout) layoutMindmap(this.doc); // 设置开启：新增后自动重排
    this.selection = new Set([id]);
    this.render(); this.onChange();
    this.pushHistory();
    if (this.autoEditNewNode) this.beginTextEdit(id);
    return id;
  }
  // 新增同级节点：插入到当前节点之后（顺序与位置都在旁边，不重排整图）
  addMindmapSibling(nodeId) {
    const node = this.nodeById(nodeId); if (!node || node.parentId == null) return this.addMindmapChild(nodeId);
    const pNode = this.nodeById(node.parentId);
    const id = newId();
    const ns = this.sizes.get(node.id) || sizeOf(node, "mindmap");
    const V_GAP = 14;
    const newNode = { id, x: node.x, y: node.y + ns.h + V_GAP, w: 124, h: 44, text: "新节点", shape: "rounded", color: "#fff", textColor: "#1f2a37", stroke: pNode ? pNode.stroke : "#11b5a4", fontSize: 15, parentId: node.parentId, collapsed: false };
    // 1) 插到当前节点之后：同级顺序直接决定「整理布局」时的上下次序
    const idx = this.doc.nodes.findIndex((n) => n.id === nodeId);
    if (idx >= 0) this.doc.nodes.splice(idx + 1, 0, newNode);
    else this.doc.nodes.push(newNode);
    // 2) 其后的同级节点（含子树）整体下移，给新节点腾出空间；其余节点位置不动
    const shift = (sizeOf(newNode, "mindmap").h || 40) + V_GAP;
    const siblings = this.doc.nodes.filter((n) => n.parentId === node.parentId);
    const at = siblings.findIndex((n) => n.id === id);
    const below = new Set();
    for (const s of siblings.slice(at + 1)) { below.add(s.id); this.descendants(s.id, below); }
    if (below.size) for (const n of this.doc.nodes) if (below.has(n.id)) n.y += shift;
    // 位置自适应：仍与其它节点重叠时再找空位（不搬动已有节点）
    const nsNew = sizeOf(newNode, "mindmap");
    const spot = this._freeSpotFor(newNode.x, newNode.y, nsNew.w, nsNew.h, new Set([id]));
    newNode.x = spot.x; newNode.y = spot.y;
    // 外框 / 概括：当前节点在分组内时，同级新节点同样纳入，范围实时自适应
    if (this.doc.groups && this.doc.groups.length) {
      for (const g of this.doc.groups) if (Array.isArray(g.ids) && g.ids.includes(nodeId)) g.ids.push(id);
    }
    if (this.autoAdjust) adaptMindmap(this.doc, node.parentId); // 设置开启：新增后局部自适应
    else if (this.autoRelayout) layoutMindmap(this.doc); // 设置开启：新增后自动重排
    this.selection = new Set([id]);
    this.render(); this.onChange();
    this.pushHistory();
    if (this.autoEditNewNode) this.beginTextEdit(id);
    return id;
  }
  async deleteSelection() {
    // 选择集键类型："e:" 连线 / "g:" 分组（外框、概括）/ 其余为节点
    const edgeIds = [];
    const nodeIds = [];
    const groupIds = [];
    for (const k of this.selection) {
      if (k.startsWith && k.startsWith("e:")) edgeIds.push(k.slice(2));
      else if (k.startsWith && k.startsWith("g:")) groupIds.push(k.slice(2));
      else nodeIds.push(k);
    }
    if (!edgeIds.length && !nodeIds.length && !groupIds.length) return;
    // 含图片的节点：删除前二次提醒（必须在真正删除之前判定，否则节点已被移除会导致漏判）
    const hasImage = nodeIds.some((id) => { const n = this.nodeById(id); return n && (n.image || (n.shape === "image" && n.src)); });
    if (hasImage) {
      const ok = this.onConfirmImageDelete ? await this.onConfirmImageDelete() : true;
      if (!ok) return;
    }
    let changed = false;
    if (groupIds.length) {
      this.doc.groups = (this.doc.groups || []).filter((g) => !groupIds.includes(g.id));
      changed = true;
    }
    if (edgeIds.length) {
      const del = new Set(edgeIds);
      this.doc.edges = this.doc.edges.filter((e) => !del.has(e.id));
      changed = true;
    }
    if (nodeIds.length) {
      // 锁定节点不可删除
      const ids = nodeIds.filter((id) => { const n = this.nodeById(id); return n && !n.locked; });
      if (ids.length) {
        const toDelete = this.getMovable(new Set(ids));
        // 删除前先收集受影响的「留存祖先」：删除子树后需要重新收敛的分支根
        const focusSet = new Set();
        for (const id of toDelete) {
          const n = this.nodeById(id);
          if (!n) continue;
          let pid = n.parentId;
          while (pid != null) {
            const p = this.nodeById(pid);
            if (!p) break;
            if (toDelete.has(pid)) { pid = p.parentId; continue; }
            focusSet.add(pid);
            break;
          }
        }
        this.doc.nodes = this.doc.nodes.filter((n) => !toDelete.has(n.id));
        this.doc.edges = this.doc.edges.filter((e) => !toDelete.has(e.from) && !toDelete.has(e.to));
        changed = true;
        // 设置开启：脑图删除节点后自动收敛（局部自适应，不覆盖无关节点）
        if (this.doc.type === "mindmap") {
          if (this.autoAdjust) { for (const f of focusSet) adaptMindmap(this.doc, f); }
          else if (this.autoRelayout) layoutMindmap(this.doc);
        }
      }
    }
    if (!changed) return;
    this.selection.clear();
    this.render(); this.onChange();
    this.pushHistory();
  }

  // 复制选中元素（含组内成员与连线）为新副本，右下偏移 24
  duplicateSelection() {
    const sel = new Set(this.selection);
    const nodes = this.doc.nodes.filter((n) => sel.has(n.id) && !n.locked);
    if (!nodes.length) return;
    const movable = this.getMovable(new Set(nodes.map((n) => n.id)));
    const all = this.doc.nodes.filter((n) => movable.has(n.id));
    const idMap = new Map();
    const clones = all.map((n) => {
      const c = JSON.parse(JSON.stringify(n));
      c.id = newId();
      c.x += 24; c.y += 24;
      c.group = null;
      idMap.set(n.id, c.id);
      return c;
    });
    const edges = this.doc.edges
      .filter((e) => idMap.has(e.from) && idMap.has(e.to))
      .map((e) => ({ ...e, id: newId(), from: idMap.get(e.from), to: idMap.get(e.to) }));
    this.doc.nodes.push(...clones);
    this.doc.edges.push(...edges);
    this.selection = new Set(clones.map((n) => n.id));
    this.render(); this.onChange(); this.pushHistory();
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
    this._linkHover = null;
    // 光标策略：形状工具全画布十字星；画笔/文字/橡皮用工具栏同款图标光标
    const SHAPE_TOOLS = ["frame", "rect", "diamond", "ellipse", "arrow", "line", "rounded", "parallelogram"];
    this.svg.classList.toggle("cur-cross", SHAPE_TOOLS.includes(tool) || tool === "laser");
    this.svg.classList.toggle("cur-tool", !!TOOL_CURSORS[tool]);
    if (tool === "select") this.container.style.cursor = "default";
    else if (tool === "hand") this.container.style.cursor = "grab";
    else if (TOOL_CURSORS[tool]) this.container.style.cursor = TOOL_CURSORS[tool];
    else this.container.style.cursor = "crosshair";
    if (tool !== "laser") this._laser = null;
    if (this._onToolChange) this._onToolChange(tool); // 通知工具栏刷新高亮
  }

  // ---------- 白板属性面板 ----------
  // 应用属性：写入默认 wbProps（影响后续新建图形），并同步到当前选中的节点
  // 脑图节点样式：批量应用到所有选中节点（字段透传到节点，布局重算后渲染）
  setNodeStyle(patch) {
    const sel = [...this.selection].filter((k) => !(k.startsWith && k.startsWith("e:")));
    if (!sel.length) return;
    for (const id of sel) {
      const n = this.nodeById(id);
      if (!n) continue;
      for (const k of Object.keys(patch)) {
        if (patch[k] === null) delete n[k]; // null = 移除该属性（备注/超链接/图片/图标）
        else n[k] = patch[k];
      }
    }
    // 改样式后不重排：节点尺寸变了也保留用户摆放的位置（需要整齐时手动点整理布局）
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
      if (n.locked) continue; // 锁定节点不参与框选
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
    // 命中节点：包围盒外扩容差（锁定节点不可擦除）
    const nodeHit = (n) => {
      if (n.locked) return false;
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
