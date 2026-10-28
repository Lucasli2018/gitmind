// 导入 / 导出：PNG / SVG / JSON
import { toast } from "../api.js";

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function getExportSVG(editor) {
  const savedSel = new Set(editor.selection);
  editor.selection.clear();
  editor._forExport = true;
  editor.render();
  const b = editor.getBounds();
  const inner = editor.vp.innerHTML;
  editor._forExport = false;
  editor.selection = savedSel;
  editor.render();
  if (!b) return null;
  const pad = 40;
  const w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<defs>` +
    `<marker id="gm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker>` +
    `<filter id="gm-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.12"/></filter>` +
    `</defs>` +
    `<g transform="translate(${pad - b.x},${pad - b.y})">${inner}</g>` +
    `</svg>`;
  return { svg, w, h };
}

export function exportSVG(editor, name) {
  const r = getExportSVG(editor);
  if (!r) { toast("画布为空，无法导出", "error"); return; }
  download(new Blob([r.svg], { type: "image/svg+xml;charset=utf-8" }), `${name || "mindflow"}.svg`);
}

export function exportPNG(editor, name) {
  const r = getExportSVG(editor);
  if (!r) { toast("画布为空，无法导出", "error"); return; }
  const blob = new Blob([r.svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = r.w * scale; canvas.height = r.h * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((b) => { download(b, `${name || "mindflow"}.png`); URL.revokeObjectURL(url); }, "image/png");
  };
  img.onerror = () => { toast("PNG 导出失败", "error"); URL.revokeObjectURL(url); };
  img.src = url;
}

export function exportJSON(editor, name) {
  const data = JSON.stringify(editor.doc, null, 2);
  download(new Blob([data], { type: "application/json" }), `${name || "mindflow"}.json`);
}

export function importJSON(editor, file, onChange) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let doc = JSON.parse(reader.result);
      if (!doc || typeof doc !== "object") throw new Error("格式不正确");
      // 兼容 simple-mind-map（mind-map 项目）导出格式：树形 root/children -> 平铺 nodes
      if (!Array.isArray(doc.nodes) && doc.root && typeof doc.root === "object") {
        const nodes = [];
        const walk = (item, parentId, isRoot) => {
          const d = (item && item.data) || {};
          const id = d.uid || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
          nodes.push({
            id, x: 0, y: 0, w: isRoot ? 156 : 124, h: isRoot ? 56 : 44,
            text: String(d.text || "节点").replace(/<[^>]+>/g, "").trim() || "节点",
            shape: "rounded",
            color: isRoot ? "#11b5a4" : "#fff",
            textColor: isRoot ? "#ffffff" : "#1f2a37",
            stroke: isRoot ? "#11b5a4" : "#2f80ed",
            fontSize: isRoot ? 17 : 15,
            parentId: parentId || null,
            collapsed: d.expand === false,
          });
          for (const c of Array.isArray(item.children) ? item.children : []) walk(c, id, false);
        };
        walk(doc.root, null, true);
        const LAYOUTS = { logicalStructure: "logicRight", logicalStructureLeft: "logicLeft", mindMap: "mindmap", organizationStructure: "structure", catalogOrganization: "list" };
        doc = { type: "mindmap", nodes, edges: [], strokes: [], view: { x: 0, y: 0, scale: 1 }, layout: LAYOUTS[doc.layout] || "logicRight" };
      }
      if (!doc || !Array.isArray(doc.nodes)) throw new Error("格式不正确");
      doc.type = doc.type || "mindmap";
      doc.edges = doc.edges || [];
      doc.strokes = doc.strokes || [];
      doc.view = doc.view || { x: 0, y: 0, scale: 1 };
      editor.load(doc);
      if (onChange) onChange();
    } catch (e) { toast("导入失败：" + e.message, "error"); }
  };
  reader.readAsText(file);
}
