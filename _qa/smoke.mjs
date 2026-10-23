// gitmind 优化项端到端冒烟测试（Playwright + Edge）
// 覆盖：首屏 loading 隐藏 / 连线删除(菜单+功能) / 含图片节点删除二次提醒
//       / 图片压缩≤100KB / 不压缩开关 / 点击放大灯箱 / 加载失败占位符
import { chromium } from "file:///C:/Users/hspcadmin/node_modules/playwright/index.mjs";

const BASE = "http://127.0.0.1:8642";
const SMALL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MAX = 100 * 1024;

const MAPS = {
  m1: { type: "flowchart", data: { type: "flowchart",
    nodes: [ { id: "n1", x: 80, y: 140, w: 120, h: 60, text: "A", shape: "rect" },
             { id: "n2", x: 340, y: 140, w: 120, h: 60, text: "B", shape: "rect" } ],
    edges: [ { id: "e1", from: "n1", to: "n2" } ], strokes: [], groups: [], view: { x: 0, y: 0, scale: 1 } } },
  m2: { type: "mindmap", data: { type: "mindmap",
    nodes: [ { id: "r", parentId: null, x: 0, y: 0, text: "R", shape: "rounded" },
             { id: "c", parentId: "r", x: 240, y: 0, text: "C", shape: "rounded", image: SMALL } ],
    edges: [], strokes: [], groups: [], view: { x: 0, y: 0, scale: 1 } } },
  m3: { type: "whiteboard", data: { type: "whiteboard",
    nodes: [], edges: [], strokes: [], groups: [], view: { x: 0, y: 0, scale: 1 } } },
};

const results = [];
const rec = (name, ok, info) => { results.push({ name, ok: !!ok }); console.log((ok ? "PASS" : "FAIL") + " - " + name + (info ? "  (" + info + ")" : "")); };

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE.ERR:", m.text()); });

await page.route("**/api/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: 1, email: "u@x.com", name: "t" } }) }));
await page.route("**/api/maps/*", (r) => {
  const id = r.request().url().split("/").pop();
  if (r.request().method() === "GET") {
    const m = MAPS[id];
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ map: { id, title: "T", type: m.type, owner: { id: 1 }, is_public: false, updated_at: Date.now(), data: m.data } }) });
  } else {
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  }
});

