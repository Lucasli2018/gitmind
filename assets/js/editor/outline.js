// 大纲模式：思维导图 <-> 大纲 双向编辑（仅思维导图类型）
import { layoutMindmap } from "./mindmap.js";
import { newId } from "./model.js";

export function openOutline(editor) {
  const old = editor.container.querySelector(".gm-outline");
  if (old) old.remove();
  if (editor.doc.type !== "mindmap") { alert("大纲模式仅支持思维导图"); return; }

  const panel = document.createElement("div");
  panel.className = "gm-outline";
  const ta = document.createElement("textarea");
  ta.value = toOutline(editor.doc);
  ta.spellcheck = false;

  const head = document.createElement("div");
  head.className = "gm-outline-head";
  head.innerHTML = `<b>大纲模式</b><span>每行一个节点，缩进（每 2 空格）表示层级。编辑后点「应用」。</span>`;
  const bar = document.createElement("div");
  bar.className = "gm-outline-bar";
  const apply = document.createElement("button");
  apply.className = "btn btn-primary btn-sm"; apply.textContent = "应用";
  const close = document.createElement("button");
  close.className = "btn btn-ghost btn-sm"; close.textContent = "关闭";
  bar.appendChild(apply); bar.appendChild(close);

  panel.appendChild(head); panel.appendChild(ta); panel.appendChild(bar);
  editor.container.appendChild(panel);

  apply.addEventListener("click", () => { applyOutline(editor, ta.value); panel.remove(); });
  close.addEventListener("click", () => panel.remove());
}

function toOutline(doc) {
  const children = new Map();
  const roots = [];
  for (const n of doc.nodes) {
    if (n.parentId == null) roots.push(n);
    else { if (!children.has(n.parentId)) children.set(n.parentId, []); children.get(n.parentId).push(n); }
  }
  let out = "";
  function walk(n, depth) {
    out += "  ".repeat(depth) + (n.text || "") + "\n";
    for (const c of children.get(n.id) || []) walk(c, depth + 1);
  }
  for (const r of roots) walk(r, 0);
  return out;
}

function applyOutline(editor, text) {
  const nodes = [];
  const stack = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    const lead = (raw.match(/^\s*/)[0] || "").length;
    const depth = Math.floor(lead / 2);
    const txt = raw.trim();
    const node = { id: newId(), text: txt, shape: "rounded", color: "#fff", textColor: "#1f2a37", stroke: "#11b5a4", fontSize: 15, parentId: null, collapsed: false, x: 0, y: 0, w: 124, h: 44 };
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : null;
    node.parentId = parent ? parent.id : null;
    if (parent) node.stroke = parent.stroke;
    nodes.push(node);
    stack.push({ depth, node });
  }
  editor.doc.nodes = nodes;
  editor.doc.edges = [];
  layoutMindmap(editor.doc);
  editor.selection.clear();
  editor.render();
  editor.onChange();
}
