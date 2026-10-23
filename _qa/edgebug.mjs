import { chromium } from "file:///C:/Users/hspcadmin/node_modules/playwright/index.mjs";
const BASE = "http://127.0.0.1:8642";
const doc = {
  type: "flowchart",
  nodes: [
    { id: "n1", x: 100, y: 200, w: 140, h: 50, text: "开始", shape: "rect", color: "#fff", textColor: "#1f2a37", stroke: "#2f80ed", fontSize: 14, parentId: null, collapsed: false },
    { id: "n2", x: 400, y: 200, w: 140, h: 50, text: "结束", shape: "rect", color: "#fff", textColor: "#1f2a37", stroke: "#2f80ed", fontSize: 14, parentId: null, collapsed: false },
  ],
  edges: [ { id: "e1", from: "n1", to: "n2", label: "", arrow: true } ],
  strokes: [], groups: [], view: { x: 0, y: 0, scale: 1 },
};
const map = { id: "m1", title: "测试流程图", type: "flowchart", data: doc, owner: 1, is_public: false, updated_at: Date.now() };
const browser = await chromium.launch({ channel: "msedge" });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.route("**/api/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: 1, email: "t@t.com" } }) }));
await page.route("**/api/maps/m1", (r) => r.request().method() === "GET" ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ map }) }) : r.continue());
await page.goto(BASE + "/editor.html?id=m1", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__gmEditor && window.__gmEditor.doc && window.__gmEditor.doc.edges, null, { timeout: 8000 });
const info = await page.evaluate(() => {
  const ed = window.__gmEditor;
  const els = ed.container.querySelectorAll('[data-edge]');
  const out = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    out.push({ tag: el.tagName, cls: el.getAttribute("class"), d: (el.getAttribute("d")||"").slice(0,60), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
  }
  // 在连线中点测试 elementFromPoint
  const e0 = els[0];
  const r0 = e0.getBoundingClientRect();
  const cx = r0.x + r0.width/2, cy = r0.y + r0.height/2;
  const hit = document.elementFromPoint(cx, cy);
  return { count: els.length, out, cx: Math.round(cx), cy: Math.round(cy), hitTag: hit && hit.tagName, hitCls: hit && hit.getAttribute && hit.getAttribute("class"), hitDataEdge: hit && hit.getAttribute && hit.getAttribute("data-edge") };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
