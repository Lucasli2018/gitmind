// 登录 / 注册逻辑（支持 ?tpl= 模板直达）
import { Auth, createMap, toast } from "./api.js";
import { getTemplate } from "./templates.js";

const params = new URLSearchParams(location.search);
const tpl = params.get("tpl");

async function afterAuth() {
  if (tpl) {
    const t = getTemplate(tpl);
    if (t) {
      try {
        const map = await createMap(t.name, t.type, t.build());
        location.href = `/editor.html?id=${map.id}`;
        return;
      } catch (e) { toast(e.message, "error"); }
    }
  }
  const next = params.get("next");
  location.href = next || "/dashboard.html";
}

const form = document.getElementById("form");
const errEl = document.getElementById("err");
const submit = document.getElementById("submit");
if (form) {
  const isRegister = !!document.getElementById("nick");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    submit.disabled = true;
    try {
      const email = document.getElementById("email").value.trim();
      const pw = document.getElementById("pw").value;
      if (isRegister) {
        const nick = document.getElementById("nick").value.trim();
        await Auth.register(email, pw, nick);
      } else {
        await Auth.login(email, pw);
      }
      await afterAuth();
    } catch (err) {
      errEl.textContent = err.message;
      submit.disabled = false;
    }
  });
}
