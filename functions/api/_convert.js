// 文档格式兼容层：识别并转换 simple-mind-map（D:\gitee\mind-map）导出格式。
// 背景：早期 / 外部写入 R2 的快照是 { layout, root: { data, children } } 树形结构，
// gitmind 原生格式是 { type, nodes, edges, strokes, view }（parentId 树 + 平铺节点）。
// 加载时自动转换，并在转换后回写主存储自愈，后续读取即为原生格式。

// 识别 simple-mind-map 格式：有 root 对象、无 nodes 数组
export function isSmmDoc(obj) {
  return !!(
    obj &&
    typeof obj === "object" &&
    obj.root &&
    typeof obj.root === "object" &&
    !Array.isArray(obj.root) &&
    !Array.isArray(obj.nodes)
  );
}

// simple-mind-map 的 layout 名 -> gitmind 布局名
const LAYOUT_MAP = {
  logicalStructure: "logicRight",
  logicalStructureLeft: "logicLeft",
  mindMap: "mindmap",
  organizationStructure: "structure",
  catalogOrganization: "list",
};

// rich-text 文本（如 "<p>工作安排</p>"）剥掉标签取纯文本
function plainText(t) {
  if (typeof t !== "string") return "节点";
  const s = t.replace(/<[^>]+>/g, "").trim();
  return s || "节点";
}

// 树形结构 -> gitmind 平铺节点（parentId 建树；坐标交给前端 layoutMindmap 自动计算）
export function smmToDoc(smm) {
  const nodes = [];
  const walk = (item, parentId, isRoot) => {
    const d = (item && item.data) || {};
    const id = d.uid || crypto.randomUUID();
    nodes.push({
      id,
      x: 0,
      y: 0,
      w: isRoot ? 156 : 124,
      h: isRoot ? 56 : 44,
      text: plainText(d.text),
      shape: "rounded",
      color: isRoot ? "#11b5a4" : "#fff",
      textColor: isRoot ? "#ffffff" : "#1f2a37",
      stroke: isRoot ? "#11b5a4" : "#2f80ed",
      fontSize: isRoot ? 17 : 15,
      parentId: parentId || null,
      collapsed: d.expand === false,
    });
    const kids = Array.isArray(item.children) ? item.children : [];
    for (const c of kids) walk(c, id, false);
  };
  if (smm.root) walk(smm.root, null, true);
  return {
    type: "mindmap",
    nodes,
    edges: [],
    strokes: [],
    view: { x: 0, y: 0, scale: 1 },
    layout: LAYOUT_MAP[smm.layout] || "logicRight",
  };
}

// 统一入口：原生格式原样返回；simple-mind-map 格式转换为原生并标记 converted
export function normalizeDoc(obj) {
  if (isSmmDoc(obj)) return { doc: smmToDoc(obj), converted: true };
  return { doc: obj, converted: false };
}
