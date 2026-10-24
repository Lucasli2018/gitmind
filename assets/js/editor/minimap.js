// 小地图：画布右下角缩略导航（参考 XMind）
// - 缩略显示全部节点（矩形）与视口框
// - 点击 / 拖拽小地图 -> 视图中心跳到对应世界坐标
// - 可关闭，关闭后留一个小按钮随时唤回
const MM_W = 208, MM_H = 136, PAD = 10;

export function initMinimap(editor) {
  const host = editor.container;
  const box = document.createElement("div");
  box.className = "gm-minimap";
  box.innerHTML =
    `<div class="gm-mm-view"><svg id="gmMmSvg"></svg>` +
    `<button class="gm-mm-close" title="关闭小地图">×</button></div>` +
    `<button class="gm-mm-open" title="打开小地图">🗺</button>`;
  host.appendChild(box);
  const view = box.querySelector(".gm-mm-view");
  const svg = box.querySelector("#gmMmSvg");
  const closeBtn = box.querySelector(".gm-mm-close");
  const openBtn = box.querySelector(".gm-mm-open");

  let collapsed = false;
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = true;
    box.classList.add("collapsed");
  });
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = false;
    box.classList.remove("collapsed");
    refresh(true);
  });

  // 点击 / 拖拽小地图：把视口中心移到对应世界坐标
  let dragging = false;
  const jumpTo = (ev) => {
    const r = svg.getBoundingClientRect();
    const st = svg._mm; // 最近一次 refresh 缓存的世界->小地图变换
    if (!st) return;
    const wx = st.bx + (ev.clientX - r.left) / st.k;
    const wy = st.by + (ev.clientY - r.top) / st.k;
    const cr = editor.rect();
    editor.view.x = cr.width / 2 - wx * editor.view.scale;
    editor.view.y = cr.height / 2 - wy * editor.view.scale;
    editor.render();
  };
  svg.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); e.preventDefault();
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    jumpTo(e);
  });
  svg.addEventListener("pointermove", (e) => { if (dragging) { e.stopPropagation(); jumpTo(e); } });
  svg.addEventListener("pointerup", (e) => { dragging = false; e.stopPropagation(); });
  svg.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

  // 世界坐标 -> 小地图坐标的变换缓存（jumpTo 用）
  let raf = 0;
  function refresh(force) {
    if (collapsed && !force) return;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function draw() {
    const hidden = editor.hiddenNodes();
    const nodes = editor.doc.nodes.filter((n) => !hidden.has(n.id));
    if (!nodes.length) { box.style.display = "none"; return; }
    box.style.display = "";
    // 内容包围盒（含画笔轨迹）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const b = editor.nodeBBox(n);
      if (!b || !Number.isFinite(b.x + b.y + b.w + b.h)) continue;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    if (!Number.isFinite(minX)) { box.style.display = "none"; return; }
    const k = Math.min((MM_W - PAD * 2) / Math.max(1, maxX - minX), (MM_H - PAD * 2) / Math.max(1, maxY - minY), 1);
    const bx = (minX + maxX) / 2 - (MM_W / 2) / k; // 小地图左上角对应的世界坐标
    const by = (minY + maxY) / 2 - (MM_H / 2) / k;
    svg._mm = { k, bx, by };
    const X = (x) => ((x - bx) * k).toFixed(1), Y = (y) => ((y - by) * k).toFixed(1);

    // 连线（脑图派生线 + 关联线）
    let edges = "";
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const line = (a, b, color) => {
      if (!a || !b) return "";
      return `<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="${color || "#c3ccd6"}" stroke-width="1"/>`;
    };
    if (editor.doc.type === "mindmap") {
      for (const n of nodes) if (n.parentId) edges += line(byId.get(n.parentId), n);
    } else {
      for (const e of editor.doc.edges) edges += line(byId.get(e.from), byId.get(e.to));
    }
    // 节点矩形
    let rects = "";
    for (const n of nodes) {
      const b = editor.nodeBBox(n);
      if (!b || !Number.isFinite(b.x + b.y + b.w + b.h)) continue;
      const sel = editor.selection.has(n.id);
      const fill = n.color && n.color !== "transparent" ? n.color : "#ffffff";
      rects += `<rect x="${X(b.x)}" y="${Y(b.y)}" width="${Math.max(2, b.w * k).toFixed(1)}" height="${Math.max(2, b.h * k).toFixed(1)}" ` +
        `rx="2" fill="${fill}" stroke="${sel ? "#2f80ed" : n.stroke || "#b7c1cc"}" stroke-width="${sel ? 1.5 : 0.8}"/>`;
    }
    // 视口框
    const cr = editor.rect();
    const vx = -editor.view.x / editor.view.scale, vy = -editor.view.y / editor.view.scale;
    const vw = cr.width / editor.view.scale, vh = cr.height / editor.view.scale;
    const viewport = `<rect x="${X(vx)}" y="${Y(vy)}" width="${(vw * k).toFixed(1)}" height="${(vh * k).toFixed(1)}" ` +
      `fill="rgba(47,128,237,0.08)" stroke="#2f80ed" stroke-width="1.2" rx="2"/>`;
    svg.setAttribute("width", MM_W);
    svg.setAttribute("height", MM_H);
    svg.setAttribute("viewBox", `0 0 ${MM_W} ${MM_H}`);
    svg.innerHTML = edges + rects + viewport;
  }

  return { refresh };
}
