// 公开分享页：只读渲染导图
import { getMap } from "./api.js";
import { Editor } from "./editor/canvas.js";

const params = new URLSearchParams(location.search);
const mapId = params.get("id");

(async () => {
  if (!mapId) { document.body.innerHTML = "<p style='padding:40px'>缺少导图 ID</p>"; return; }
  let map;
  try {
    map = await getMap(mapId);
  } catch (e) {
    document.body.innerHTML = `<p style="padding:40px;color:#e5484d">${e.message}</p>`;
    return;
  }
  document.getElementById("shareTitle").textContent = map.title || "未命名导图";
  const editor = new Editor(document.getElementById("canvas"), { readOnly: true, mode: map.type || "mindmap" });
  editor.load(map.data);
})();
