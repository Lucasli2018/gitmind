// 思维导图：树状（横向）自动布局
import { sizeOf } from "./model.js";

export function layoutMindmap(doc) {
  const nodes = doc.nodes || [];
  if (!nodes.length) return;
  const children = new Map();
  const roots = [];
  for (const n of nodes) {
    if (n.parentId == null) roots.push(n);
    else { if (!children.has(n.parentId)) children.set(n.parentId, []); children.get(n.parentId).push(n); }
  }
  if (!roots.length) return;

  const H_GAP = 72, V_GAP = 16;
  function assignX(n, x) {
    n.x = x;
    const { w } = sizeOf(n, "mindmap");
    const cx = x + w + H_GAP;
    for (const k of children.get(n.id) || []) assignX(k, cx);
  }
  roots.forEach((r) => assignX(r, r.x || 0));

  let cursor = 0;
  function place(n) {
    const kids = children.get(n.id) || [];
    const { h } = sizeOf(n, "mindmap");
    if (!kids.length) { n.y = cursor; cursor += h + V_GAP; return; }
    kids.forEach(place);
    const first = kids[0], last = kids[kids.length - 1];
    const fh = sizeOf(first, "mindmap").h, lh = sizeOf(last, "mindmap").h;
    n.y = (first.y + (last.y + lh)) / 2 - h / 2;
  }
  roots.forEach(place);
}
