// 思维导图：多结构自动布局（参考 simple-mind-map 的布局思路自研）
// 支持：mindmap(经典双侧平衡) / logicRight(向右逻辑) / logicLeft(向左逻辑)
//       list(目录组织图，向右缩进) / structure(组织结构图，向下)
// 布局时为每个非根节点标注 side(left/right/down)，供 canvas 连线渲染使用
import { sizeOf } from "./model.js";

const V_GAP = 16; // 同级节点垂直间距
const H_GAP = 56; // 层级间最小水平间距（基准）

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
  const hidden = new Set();
  const kidsAll = new Map();
  for (const n of nodes) if (n.parentId != null) { if (!kidsAll.has(n.parentId)) kidsAll.set(n.parentId, []); kidsAll.get(n.parentId).push(n); }
  const stack = nodes.filter((n) => n.collapsed && (kidsAll.get(n.id) || []).length).map((n) => n.id);
  while (stack.length) {
    const id = stack.pop();
    for (const c of kidsAll.get(id) || []) if (!hidden.has(c.id)) { hidden.add(c.id); stack.push(c.id); }
  }
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
      if (rightG.length) { placeX(root, baseX, +1, rightG); stackY(rightG, root.y - rh0 / 2); }
      if (leftG.length) { placeX(root, baseX, -1, leftG); stackY(leftG, root.y - lh0 / 2); }

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
        stackY(rightG, root.y - rh0 / 2);
      }
      if (leftG.length) {
        placeX(root, baseX, -1, leftG);
        stackY(leftG, root.y - lh0 / 2);
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
  function placeHidden(parent, dir) {
    const kids = kidsAll.get(parent.id) || [];
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
    if (!n.collapsed) continue;
    const kids = kidsAll.get(n.id) || [];
    if (!kids.length) continue;
    placeHidden(n, n.side === "left" ? -1 : +1);
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
export function adaptMindmap(doc, focusId, sideHint) {
  const nodes = doc.nodes || [];
  if (!nodes.length) return;
  // 坐标防护：旧数据 / 导入异常导致的 NaN 先归零，避免计算扩散成 NaN
  for (const n of nodes) { if (!Number.isFinite(n.x)) n.x = 0; if (!Number.isFinite(n.y)) n.y = 0; }
  const layout = doc.layout || "mindmap";

  // 折叠隐藏集合（已折叠节点的整棵后代子树）
  const kidsAll = new Map();
  for (const n of nodes) if (n.parentId != null) { if (!kidsAll.has(n.parentId)) kidsAll.set(n.parentId, []); kidsAll.get(n.parentId).push(n); }
  const hidden = new Set();
  const stack = nodes.filter((n) => n.collapsed && (kidsAll.get(n.id) || []).length).map((n) => n.id);
  while (stack.length) {
    const id = stack.pop();
    for (const c of kidsAll.get(id) || []) if (!hidden.has(c.id)) { hidden.add(c.id); stack.push(c.id); }
  }

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
  const groupHeight = (list) => { let c = 0; for (const k of list) c += subH(k) + V_GAP; return list.length ? c - V_GAP : 0; };
  const groupWidth = (list) => { let c = 0; for (const k of list) c += subW(k) + H_GAP; return list.length ? c - H_GAP : 0; };
  const dirFor = (side) => (side === "left" ? -1 : 1);
  // 分支朝向归一化：left / right / down（缺省视为 right）
  const sideOf = (n) => (n.side === "left" ? "left" : n.side === "down" ? "down" : "right");

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
      // 双侧父节点：只排发生变化的那一侧，另一侧一根手指都不动
      const sides = new Set(kids.map(sideOf));
      const affected = sides.size > 1 && (sideHint === "left" || sideHint === "right")
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
  // 同级之间纵向收敛：以「路径节点」(发生变化的那一支) 为锚，仅向下紧排其下方兄弟——
  // 上方兄弟与路径节点保持原位，下方兄弟按需要上移（收起时空隙被回收）或下移（展开/增删时让位），
  // 从而既消除重叠又绝不搬动无关节点；随后父节点在子节点之间重新居中（仅调父节点 y，不动子节点）
  const resolveSiblings = (parent, pathNode) => {
    const all = cm.get(parent.id) || [];
    if (!all.length) return;
    // 双侧父节点（左右都有分支）：只把 pathNode 所在那一侧重新紧排并垂直居中，对侧与父节点纹丝不动
    if (pathNode && new Set(all.map(sideOf)).size > 1) {
      const group = all.filter((n) => sideOf(n) === sideOf(pathNode));
      if (group.length) {
        const total = groupHeight(group);
        let top = parent.y + getH(parent) / 2 - total / 2;
        for (const k of group) {
          const dy = top - k.y;
          if (dy !== 0) shiftSubtree(k, dy);
          top += subH(k) + V_GAP;
        }
      }
      return;
    }
    if (all.length >= 1) {
      const sorted = [...all].sort((a, b) => a.y - b.y);
      const pi = pathNode ? sorted.indexOf(pathNode) : 0;
      const start = pi < 0 ? 0 : pi; // 路径节点（含）及其下方兄弟参与紧排；上方兄弟纹丝不动
      let cursor = sorted[start].y;
      for (let i = start; i < sorted.length; i++) {
        const k = sorted[i];
        const dy = cursor - k.y;
        if (dy !== 0) shiftSubtree(k, dy);
        cursor += subH(k) + V_GAP;
      }
    }
    const list = cm.get(parent.id) || [];
    if (list.length) {
      const first = list[0], last = list[list.length - 1];
      parent.y = (first.y + (last.y + getH(last))) / 2 - getH(parent) / 2;
    }
  };

  const focus = focusId ? nodeById(focusId) : (nodes.find((n) => n.parentId == null) || null);
  if (!focus) return;
  layoutSubtree(focus, sideHint);
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
