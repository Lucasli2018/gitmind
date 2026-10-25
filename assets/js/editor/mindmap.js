// 思维导图：多结构自动布局（参考 simple-mind-map 的布局思路自研）
// 支持：mindmap(经典双侧平衡) / logicRight(向右逻辑) / logicLeft(向左逻辑)
//       list(目录组织图，向右缩进) / structure(组织结构图，向下)
// 布局时为每个非根节点标注 side(left/right/down)，供 canvas 连线渲染使用
import { sizeOf } from "./model.js";

const V_GAP = 16; // 同级节点垂直间距
const H_GAP = 56; // 层级间最小水平间距（基准）

// 折叠隐藏集合：支持「只折叠某一侧」（collapsedL / collapsedR，根节点左右各一个徽标），
// 老数据没有分侧标记时按整体 collapsed 处理。
// kidsAll：parentId -> 子节点对象数组
function collectHidden(nodes, kidsAll) {
  const hidden = new Set();
  const stack = [];
  const add = (id) => { if (!hidden.has(id)) { hidden.add(id); stack.push(id); } };
  for (const n of nodes) {
    const kids = kidsAll.get(n.id) || [];
    if (!kids.length) continue;
    const sideFiltered = n.collapsedL != null || n.collapsedR != null;
    for (const k of kids) {
      const s = k.side === "left" ? "left" : k.side === "down" ? "down" : "right";
      const fold = sideFiltered
        ? (s === "left" ? !!n.collapsedL : s === "right" ? !!n.collapsedR : !!n.collapsed)
        : !!n.collapsed;
      if (fold) add(k.id);
    }
  }
  while (stack.length) {
    const id = stack.pop();
    for (const c of kidsAll.get(id) || []) add(c.id);
  }
  return hidden;
}

