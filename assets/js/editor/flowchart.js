// 流程图模式：顶部工具栏描述（main 据此构建，参考 mind-map 顶部工具栏交互）
// act 分四类：select/hand 选择与抓手、shape:<图形>（点击画布处创建）、link/image/delete 功能项
// 撤销/重做统一放在左下控制条与快捷键（Ctrl+Z / Ctrl+Y），顶部工具栏不再重复
export const FC_TOOLS = [
  { act: "select", label: "选择", icon: "cursor", key: "V" },
  { act: "hand", label: "抓手", icon: "hand", key: "H" },

  { act: "shape:rect", label: "矩形", icon: "rect", key: "1" },
  { act: "shape:rounded", label: "圆角", icon: "rounded", key: "2" },
  { act: "shape:diamond", label: "判断", icon: "diamond", key: "3" },
  { act: "shape:ellipse", label: "椭圆", icon: "ellipse", key: "4" },
  { act: "shape:parallelogram", label: "平行四边形", icon: "rect", key: "5" },
  { act: "shape:text", label: "文本", icon: "text", key: "6" },

  { act: "link", label: "关联线", icon: "link", key: "L" },
  { act: "image", label: "图片", icon: "image", key: "7" },
  { act: "delete", label: "删除节点", icon: "trash" },
  { act: "fit", label: "整理布局", icon: "fit" },
];
