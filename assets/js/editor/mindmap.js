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

    } else if (layout === "mindmap" || layout === "elbow") {
      // 经典双侧平衡（elbow 直角导图仅连线改直角折线，布局相同）：直接孩子按子树高度贪心分到左右
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

  // 稳定化：重排后整体平移，使根节点位置与重排前一致（修复工具栏操作导致导图位置改变）
  const dx = Math.round(ax0 - anchorRoot.x), dy = Math.round(ay0 - anchorRoot.y);
  if (dx || dy) for (const n of nodes) { n.x += dx; n.y += dy; }
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