export function layoutMindmap(doc, layout) {
  const nodes = doc.nodes || [];
  if (!nodes.length) return;
  layout = layout || doc.layout || "mindmap";
  doc.layout = layout;

  // 坐标防护：undefined/NaN 坐标（旧数据、导入异常）先归零，避免布局结果 NaN 导致整图消失
  for (const n of nodes) {
    if (!Number.isFinite(n.x)) n.x = 0;
    if (!Number.isFinite(n.y)) n.y = 0;
  }

  const childrenMap = new Map();
  const roots = [];
  const idSet = new Set(nodes.map((n) => n.id));
  // 折叠感知：被折叠节点的整个子树视为隐藏，布局时按叶子处理
  const kidsAll = new Map();
  for (const n of nodes) if (n.parentId != null) { if (!kidsAll.has(n.parentId)) kidsAll.set(n.parentId, []); kidsAll.get(n.parentId).push(n); }
  const hidden = collectHidden(nodes, kidsAll);
  for (const n of nodes) {
    if (hidden.has(n.id)) continue;
    // parentId 为空或父节点不存在（孤儿节点）都按根处理，否则孤儿永不参与布局、坐标失控
    if (n.parentId == null || !idSet.has(n.parentId)) { n.parentId = null; roots.push(n); }
    else { if (!childrenMap.has(n.parentId)) childrenMap.set(n.parentId, []); childrenMap.get(n.parentId).push(n); }
  }
  if (!roots.length) return;

  // 稳定化基准：重排前根节点位置（布局结束后整体平移对齐，避免加节点/改样式时导图整体跳动）
  const anchorRoot = roots[0];
  const ax0 = anchorRoot.x, ay0 = anchorRoot.y;

  const getH = (n) => sizeOf(n, "mindmap").h;
  const getW = (n) => sizeOf(n, "mindmap").w;

  // 子树占用高度 / 宽度（含所有后代）
  function subH(node) {
    const kids = childrenMap.get(node.id) || [];
    if (!kids.length) return getH(node);
    let s = 0;
    for (const k of kids) s += subH(k) + V_GAP;
    return Math.max(getH(node), s - V_GAP);
  }
  function subW(node) {
    const kids = childrenMap.get(node.id) || [];
    if (!kids.length) return getW(node);
    let s = 0;
    for (const k of kids) s += subW(k) + H_GAP;
    return Math.max(getW(node), s - H_GAP);
  }
  // 一组兄弟的总高度
  function groupHeight(list) {
    let c = 0;
    for (const k of list) c += subH(k) + V_GAP;
    return list.length ? c - V_GAP : 0;
  }

  // 向外范式：垂直放置（根或给定列表），返回占用高度，父居中于子树
  function placeY(node, top, kids) {
    const list = kids || (childrenMap.get(node.id) || []);
    const h = getH(node);
    if (!list.length) { node.y = top; return h; }
    let cursor = top;
    for (const k of list) {
      const kh = placeY(k, cursor, childrenMap.get(k.id));
      cursor += kh + V_GAP;
    }
    const total = cursor - V_GAP - top;
    const first = list[0], last = list[list.length - 1];
    node.y = (first.y + (last.y + getH(last))) / 2 - h / 2;
    return total;
  }
  // 向外范式：水平放置，dir=+1 向右 / -1 向左，标注 side
  function placeX(node, x, dir, kids) {
    node.x = x;
    const list = kids || (childrenMap.get(node.id) || []);
    const step = getW(node) + H_GAP;
    for (const k of list) {
      k.side = dir > 0 ? "right" : "left";
      placeX(k, dir > 0 ? x + step : x - getW(k) - H_GAP, dir, childrenMap.get(k.id));
    }
  }
  // 把一组兄弟（及其后代）从 top 起垂直堆叠，返回占用高度（不设父 y）
  function stackY(list, top) {
    let cursor = top;
    for (const k of list) {
      const kh = placeY(k, cursor, childrenMap.get(k.id));
      cursor += kh + V_GAP;
    }
    return list.length ? cursor - V_GAP - top : 0;
  }
  // 向下范式：y 沿层级向下
  function placeDownY(node, top, kids) {
    const list = kids || (childrenMap.get(node.id) || []);
    node.y = top;
    const step = getH(node) + V_GAP;
    for (const k of list) placeDownY(k, top + step, childrenMap.get(k.id));
  }
  // 向下范式：x 兄弟并排，父居中于子树
  function placeDownX(node, left, kids) {
    const list = kids || (childrenMap.get(node.id) || []);
    node.x = left;
    if (!list.length) return;
    let cursor = left;
    for (const k of list) { placeDownX(k, cursor, childrenMap.get(k.id)); cursor += subW(k) + H_GAP; }
    const first = list[0].x;
    const last = list[list.length - 1];
    node.x = (first + (last.x + subW(last))) / 2 - getW(node) / 2;
  }

  for (const root of roots) {
    root.side = "root";
    const baseX = root.x || 0, baseY = root.y || 0;

    if (layout === "structure") {
      // 组织结构图：根在上，子向下展开
      placeDownY(root, baseY);
      placeDownX(root, baseX);

    } else if (layout === "logicLeft") {
      // 向左逻辑图：子树整体向左
      placeX(root, baseX, -1);
      placeY(root, baseY);

    } else if (layout === "elbow") {
      // 直角导图：尊重节点 side（left/right），无 side 默认右侧（向后兼容旧数据）；
      // 根节点左右两侧都能挂载分支，拖到左侧的节点自动归 left 并吸附到左边
      const direct = childrenMap.get(root.id) || [];
      const leftG = direct.filter((k) => k.side === "left");
      const rightG = direct.filter((k) => k.side !== "left");
      const rh0 = groupHeight(rightG), lh0 = groupHeight(leftG);
      root.y = Math.max(rh0, lh0) / 2 - getH(root) / 2;
      if (rightG.length) { placeX(root, baseX, +1, rightG); stackY(rightG, root.y + getH(root) / 2 - rh0 / 2); }
      if (leftG.length) { placeX(root, baseX, -1, leftG); stackY(leftG, root.y + getH(root) / 2 - lh0 / 2); }

    } else if (layout === "mindmap") {
      // 经典双侧平衡：直接孩子按子树高度贪心分到左右
      const direct = childrenMap.get(root.id) || [];
      const sorted = [...direct].sort((a, b) => subH(b) - subH(a));
      const leftG = [], rightG = [];
      let lh = 0, rh = 0;
      for (const k of sorted) {
        if (lh <= rh) { leftG.push(k); lh += subH(k) + V_GAP; }
        else { rightG.push(k); rh += subH(k) + V_GAP; }
      }
      const rh0 = Math.max(0, rh - V_GAP), lh0 = Math.max(0, lh - V_GAP);
      root.y = Math.max(rh0, lh0) / 2 - getH(root) / 2;
      if (rightG.length) {
        placeX(root, baseX, +1, rightG);
        stackY(rightG, root.y + getH(root) / 2 - rh0 / 2);
      }
      if (leftG.length) {
        placeX(root, baseX, -1, leftG);
        stackY(leftG, root.y + getH(root) / 2 - lh0 / 2);
      }

    } else {
      // logicRight / list：全部向右（list 仅连线改折线，布局相同）
      placeX(root, baseX, +1);
      placeY(root, baseY);
    }
  }

  // 折叠节点的隐藏子树：不参与主布局（折叠后不应占用空间），但每次重排都要贴着父节点重新安放。
  // 否则这些节点坐标会一直停在上一次的位置，而末尾的整体平移又会反复叠加，
  // 导致包围盒一轮比一轮大、点整理布局后视图越缩越小（历史 bug）
  function placeHidden(parent, dir, onlyKids) {
    const kids = onlyKids || kidsAll.get(parent.id) || [];
    const step = getW(parent) + H_GAP;
    let cursor = parent.y;
    for (const k of kids) {
      k.side = dir > 0 ? "right" : "left";
      k.x = dir > 0 ? parent.x + step : parent.x - getW(k) - H_GAP;
      k.y = cursor;
      cursor += getH(k) + V_GAP;
      placeHidden(k, dir);
    }
  }
  for (const n of nodes) {
    const allKids = kidsAll.get(n.id) || [];
    if (!allKids.length) continue;
    const sideFiltered = n.collapsedL != null || n.collapsedR != null;
    if (!sideFiltered) {
      if (n.collapsed) placeHidden(n, n.side === "left" ? -1 : +1);
      continue;
    }
    // 分侧折叠：只把该侧被收起的子树贴着父节点安放
    if (n.collapsedL) placeHidden(n, -1, allKids.filter((k) => k.side === "left"));
    if (n.collapsedR) placeHidden(n, +1, allKids.filter((k) => k.side !== "left"));
  }

  // 稳定化：重排后整体平移，使根节点位置与重排前一致（修复工具栏操作导致导图位置改变）
  const dx = Math.round(ax0 - anchorRoot.x), dy = Math.round(ay0 - anchorRoot.y);
  if (dx || dy) for (const n of nodes) { n.x += dx; n.y += dy; }
}