async function loadMap(id) {
  await page.goto(`${BASE}/editor.html?id=${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__gmEditor && window.__gmEditor.doc && document.getElementById("gmLoading") && document.getElementById("gmLoading").classList.contains("gm-loading-hidden"), null, { timeout: 10000 });
}
// 在浏览器上下文内计算 dataURL 字节数（注意：page.evaluate 内无法访问 Node 作用域的 b64bytes）
const b64bytes = (src) => { const s = (src.split(",")[1] || ""); return Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : (s.endsWith("=") ? 1 : 0)); };

try {
  // ---------- 流程图 ----------
  await loadMap("m1");
  rec("loading-hidden-flowchart", true);

  const fcMenu = await page.evaluate(() => {
    const el = document.querySelector("[data-edge]");
    if (!el) return { ok: false, reason: "no edge el" };
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    const m = document.querySelector(".gm-ctx-menu");
    return { ok: !!m && m.textContent.includes("删除") };
  });
  rec("flowchart-menu-has-delete", fcMenu.ok, fcMenu.reason);
  await page.evaluate(() => { document.querySelectorAll(".gm-ctx-menu").forEach((m) => m.remove()); });

  const edgeLen = await page.evaluate(async () => {
    window.__gmEditor.selection = new Set(["e:e1"]); window.__gmEditor.render();
    await window.__gmEditor.deleteSelection();
    return window.__gmEditor.doc.edges.length;
  });
  rec("flowchart-edge-delete-works", edgeLen === 0, "edges=" + edgeLen);

  // ---------- 思维导图 ----------
  await loadMap("m2");
  rec("loading-hidden-mindmap", true);

  // 诊断：确认 onConfirmImageDelete 已接线且节点 c 含 image
  const diag = await page.evaluate(() => {
    const n = window.__gmEditor.nodeById("c");
    return { hasCb: !!window.__gmEditor.onConfirmImageDelete, img: !!(n && n.image), shape: n && n.shape, keys: n ? Object.keys(n) : [] };
  });
  console.log("  diag(mindmap c):", JSON.stringify(diag));

  const mmMenu = await page.evaluate(() => {
    const el = document.querySelector('[data-id="c"]');
    if (!el) return { ok: false, reason: "no node el" };
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    const m = document.querySelector(".gm-ctx-menu");
    return { ok: !!m && m.textContent.includes("删除") };
  });
  rec("mindmap-menu-has-delete", mmMenu.ok, mmMenu.reason);
  await page.evaluate(() => { document.querySelectorAll(".gm-ctx-menu").forEach((m) => m.remove()); });

  const beforeNodes = await page.evaluate(() => window.__gmEditor.doc.nodes.length);
  // 触发删除：confirmDialog 同步挂载弹框，无需 await 整段；先开弹框再点击
  await page.evaluate(() => { window.__gmEditor.selection = new Set(["c"]); window.__gmEditor.render(); window.__gmEditor.deleteSelection(); });
  let modalShown = true;
  try { await page.waitForSelector(".gm-modal-mask", { timeout: 3000 }); } catch { modalShown = false; }
  const modalTitle = modalShown ? await page.evaluate(() => document.querySelector(".gm-modal-mask h3").textContent) : "";
  rec("mindmap-img-delete-confirm-shown", modalShown && modalTitle.includes("删除"), modalTitle);
  if (modalShown) { await page.click(".gm-modal-mask [data-r=\"0\"]"); await page.waitForTimeout(150); }
  const afterCancel = await page.evaluate(() => window.__gmEditor.doc.nodes.length);
  rec("mindmap-img-delete-cancel-keeps-node", afterCancel === beforeNodes, "nodes=" + afterCancel + "/" + beforeNodes);
  // 再次删除并确认
  await page.evaluate(() => { window.__gmEditor.selection = new Set(["c"]); window.__gmEditor.render(); window.__gmEditor.deleteSelection(); });
  let modal2 = true;
  try { await page.waitForSelector(".gm-modal-mask", { timeout: 3000 }); } catch { modal2 = false; }
  if (modal2) { await page.click(".gm-modal-mask [data-r=\"1\"]"); await page.waitForTimeout(150); }
  const afterConfirm = await page.evaluate(() => window.__gmEditor.doc.nodes.length);
  rec("mindmap-img-delete-confirm-removes-node", afterConfirm === beforeNodes - 1, "nodes=" + afterConfirm + "/" + beforeNodes);

  // ---------- 白板（图片相关） ----------
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 2000; c.height = 1500;
    const x = c.getContext("2d");
    const img = x.createImageData(2000, 1500);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = Math.random() * 255; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.95);
  });
  const buf = Buffer.from(b64.split(",")[1], "base64");
  const origBytes = buf.length;

  await loadMap("m3");
  rec("loading-hidden-whiteboard", true);

  await page.setInputFiles("#wbImageFile", { name: "big.jpg", mimeType: "image/jpeg", buffer: buf });
  await page.waitForFunction(() => window.__gmEditor.doc.nodes.some((n) => n.shape === "image"), null, { timeout: 6000 });
  const c1 = await page.evaluate(() => {
    const nb = (src) => { const s = (src.split(",")[1] || ""); return Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : (s.endsWith("=") ? 1 : 0)); };
    const n = window.__gmEditor.doc.nodes.find((n) => n.shape === "image");
    return { bytes: nb(n.src), hasImg: !!document.querySelector("image[data-img]"), hasPh: !!document.querySelector(".gm-img-ph") };
  });
  rec("whiteboard-image-compressed-under-100KB", c1.bytes <= MAX * 1.05 && origBytes > MAX, `orig=${origBytes} comp=${c1.bytes}`);
  rec("whiteboard-image-placeholder-rendered", c1.hasPh);
  rec("whiteboard-image-data-img-rendered", c1.hasImg);

  const box = await page.locator("image[data-img]").first().boundingBox();
  let lbOk = false;
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    try { await page.waitForSelector(".gm-lightbox", { timeout: 2000 }); lbOk = true; } catch {}
    await page.keyboard.press("Escape");
  }
  rec("whiteboard-image-lightbox-on-click", lbOk);

  // 不压缩开关：注入 localStorage 后重载
  await page.evaluate(() => localStorage.setItem("gm_editor_settings", JSON.stringify({ noCompressImage: true })));
  await page.reload();
  await page.waitForFunction(() => window.__gmEditor && window.__gmEditor.doc && document.getElementById("gmLoading").classList.contains("gm-loading-hidden"), null, { timeout: 10000 });
  await page.setInputFiles("#wbImageFile", { name: "big.jpg", mimeType: "image/jpeg", buffer: buf });
  await page.waitForFunction(() => window.__gmEditor.doc.nodes.filter((n) => n.shape === "image").length >= 1, null, { timeout: 6000 });
  const c2 = await page.evaluate(() => {
    const nb = (src) => { const s = (src.split(",")[1] || ""); return Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : (s.endsWith("=") ? 1 : 0)); };
    const ns = window.__gmEditor.doc.nodes.filter((n) => n.shape === "image");
    return nb(ns[ns.length - 1].src);
  });
  rec("whiteboard-image-noCompress-over-100KB", c2 > MAX, `bytes=${c2}`);
} catch (e) {
  rec("FATAL", false, e.message);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
process.exit(failed.length ? 1 : 0);
