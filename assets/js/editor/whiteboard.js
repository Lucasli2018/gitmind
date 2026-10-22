// 白板模式：工具描述（main 据此构建浮动工具栏）
// group 用于分组渲染，more: true 表示收进「…」更多菜单
export const WB_TOOLS = [
  { tool: "select", label: "选择", key: "1", icon: "cursor", group: 1 },
  { tool: "hand", label: "抓手", key: "H", icon: "hand", group: 1 },

  { tool: "frame", label: "画框", key: "F", icon: "frame", group: 2 },
  { tool: "rect", label: "矩形", key: "2", icon: "rect", group: 2 },
  { tool: "diamond", label: "菱形", key: "3", icon: "diamond", group: 2 },
  { tool: "ellipse", label: "圆形", key: "4", icon: "ellipse", group: 2 },
  { tool: "arrow", label: "箭头", key: "5", icon: "arrow", group: 2 },
  { tool: "line", label: "直线", key: "6", icon: "flow", group: 2 },

  { tool: "pen", label: "画笔", key: "7", icon: "pen", group: 3 },
  { tool: "text", label: "文字", key: "8", icon: "text", group: 3 },
  { tool: "image", label: "图片", key: "9", icon: "image", group: 3 },
  { tool: "eraser", label: "橡皮", key: "0", icon: "eraser", group: 3 },

  { tool: "laser", label: "激光笔", key: "K", icon: "laser", group: 4 },
];

// 更多菜单项（嵌入网页 / 便签 / 清空白板）
export const WB_MORE = [
  { act: "embed", label: "嵌入网页", key: "", icon: "embed" },
  { act: "sticky", label: "便签", key: "", icon: "sticky" },
  { act: "clear", label: "清空白板", key: "", icon: "trash2" },
];

// 画笔 / 图形默认描边色板
export const WB_COLORS = ["#1f2a37", "#e5484d", "#f5a623", "#11b5a4", "#2f80ed", "#9b59b6"];