// 节点自适应（局部重排）：结构变化（收起 / 展开 / 新增 / 删除）后，只重排受影响的分支，
// 回收 / 补位空隙，并沿祖先链推开重叠的兄弟子树、让父节点在子节点间重新居中，
// 做到「节点不遮挡、视觉平衡」，但绝不覆盖无关节点（含手动摆放）的位置——
// 与 layoutMindmap（整图重新布局，会改动所有节点）不同。
// focusId：发生结构变化的根节点（其可见子树被重排）；缺省则对整个可见树做局部收敛。
// sideHint：本次结构变化发生在哪一侧（left/right）。双侧脑图（根节点左右都有分支）时，
// 只重排该侧并以父节点为轴垂直居中，对侧分支保持原样 —— 否则收起左侧会连右侧一起搬动。
// anchorId：拖放落点结算用。传入被拖节点 id 时，该节点保持落点纵向位置（横向吸附到该侧
// 分支列），只把下方兄弟整体向下让开；上方兄弟与父节点都不动（拖动的位置由用户决定）。
export function adaptMindmap(doc, focusId, sideHint, anchorId) {
  const nodes = doc.nodes || [];
  if (!nodes.length) return;
  // 坐标防护：旧数据 / 导入异常导致的 NaN 先归零，避免计算扩散成 NaN
  for (const n of nodes) { if (!Number.isFinite(n.x)) n.x = 0; if (!Number.isFinite(n.y)) n.y = 0; }
  const layout = doc.layout || "mindmap";

  // 折叠隐藏集合（已折叠节点的整棵后代子树，支持分侧折叠）
  const kidsAll = new Map();
  for (const n of nodes) if (n.parentId != null) { if (!kidsAll.has(n.parentId)) kidsAll.set(n.parentId, []); kidsAll.get(n.parentId).push(n); }
  const hidden = collectHidden(nodes, kidsAll);

  const idSet = new Set(nodes.map((n) => n.id));
  const nodeById = (id) => nodes.find((n) => n.id === id);
  // 可见子节点映射（跳过隐藏节点及其根）
  const cm = new Map();
  for (const n of nodes) {
    if (hidden.has(n.id)) continue;
    if (n.parentId != null && idSet.has(n.parentId) && !hidden.has(n.parentId)) {
      if (!cm.has(n.parentId)) cm.set(n.parentId, []);
      cm.get(n.parentId).push(n);
    }
  }

  const getH = (n) => sizeOf(n, "mindmap").h;
  const getW = (n) => sizeOf(n, "mindmap").w;
  // 子树占用高度（含后代）
  const subH = (node) => {
    const kids = cm.get(node.id) || [];
    if (!kids.length) return getH(node);
    let s = 0;
    for (const k of kids) s += subH(k) + V_GAP;
    return Math.max(getH(node), s - V_GAP);
  };
  // 子树占用宽度（含后代）
  const subW = (node) => {
    const kids = cm.get(node.id) || [];
    if (!kids.length) return getW(node);
    let s = 0;
    for (const k of kids) s += subW(k) + H_GAP;
    return Math.max(getW(node), s - H_GAP);
  };
  // 外框内距：外框以成员包围盒为基准外扩（canvas 侧 PAD=14，带标题时顶边 24）。
  // 纵向让位时把这层内距一并算作「上方分支的占用」，否则展开的子树会压在外框边框上。
  // 注意只算在框的【最上 / 最下】那个成员上：框是一个整体矩形，中间成员之间没有额外内距，
  // 若每个成员都加，组内间距会被逐级撑大（16 变成 30、44…），整体下移就不再等量。
  const frameGrp = new Map(); // nodeId -> { ids, t, b }
  for (const g of doc.groups || []) {
    if (!g || g.kind !== "frame" || !Array.isArray(g.ids)) continue;
    const fp = { ids: g.ids, t: g.text ? 24 : 14, b: 14 };
    for (const id of g.ids) frameGrp.set(id, fp);
  }
  // 可见子树的真实包围盒（含自身与全部可见后代）：节点展开后子节点会围绕它向上 / 向下扩张，
  // 纵向紧排必须按实际占用计算，否则按 h 估算会漏掉向上溢出的那一块，造成上下遮挡
  const subBox = (node) => {
    let top = node.y, bot = node.y + getH(node), left = node.x, right = node.x + getW(node);
    for (const c of cm.get(node.id) || []) {
      const b = subBox(c);
      if (b.top < top) top = b.top;
      if (b.bot > bot) bot = b.bot;
      if (b.left < left) left = b.left;
      if (b.right > right) right = b.right;
    }
    const fg = frameGrp.get(node.id);
    if (fg) {
      // 只有当前位于框最上 / 最下的成员承担内距（框是整块矩形，中间成员无额外间距）
      let topmost = true, botmost = true;
      for (const id of fg.ids) {
        if (id === node.id) continue;
        const m = nodeById(id);
        if (!m || hidden.has(id)) continue;
        if (m.y < node.y) topmost = false;
        if (m.y + getH(m) > node.y + getH(node)) botmost = false;
      }
      if (topmost) top -= fg.t;
      if (botmost) bot += fg.b;
    }
    return { top, bot, left, right };
  };
  const groupHeight = (list) => { let c = 0; for (const k of list) c += subH(k) + V_GAP; return list.length ? c - V_GAP : 0; };
  const groupWidth = (list) => { let c = 0; for (const k of list) c += subW(k) + H_GAP; return list.length ? c - H_GAP : 0; };
  const dirFor = (side) => (side === "left" ? -1 : 1);
  // 分支朝向归一化：left / right / down（缺省视为 right）
  const sideOf = (n) => (n.side === "left" ? "left" : n.side === "down" ? "down" : "right");

  // 方位纠偏（自动吸附）：节点被摆到父节点另一侧（例如手动拖到根节点左边）时，
  // 把它的 side 纠正为当前所在侧 —— 布局后就会吸附到父节点左侧/右侧，而不是被排到对面去。
  // 只在「明显越到另一侧」（超过父宽一半 + 24px）时纠正，避免正常布局抖动。
  // 记录每个父节点被纠正后的侧，用于把本次重排限定在该侧。
  const sideChanged = new Map();
  if (layout === "elbow" || layout === "mindmap" || layout === "logicRight" || layout === "logicLeft") {
    for (const n of nodes) {
      if (n.parentId == null || hidden.has(n.id) || hidden.has(n.parentId)) continue;
      const p = nodeById(n.parentId);
      if (!p) continue;
      const pc = p.x + getW(p) / 2, nc = n.x + getW(n) / 2;
      const half = getW(p) / 2 + 24;
      let want = sideOf(n);
      if (layout === "logicLeft") want = "left";
      else if (layout === "logicRight" || layout === "list") want = "right";
      else if (nc < pc - half) want = "left";
      else if (nc > pc + half) want = "right";
      if (want !== sideOf(n)) { n.side = want; sideChanged.set(p.id, want); }
    }
  }

  // 向外范式：递归设定 y（父在子代间垂直居中）
  const placeY = (node, top, kids) => {
    const list = kids || (cm.get(node.id) || []);
    const h = getH(node);
    if (!list.length) { node.y = top; return h; }
    let cursor = top;
    for (const k of list) { const kh = placeY(k, cursor, cm.get(k.id)); cursor += kh + V_GAP; }
    const total = cursor - V_GAP - top;
    const first = list[0], last = list[list.length - 1];
    node.y = (first.y + (last.y + getH(last))) / 2 - h / 2;
    return total;
  };
  // 向外范式：递归设定 x（子节点沿父节点一侧延伸，标注 side）
  const placeX = (node, x, dir, kids) => {
    node.x = x;
    const list = kids || (cm.get(node.id) || []);
    const step = getW(node) + H_GAP;
    for (const k of list) { k.side = dir > 0 ? "right" : "left"; placeX(k, dir > 0 ? x + step : x - getW(k) - H_GAP, dir, cm.get(k.id)); }
  };
  // 向下范式（structure 布局）：以 centerX 为父节点水平中心向下铺开，父节点在子节点之间水平居中
  const placeDown = (node, centerX, top) => {
    node.x = centerX - getW(node) / 2;
    node.y = top;
    const kids = cm.get(node.id) || [];
    if (!kids.length) return;
    const total = groupWidth(kids);
    let left = centerX - total / 2;
    for (const k of kids) { placeDown(k, left + subW(k) / 2, top + getH(node) + V_GAP); left += subW(k) + H_GAP; }
  };

  // 重排某节点的可见子树：锚定该节点当前位置（焦点节点保持原位），子节点按 side 向外延伸并垂直居中
  // 双侧父节点（左右都有分支）只重排 sideHint 那一侧，对侧完全不动
  const layoutSubtree = (node) => {
    const kids = cm.get(node.id) || [];
    if (!kids.length) return;
    if (layout === "structure") {
      placeDown(node, node.x + getW(node) / 2, node.y); // 锚定 node 位置，向下铺开（父在子代间水平居中）
    } else {
      // 缺 side 的子节点：优先沿用 hint / 同级已有分支方向（多数侧）——只在同一侧扩展，绝不跨到对侧；
      // 同级全无 side 时才按子树高度贪心分两侧保持平衡
      const noSide = kids.filter((k) => k.side !== "left" && k.side !== "right" && k.side !== "down");
      if (noSide.length) {
        if (sideHint === "left" || sideHint === "right") {
          for (const k of noSide) k.side = sideHint;
        } else {
          const known = kids.filter((k) => k.side === "left" || k.side === "right");
          if (known.length) {
            const lc = known.filter((k) => k.side === "left").length;
            const pick = lc > known.length - lc ? "left" : (lc < known.length - lc ? "right" : known[0].side);
            for (const k of noSide) k.side = pick;
          } else {
            const sorted = [...noSide].sort((a, b) => subH(b) - subH(a));
            let lh = 0, rh = 0;
            for (const k of sorted) { if (lh <= rh) { k.side = "left"; lh += subH(k) + V_GAP; } else { k.side = "right"; rh += subH(k) + V_GAP; } }
          }
        }
      }
      // 指定了变化侧就只排该侧；该侧节点已被收起（不可见）时不排任何东西——
      // 绝不能因为「另一侧还可见」就把对侧节点重新居中（那会把无关节点搬走）
      const affected = (sideHint === "left" || sideHint === "right")
        ? kids.filter((k) => sideOf(k) === sideHint)
        : kids;
      if (!affected.length) return;
      // 该侧整组按子树高度紧排，并以父节点垂直中心为轴居中（自平衡）
      const total = groupHeight(affected);
      let top = node.y + getH(node) / 2 - total / 2;
      for (const k of affected) { placeY(k, top, cm.get(k.id)); top += subH(k) + V_GAP; }
      for (const k of affected) {
        placeX(k, k.side === "left" ? node.x - getW(k) - H_GAP : node.x + getW(node) + H_GAP, dirFor(k.side === "left" ? "left" : "right"), cm.get(k.id));
      }
      // 注意：不重设 node.y / node.x —— 焦点节点保持原位（锚定），子代已在其周围居中，避免无谓平移
    }
  };

  // 整棵子树连同后代一起平移（用于推开重叠的兄弟子树）
  const shiftSubtree = (node, dy) => {
    node.y += dy;
    for (const c of cm.get(node.id) || []) shiftSubtree(c, dy);
  };
  // 整棵子树连同后代一起横向平移（拖放落点吸附到该侧分支列）
  const shiftSubtreeX = (node, dx) => {
    node.x += dx;
    for (const c of cm.get(node.id) || []) shiftSubtreeX(c, dx);
  };
  // 同级之间纵向收敛：以「路径节点」(发生变化的那一支) 为锚，仅向下紧排其下方兄弟——
  // 上方兄弟与路径节点保持原位，下方兄弟按需要上移（收起时空隙被回收）或下移（展开/增删时让位），
  // 从而既消除重叠又绝不搬动无关节点；随后父节点在子节点之间重新居中（仅调父节点 y，不动子节点）。
  // 占用高度按子树的真实包围盒计算：展开节点时子节点会围绕它向上扩张，向上溢出撞到上方兄弟时
  // 把「该节点 + 其整棵子树」一起下移让位（而不是把上方节点搬走）
  const resolveSiblings = (parent, pathNode, keepParent, downOnly) => {
    const all = cm.get(parent.id) || [];
    if (!all.length) return;
    // 双侧父节点（左右都有分支）：只收敛 pathNode 所在那一侧，对侧与父节点纹丝不动
    const multi = !!pathNode && new Set(all.map(sideOf)).size > 1;
    const group = multi ? all.filter((n) => sideOf(n) === sideOf(pathNode)) : all;
    if (group.length) {
      const sorted = [...group].sort((a, b) => a.y - b.y);
      const pi = pathNode ? sorted.indexOf(pathNode) : 0;
      const start = pi < 0 ? 0 : pi; // 路径节点（含）及其下方兄弟参与紧排；上方兄弟纹丝不动
      // 紧排起点：贴住上方兄弟子树的真实底边 + 间距（无上方兄弟时为 -Infinity）
      let cursor = -Infinity;
      for (let i = 0; i < start; i++) {
        const b = subBox(sorted[i]);
        if (b.bot > cursor) cursor = b.bot;
      }
      if (Number.isFinite(cursor)) cursor += V_GAP;
      let uniform = null;   // downOnly：锚点下方所有兄弟等量下移（保持彼此间距，"整体"让开）
      for (let i = start; i < sorted.length; i++) {
        const k = sorted[i];
        const box = subBox(k);
        // 路径节点：只在下移方向让位，绝不因上方空隙被上拉（避免无谓搬动）；
        // 其下方兄弟：可上移回收空隙，也可下移让位；
        // downOnly（拖放落点）：一律只下移，且锚点下方整组等量下移 —— 用户把节点放在这个高度，
        // 不能把下面的节点反过来吸上去，也不能把它们之间的间距压缩掉。
        let dy;
        if (i === start) dy = Number.isFinite(cursor) ? Math.max(0, cursor - box.top) : 0;
        else if (downOnly) {
          if (uniform == null) uniform = Math.max(0, cursor - box.top);
          dy = uniform;
        } else dy = cursor - box.top;
        if (dy !== 0) shiftSubtree(k, dy);
        cursor = box.bot + dy + V_GAP;
      }
    }
    if (multi || keepParent) return; // 双侧父节点 / 拖放落点：对侧分支与父节点都不动
    const list = cm.get(parent.id) || [];
    if (list.length) {
      let top = Infinity, bot = -Infinity;
      for (const k of list) { const b = subBox(k); if (b.top < top) top = b.top; if (b.bot > bot) bot = b.bot; }
      parent.y = (top + bot) / 2 - getH(parent) / 2;
    }
  };

  const focus = focusId ? nodeById(focusId) : (nodes.find((n) => n.parentId == null) || null);
  if (!focus) return;
  // 拖放落点结算（anchorId）：被拖的节点【停在落点】而不是被整侧重排——
  // 把它横向吸附到该侧分支列，纵向只把下方兄弟整体向下让开，上方节点纹丝不动。
  // 这是「拖动节点过去」与「结构变化后自动整理」的区别：前者位置由用户决定。
  const anchor = anchorId && layout !== "structure" ? nodeById(anchorId) : null;
  if (anchor && anchor.id !== focus.id && anchor.parentId === focus.id && !hidden.has(anchor.id)) {
    const side = (sideHint === "left" || sideHint === "right") ? sideHint : (sideOf(anchor) === "left" ? "left" : "right");
    const sibs = (cm.get(focus.id) || []).filter((k) => k.id !== anchor.id && sideOf(k) === side);
    let col;
    if (sibs.length) {
      // 同侧已有分支的列（手动布局下同侧可能不齐，取纵向最近的那个兄弟所在列）
      const ac = anchor.y + getH(anchor) / 2;
      let best = sibs[0], bd = Infinity;
      for (const k of sibs) {
        const d = Math.abs(k.y + getH(k) / 2 - ac);
        if (d < bd) { bd = d; best = k; }
      }
      col = best.x;
    } else {
      col = side === "left" ? focus.x - getW(anchor) - H_GAP : focus.x + getW(focus) + H_GAP;
    }
    const dx = col - anchor.x;
    if (Math.abs(dx) > 0.5) shiftSubtreeX(anchor, dx);
    resolveSiblings(focus, anchor, true, true);
  } else {
    // 本次变化发生在哪一侧：显式 hint 优先；否则用方位纠偏的结果（节点被摆到父节点另一侧）
    layoutSubtree(focus, sideHint || sideChanged.get(focus.id) || undefined);
  }
  // 沿祖先链向上：每级收敛兄弟子树并重新居中父节点，使变化向上传播但不波及无关分支
  // structure 布局的兄弟是横向并排，纵向收敛会错位，故仅对非 structure 做祖先传播
  if (layout === "structure") return;
  let cur = focus;
  while (cur && cur.parentId != null && idSet.has(cur.parentId) && !hidden.has(cur.parentId)) {
    const parent = nodeById(cur.parentId);
    if (!parent) break;
    resolveSiblings(parent, cur);
    cur = parent;
  }
}

// 全部节点（按脑图尺寸）的包围盒中心
function bboxCenter(nodes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const s = sizeOf(n, "mindmap");
    if (minX > n.x) minX = n.x;
    if (minY > n.y) minY = n.y;
    if (maxX < n.x + s.w) maxX = n.x + s.w;
    if (maxY < n.y + s.h) maxY = n.y + s.h;
  }
  if (minX === Infinity) return null;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
