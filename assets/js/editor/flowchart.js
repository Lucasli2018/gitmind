// 流程图模式：顶部工具栏描述（main 据此构建，参考 mind-map 顶部工具栏交互）
// act 分四类：undo/redo、select 选择、shape:<图形>、link/image/delete 功能项
export const FC_TOOLS = [
  { act: "undo", label: "回退", icon: "undo" },
  { act: "redo", label: "前进", icon: "redo" },

  { act: "select", label: "选择", icon: "cursor", key: "V" },
  { act: "shape:rect", label: "矩形", icon: "rect", key: "1" },
  { act: "shape:rounded", label: "圆角", icon: "rounded", key: "2" },
  { act: "shape:diamond", label: "判断", icon: "diamond", key: "3" },
  { act: "shape:ellipse", label: "椭圆", icon: "ellipse", key: "4" },
  { act: "shape:parallelogram", label: "平行四边形", icon: "rect", key: "5" },
  { act: "shape:text", label: "文本", icon: "text", key: "6" },

  { act: "link", label: "关联线", icon: "link", key: "L" },
  { act: "image", label: "图片", icon: "image", key: "7" },
  { act: "delete", label: "删除节点", icon: "trash" },
];
