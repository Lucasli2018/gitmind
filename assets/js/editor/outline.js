// 大纲面板：快速定位节点（只读列表，点击某行即选中并居中显示该节点；不再有应用/取消）
import { toast } from "../api.js";
import { sizeOf } from "./model.js";

export function openOutline(editor) {
  const old = editor.container.querySelector(".gm-outline");
  if (old) { old.remove(); return; } // 再点一次大纲图标 = 关闭
  if (editor.doc.type !== "mindmap") { toast("大纲仅支持思维导图", "info"); return; }

  const panel = document.createElement("div");
  panel.className = "gm-outline";
  panel.innerHTML =
    `<div class="gm-outline-head">` +
    `<div><b>大纲</b><span>点击任意一行即可定位到画布上的节点</span></div>` +
    `<button class="gm-outline-x" title="关闭大纲">×</button>` +
    `</div>` +
    `<div class="gm-outline-list"></div>`;
  const list = panel.querySelector(".gm-outline-list");
  editor.container.appendChild(panel);

  let lastSig = "";
  let unsub = null;

  // 当前选中节点（第一个）用于行高亮
  const activeId = () => {
    for (const k of editor.selection) if (!String(k).startsWith("e:") && !String(k).startsWith("g:")) return k;
    return null;
  };

  function build() {
    const sig = editor.doc.nodes.map((n) => `${n.id}:${n.parentId}:${n.text}:${n.collapsed ? 1 : 0}`).join("|");
    const sel = activeId();
    if (sig !== lastSig) {
      lastSig = sig;
      const rows = flatten(editor.doc);
      list.innerHTML = "";
      for (const r of rows) {
        const b = document.createElement("button");
        b.className = "gm-outline-item" + (r.node.id === sel ? " active" : "");
        b.dataset.id = r.node.id;
        b.style.paddingLeft = 10 + r.depth * 16 + "px";
        b.innerHTML = `<span class="dot" style="background:${escapeAttr(r.node.stroke || "#11b5a4")}"></span>` +
          `<span class="txt">${escapeHtml(r.node.text || "（空节点）")}</span>` +
          (r.hasKids ? `<span class="fold">${r.node.collapsed ? "▸" : "▾"}</span>` : "");
        b.addEventListener("click", () => locate(r.node.id));
        list.appendChild(b);
      }
    }
    // 高亮同步 + 选中行滚到可视区
    let activeEl = null;
    list.querySelectorAll(".gm-outline-item").forEach((el) => {
      const on = el.dataset.id === sel;
      el.classList.toggle("active", on);
      if (on) activeEl = el;
    });
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  // 点击某行：展开祖先（若在收起的分支里）-> 选中节点 -> 视图居中
  function locate(id) {
    const n = editor.nodeById(id);
    if (!n) return;
    let p = n.parentId ? editor.nodeById(n.parentId) : null;
    let expanded = false;
    while (p) {
      if (p.collapsed) { p.collapsed = false; expanded = true; }
      p = p.parentId ? editor.nodeById(p.parentId) : null;
    }
    editor.selection = new Set([id]);
    const s = editor.sizes.get(id) || sizeOf(n, "mindmap");
    const r = editor.rect();
    editor.view.x = r.width / 2 - (n.x + s.w / 2) * editor.view.scale;
    editor.view.y = r.height / 2 - (n.y + s.h / 2) * editor.view.scale;
    editor.render();
    if (expanded) editor.pushHistory();
    // 定位行高亮
    list.querySelectorAll(".gm-outline-item").forEach((el) => el.classList.toggle("active", el.dataset.id === id));
  }

  function close() {
    if (unsub) unsub();
    panel.remove();
  }
  panel.querySelector(".gm-outline-x").addEventListener("click", close);
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
  });

  unsub = editor.onRender(build);
  build();
}

// 按层级展开成行（含折叠分支内的节点，便于定位）
function flatten(doc) {
  const kids = new Map();
  const roots = [];
  for (const n of doc.nodes) {
    if (n.parentId == null) roots.push(n);
    else { if (!kids.has(n.parentId)) kids.set(n.parentId, []); kids.get(n.parentId).push(n); }
  }
  const out = [];
  const walk = (n, depth) => {
    const children = kids.get(n.id) || [];
    out.push({ node: n, depth, hasKids: children.length > 0 });
    for (const c of children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/["<>]/g, (c) => ({ '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c]));
}
