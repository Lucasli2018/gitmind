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
    // 图标（emoji）占一个字号宽度；图片在文字上方，撑大节点
    const extraW = n.icon ? fs : 0;
    let w = Math.min(280, Math.max(90, (lines.length ? Math.max(...lines.map((l) => measureText(l, fs))) : 0) + 32 + extraW));
    let h = Math.max(40, lines.length * (fs + 7) + 14);
    if (n.image) {
      const iw = n.imageW || 120;
      w = Math.max(w, iw + 24);
      h += (n.imageH || 80) + 14;
    }
    return { w, h, lines };
  }
  if (n.shape === "text") {
    const w = Math.max(40, (lines.length ? Math.max(...lines.map((l) => measureText(l, fs))) : 0) + 22);
    const h = Math.max(30, lines.length * (fs + 7) + 10);
    return { w, h, lines };
  }
  const w = n.w || (n.shape === "diamond" ? 140 : 120);
  const h = n.h || (n.shape === "diamond" ? 90 : 50);
  // 箭头 / 直线：w、h 是相对起点的增量，可能为负，尺寸取绝对值
  if (n.shape === "arrow" || n.shape === "line") {
    return { w: Math.max(2, Math.abs(n.w ?? 160)), h: Math.max(2, Math.abs(n.h ?? 0)), lines };
  }
  // 流程图：文本 ≤20 字自适应宽高；>20 字只显示前 20 字 + 「……」
  // （文本框 shape:"text" 已有自适应逻辑；手动调过尺寸的节点保持用户尺寸，仅做截断显示）
  if (type === "flowchart" && n.shape !== "text") {
    const MAXC = 20;
    const raw = String(n.text || "");
    const visible = [...raw].filter((c) => c !== "\n").length;
    let display = raw;
    if (visible > MAXC) {
      let count = 0, out = "";
      for (const ch of raw) {
        if (ch === "\n") { out += ch; continue; }
        if (count >= MAXC) break;
        out += ch; count++;
      }
      display = out + "……";
    }
    const WRAPW = n.shape === "diamond" ? 130 : n.shape === "ellipse" ? 150 : 200;
    const dLines = wrapText(display, WRAPW, fs);
    if (n.manualSize) return { w, h, lines: dLines };
    const textW = dLines.length ? Math.max(...dLines.map((l) => measureText(l, fs))) : 0;
    const textH = dLines.length * (fs + 7);
    let fw, fh;
    if (n.shape === "diamond") { fw = Math.max(150, textW * 2 + 70); fh = Math.max(92, textH * 2 + 46); }
    else if (n.shape === "ellipse") { fw = Math.max(130, textW * 1.45 + 30); fh = Math.max(64, textH * 1.45 + 26); }
    else { fw = Math.max(140, textW + 36); fh = Math.max(50, textH + 20); }
    return { w: Math.round(fw), h: Math.round(fh), lines: dLines };
  }
  return { w, h, lines };
}
