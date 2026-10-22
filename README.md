# MindFlow · 免费在线思维导图 / 流程图 / 白板

一个类 GitMind 的在线思维导图网站，纯前端零构建 + Cloudflare Pages + Functions + D1，支持账号注册登录与云端存储。

**线上地址**：<https://master.gitmind-48x.pages.dev>

## 功能特性

### 三种编辑模式（同一 SVG 画布内核）
- 🧠 **思维导图**：树状横向自动布局、`Tab` 加子节点 / `Enter` 加兄弟节点、父子自动连线（按 parentId 派生）、4 套主题配色一键换装、缩放平移
- 🔀 **流程图**：矩形 / 圆角 / 菱形 / 椭圆 / 平行四边形，节点端口拖拽连线，箭头自适应方向
- 🎨 **自由白板**：类 Excalidraw 浮动工具栏——选择 / 抓手 / 画框（Frame）/ 矩形 / 菱形 / 圆形 / 箭头 / 直线（拖拽创建，Shift 吸附 45°）/ 画笔 / 文字 / 图片 / 橡皮 / 激光笔（轨迹自动淡出），「…」菜单支持嵌入网页（iframe 节点）、便签、清空白板，6 色描边色板，快捷键 V/H/F/2/3/4/5/6/7/8/9/0/K

### 通用能力
- 👤 **账号体系**：邮箱注册 / 登录（PBKDF2 口令哈希 + HttpOnly Cookie 会话，`gm_sid`）
- ☁️ **云端存储**：Cloudflare D1（共享 `dev` 库，表前缀 `gm_`），编辑自动保存（每分钟落盘 + 关页兜底）
- 💾 **保存状态与文件大小**：顶栏显示「已保存 09:39 · 12.3 KB」，浏览列表与分享页同样展示文件大小（`gm_maps.size` 落库）
- 📋 **模板库**：读书笔记 / 项目计划 / 会议纪要 / 知识梳理 / 请假流程 / 白板涂鸦
- 🔗 **分享链接**：一键生成公开只读页 `/share.html?id=<id>`
- 📤 **导入导出**：PNG / SVG / JSON 导出，JSON 导入
- 📝 **大纲模式**：文字大纲与脑图双向转换
- ⌨️ **快捷键**：Tab 加子节点、Enter 加兄弟、Delete 删除、Ctrl/⌘+S 保存、滚轮缩放、拖空白平移

## 目录结构

```
gitmind/
├── index.html            # 落地页 + 模板墙
├── login.html / register.html
├── dashboard.html        # 我的导图仪表盘
├── editor.html           # 编辑器
├── share.html            # 公开只读分享页
├── assets/
│   ├── favicon.svg       # 站点图标
│   ├── css/              # base.css（全站主题）/ editor.css（编辑器）
│   └── js/
│       ├── api.js        # fetch 封装 + 鉴权态
│       ├── icons.js / templates.js / app.js / auth.js / dashboard.js / share.js
│       └── editor/       # 编辑器内核
│           ├── canvas.js     # SVG 画布 / 视图变换 / 选择拖拽 / 连线 / 文本编辑
│           ├── model.js      # 数据模型 / 文本测量换行 / 节点尺寸
│           ├── mindmap.js    # 树状自动布局
│           ├── flowchart.js / whiteboard.js / outline.js / export.js
│           └── main.js       # 编辑器入口 / 保存 / 工具栏 / 快捷键
├── functions/
│   ├── _middleware.js    # 首访幂等建表 + 播种默认账号
│   └── api/              # register / login / logout / me / maps CRUD / share
├── schema.sql            # D1 DDL（gm_users / gm_sessions / gm_maps）
└── scripts/
    ├── init-d1.mjs       # REST 方式把 schema 应用到共享 dev 库（幂等）
    ├── deploy.mjs        # wrangler pages deploy（自动读 Machine 级 Token）
    └── cleanup-test.mjs  # 清理测试数据
```

## 数据模型

- `gm_maps.data` 存整张图 JSON：`{ type, nodes[], edges[], strokes[], view }`
  - `nodes[]`：`{ id, text, x, y, shape, color, textColor, stroke, fontSize, parentId }`
  - 脑图连线不落库，渲染时按 `parentId` 实时派生；流程图连线存 `edges[]`

## 本地开发

零构建，任意静态服务器即可预览前端（API 需部署后可用）：

```bash
python -m http.server 8787
```

## 部署（Cloudflare Pages + D1）

```bash
# 1. 建表（幂等，读 Machine 级 CLOUDFLARE_API_TOKEN）
node scripts/init-d1.mjs

# 2. 部署
node scripts/deploy.mjs
```

wrangler.toml 绑定：D1 → 共享 `dev` 库（database_name=dev）。

## Git 提交约定

提交身份 `lucasli <1906859953@qq.com>`，推送到 Gitee `li-luoqiang/gitmind`。
