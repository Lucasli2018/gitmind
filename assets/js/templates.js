// 内置模板库（落地页 / 仪表盘 / 编辑器新建共用）
import { uid } from "./api.js";

const PALETTE = ["#11b5a4", "#2f80ed", "#ff7a59", "#f5a623", "#9b59b6", "#16a34a"];

function buildMindmap(rootText, childrenSpec) {
  const nodes = [];
  function walk(spec, parentId, color, depth) {
    const id = uid();
    nodes.push({
      id, x: 0, y: 0, w: depth === 0 ? 156 : 124, h: depth === 0 ? 56 : 44,
      text: spec.text, shape: "rounded",
      color: depth === 0 ? "#11b5a4" : "#ffffff",
      textColor: depth === 0 ? "#ffffff" : "#1f2a37",
      stroke: color, fontSize: depth === 0 ? 17 : 15,
      parentId, collapsed: false, depth,
    });
    if (spec.children) {
      spec.children.forEach((c, i) => walk(c, id, depth === 0 ? PALETTE[i % PALETTE.length] : color, depth + 1));
    }
    return id;
  }
  walk({ text: rootText, children: childrenSpec }, null, "#11b5a4", 0);
  return { type: "mindmap", nodes, edges: [], strokes: [], view: { x: 0, y: 0, scale: 1 } };
}

function fnode(x, y, w, h, text, shape, stroke) {
  return { id: uid(), x, y, w, h, text, shape, color: "#ffffff", textColor: "#1f2a37", stroke: stroke || "#94a3b8", fontSize: 14, parentId: null, collapsed: false };
}
function edge(from, to, label) { return { id: uid(), from, to, label: label || "", arrow: true }; }

function buildLeaveFlow() {
  const start = fnode(60, 40, 120, 48, "开始", "ellipse", "#11b5a4");
  const apply = fnode(50, 140, 140, 48, "提交请假申请", "rect", "#2f80ed");
  const lead = fnode(50, 240, 140, 48, "直属主管审批", "rect", "#2f80ed");
  const decide = fnode(45, 330, 150, 92, "是否批准", "diamond", "#f5a623");
  const reject = fnode(250, 345, 130, 60, "驳回并说明", "rect", "#e5484d");
  const end = fnode(60, 470, 120, 48, "结束", "ellipse", "#11b5a4");
  const nodes = [start, apply, lead, decide, reject, end];
  const edges = [
    edge(start.id, apply.id), edge(apply.id, lead.id), edge(lead.id, decide.id),
    edge(decide.id, reject.id, "否"), edge(decide.id, end.id, "是"),
  ];
  return { type: "flowchart", nodes, edges, strokes: [], view: { x: 0, y: 0, scale: 1 } };
}

function buildWhiteboard() {
  const note = { id: uid(), x: 80, y: 80, w: 180, h: 130, text: "💡 把灵感随手记在这里\n双击便签可编辑内容", shape: "sticky", color: "#fff3bf", textColor: "#7a5b00", stroke: "#ffe08a", fontSize: 15, parentId: null, collapsed: false };
  const txt = { id: uid(), x: 320, y: 120, w: 240, h: 60, text: "在这里自由书写 / 画任意图形", shape: "text", color: "transparent", textColor: "#1f2a37", stroke: "transparent", fontSize: 18, parentId: null, collapsed: false };
  return { type: "whiteboard", nodes: [note, txt], edges: [], strokes: [], view: { x: 0, y: 0, scale: 1 } };
}

export const TEMPLATES = [
  {
    id: "read", name: "读书笔记", type: "mindmap", desc: "拆解一本书的脉络", icon: "book",
    build: () => buildMindmap("《书名》", [
      { text: "作者与背景", children: [{ text: "作者简介" }, { text: "时代背景" }] },
      { text: "核心主题", children: [{ text: "主题一" }, { text: "主题二" }] },
      { text: "人物关系", children: [{ text: "主角" }, { text: "配角" }] },
      { text: "金句摘抄" },
      { text: "个人感悟" },
    ]),
  },
  {
    id: "project", name: "项目计划", type: "mindmap", desc: "目标拆解与里程碑", icon: "target",
    build: () => buildMindmap("项目名", [
      { text: "目标", children: [{ text: "核心目标" }, { text: "衡量指标" }] },
      { text: "里程碑", children: [{ text: "阶段一" }, { text: "阶段二" }, { text: "阶段三" }] },
      { text: "风险与对策" },
      { text: "所需资源" },
    ]),
  },
  {
    id: "meeting", name: "会议纪要", type: "mindmap", desc: "议程 / 决议 / 待办", icon: "users",
    build: () => buildMindmap("会议主题", [
      { text: "参会人" },
      { text: "议程", children: [{ text: "议题一" }, { text: "议题二" }] },
      { text: "决议事项" },
      { text: "待办任务", children: [{ text: "负责人 / 时限" }] },
    ]),
  },
  {
    id: "knowledge", name: "知识梳理", type: "mindmap", desc: "构建你的知识树", icon: "bulb",
    build: () => buildMindmap("主题", [
      { text: "概念" },
      { text: "原理", children: [{ text: "关键点" }] },
      { text: "案例" },
      { text: "延伸阅读" },
    ]),
  },
  {
    id: "leave", name: "流程图示例", type: "flowchart", desc: "请假审批流程", icon: "flow",
    build: () => buildLeaveFlow(),
  },
  {
    id: "brainstorm", name: "白板涂鸦", type: "whiteboard", desc: "自由头脑风暴", icon: "board",
    build: () => buildWhiteboard(),
  },
];

export function getTemplate(id) { return TEMPLATES.find((t) => t.id === id) || null; }
export function emptyDoc(type) {
  return { type: type || "mindmap", nodes: [], edges: [], strokes: [], view: { x: 0, y: 0, scale: 1 } };
}
