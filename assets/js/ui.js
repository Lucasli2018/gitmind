// 通用 UI 弹层：二次确认对话框 / 居中模态 / 右上悬浮面板
// 样式在 base.css（dashboard 与 editor 共用）；珊瑚橙确认按钮对应领主签名色

// 二次确认框（替代原生 confirm），resolve(true/false)
export function confirmDialog({ title = "提示", message = "", okText = "确认", cancelText = "取消", danger = true } = {}) {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "gm-modal-mask";
    mask.innerHTML =
      `<div class="gm-modal" role="dialog" aria-modal="true">` +
        `<button class="gm-modal-x" aria-label="关闭">×</button>` +
        `<h3>${title}</h3>` +
        `<div class="gm-modal-body"><span class="gm-modal-ico">!</span><span>${message}</span></div>` +
        `<div class="gm-modal-acts">` +
          `<button class="btn btn-ghost btn-sm" data-r="0">${cancelText}</button>` +
          `<button class="btn ${danger ? "gm-btn-coral" : "btn-primary"} btn-sm" data-r="1">${okText}</button>` +
        `</div>` +
      `</div>`;
    const done = (v) => { mask.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    mask.addEventListener("click", (e) => {
      if (e.target === mask || e.target.classList.contains("gm-modal-x")) done(false);
      const b = e.target.closest("[data-r]");
      if (b) done(b.dataset.r === "1");
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(mask);
    // 聚焦取消按钮，防止回车误删
    setTimeout(() => mask.querySelector('[data-r="0"]').focus(), 0);
  });
}

// 输入对话框（替代原生 prompt），resolve(输入串 | null)；Enter 确定 / Esc 取消
export function promptDialog({ title = "输入", label = "", value = "", placeholder = "", hint = "", okText = "确定", cancelText = "取消", maxlength = 200 } = {}) {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "gm-modal-mask";
    mask.innerHTML =
      `<div class="gm-modal" role="dialog" aria-modal="true">` +
        `<button class="gm-modal-x" aria-label="关闭">×</button>` +
        `<h3>${title}</h3>` +
        `<div class="gm-modal-body">` +
          (label ? `<div style="font-size:13px;color:#6b7686;margin-bottom:8px">${label}</div>` : "") +
          `<input class="gm-note-ta" style="min-height:0;padding:9px 12px" maxlength="${maxlength}" placeholder="${placeholder}" />` +
          (hint ? `<div style="font-size:12px;color:#8a94a3;margin-top:8px">${hint}</div>` : "") +
        `</div>` +
        `<div class="gm-modal-acts">` +
          `<button class="btn btn-ghost btn-sm" data-r="0">${cancelText}</button>` +
          `<button class="btn btn-primary btn-sm" data-r="1">${okText}</button>` +
        `</div>` +
      `</div>`;
    const inp = mask.querySelector("input");
    inp.value = value;
    const done = (v) => { mask.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter") { e.preventDefault(); done(inp.value); }
    };
    mask.addEventListener("click", (e) => {
      if (e.target === mask || e.target.classList.contains("gm-modal-x")) done(null);
      const b = e.target.closest("[data-r]");
      if (b) done(b.dataset.r === "1" ? inp.value : null);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(mask);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  });
}

// 居中模态（快捷键列表等大内容），返回 close 函数
export function showModal(title, bodyHtml) {
  const mask = document.createElement("div");
  mask.className = "gm-modal-mask";
  mask.innerHTML =
    `<div class="gm-modal gm-modal-lg" role="dialog" aria-modal="true">` +
      `<button class="gm-modal-x" aria-label="关闭">×</button>` +
      `<h3>${title}</h3>` +
      `<div class="gm-modal-scroll">${bodyHtml}</div>` +
    `</div>`;
  const close = () => { mask.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  mask.addEventListener("click", (e) => { if (e.target === mask || e.target.classList.contains("gm-modal-x")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(mask);
  return close;
}

// 右上悬浮面板（详细统计信息等），点击外部 / ESC / × 关闭；返回 close 函数
export function showFloatPanel(title, bodyHtml, opts = {}) {
  document.querySelectorAll(".gm-float-panel").forEach((el) => el.remove());
  const panel = document.createElement("div");
  panel.className = "gm-float-panel" + (opts.className ? " " + opts.className : "");
  panel.innerHTML =
    `<div class="gm-fp-head"><b>${title}</b><button class="gm-fp-x" aria-label="关闭">×</button></div>` +
    `<div class="gm-fp-body">${bodyHtml}</div>`;
  const close = () => { panel.remove(); document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", off, true); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const off = (e) => { if (!panel.contains(e.target)) close(); };
  document.addEventListener("keydown", onKey);
  panel.querySelector(".gm-fp-x").addEventListener("click", close);
  document.body.appendChild(panel);
  setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
  return close;
}
