// 导图数据模型：文档结构、文本测量、换行、节点尺寸
import { uid } from "../api.js";

export function newId() { return uid(); }

export function emptyDoc(type) {
  return { type: type || "mindmap", nodes: [], edges: [], strokes: [], view: { x: 0, y: 0, scale: 1 } };
}
export function cloneDoc(doc) { return JSON.parse(JSON.stringify(doc)); }

let _ctx = null;
function ctx() {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  return _ctx;
}
export function measureText(text, fontSize, font) {
  const c = ctx();
  c.font = `${fontSize}px ${font || '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'}`;
  return c.measureText(text || "").width;
}

export function wrapText(text, maxWidth, fontSize) {
  const lines = [];
  const paragraphs = (text || "").split("\n");
  for (const para of paragraphs) {
    if (para === "") { lines.push(""); continue; }
    let line = "";
    for (const ch of para) {
      const test = line + ch;
      if (measureText(test, fontSize) > maxWidth && line) { lines.push(line); line = ch; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

// 计算节点显示尺寸 + 换行结果
export function sizeOf(n, type) {
  const fs = n.fontSize || 15;
  const lines = wrapText(n.text, type === "mindmap" ? 240 : n.shape === "text" ? 340 : Infinity, fs);
  if (type === "mindmap") {
    const w = Math.min(260, Math.max(90, (lines.length ? Math.max(...lines.map((l) => measureText(l, fs))) : 0) + 32));
    const h = Math.max(40, lines.length * (fs + 7) + 14);
    return { w, h, lines };
  }
  if (n.shape === "text") {
    const w = Math.max(40, (lines.length ? Math.max(...lines.map((l) => measureText(l, fs))) : 0) + 22);
    const h = Math.max(30, lines.length * (fs + 7) + 10);
    return { w, h, lines };
  }
  const w = n.w || (n.shape === "diamond" ? 140 : 120);
  const h = n.h || (n.shape === "diamond" ? 90 : 50);
  return { w, h, lines };
}
