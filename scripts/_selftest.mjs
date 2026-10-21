// 自测：桩化 document，验证布局/模板/尺寸计算不抛错且坐标有限
globalThis.document = {
  createElement() {
    return { getContext() { return { font: "", measureText(t) { return { width: (t || "").length * 8 }; } }; } };
  },
};
const { layoutMindmap } = await import("../assets/js/editor/mindmap.js");
const { TEMPLATES, emptyDoc } = await import("../assets/js/templates.js");
const { sizeOf } = await import("../assets/js/editor/model.js");

let bad = 0;
for (const t of TEMPLATES) {
  const doc = t.build();
  if (doc.type === "mindmap") layoutMindmap(doc);
  for (const n of doc.nodes) {
    const s = sizeOf(n, doc.type);
    if (!isFinite(n.x) || !isFinite(n.y) || !isFinite(s.w) || !isFinite(s.h)) { console.log("BAD", t.id, n.text, n.x, n.y, s); bad++; }
  }
  console.log(`模板 ${t.id}: ${doc.nodes.length} 节点, 边 ${doc.edges.length}`);
}
const e = emptyDoc("mindmap");
layoutMindmap(e); // 空文档不应抛错
console.log(bad === 0 ? "SELFTEST OK" : `SELFTEST FAIL (${bad})`);
