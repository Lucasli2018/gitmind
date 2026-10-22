// 前端 API 封装 + 鉴权态
const API = "/api";

export async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || `请求失败 ${res.status}`);
  return data;
}

export const Auth = {
  async me() { try { const d = await api("/me"); return d.user; } catch (_) { return null; } },
  async login(email, pw) { return api("/login", { method: "POST", body: JSON.stringify({ email, pw }) }); },
  async register(email, pw, nickname) { return api("/register", { method: "POST", body: JSON.stringify({ email, pw, nickname }) }); },
  async logout() { return api("/logout", { method: "POST" }); },
};

export async function getMaps() { return (await api("/maps")).maps; }
export async function createMap(title, type, data) {
  return (await api("/maps", { method: "POST", body: JSON.stringify({ title, type, data }) })).map;
}
export async function getMap(id) { return (await api("/maps/" + id)).map; }
export async function saveMap(id, payload) {
  return api("/maps/" + id, { method: "PUT", body: JSON.stringify(payload) });
}
export async function deleteMap(id) { return api("/maps/" + id, { method: "DELETE" }); }
export async function setShare(id, isPublic) {
  return api("/maps/" + id + "/share", { method: "PUT", body: JSON.stringify({ is_public: isPublic }) });
}

export function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 时间仅显示 时:分（保存状态用）
export function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 字节数人性化：B / KB / MB
export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
// 字符串 UTF-8 字节数
export function byteLength(str) {
  return new TextEncoder().encode(str || "").length;
}
export function uid() { return crypto.randomUUID(); }

// 简易提示条
export function toast(msg, type = "info") {
  let box = document.getElementById("toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast";
    box.style.cssText =
      "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:9999;" +
      "display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.textContent = msg;
  const bg = type === "error" ? "#e5484d" : type === "success" ? "#11a884" : "#255";
  el.style.cssText =
    `background:${bg};color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;` +
    `box-shadow:0 8px 24px rgba(0,0,0,.18);opacity:0;transition:opacity .2s,transform .2s;`;
  box.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(-4px)"; });
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, 2200);
}
