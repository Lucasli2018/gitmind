# MindFlow · 免费在线思维导图 / 流程图 / 白板

一个类 GitMind 的在线思维导图网站，纯前端零构建 + Cloudflare Pages + Functions + D1，支持账号注册登录与云端存储。

**线上地址**：<https://master.gitmind-48x.pages.dev>

## 功能特性

### 三种编辑模式（同一 SVG 画布内核）
- 🧠 **思维导图**：树状横向自动布局、`Tab` 加子节点 / `Enter` 加兄弟节点、父子自动连线（按 parentId 派生）、4 套主题配色一键换装、缩放平移
- 🔀 **流程图**：顶部工具栏（参考 mind-map）——回退/前进、矩形/圆角/判断/椭圆/平行四边形/文本、关联线（点起点再点目标）、图片、删除节点，快捷键 1-7 / L，节点端口拖拽连线，箭头自适应方向
- 🎨 **自由白板**：类 Excalidraw 浮动工具栏——选择 / 抓手 / 画框（Frame）/ 矩形 / 菱形 / 圆形 / 箭头 / 直线（拖拽创建，Shift 吸附 45°）/ 画笔 / 文字 / 图片 / 橡皮 / 激光笔（轨迹自动淡出），「…」菜单支持嵌入网页（iframe 节点）、便签、清空白板，6 色描边色板，快捷键 1/V/H/F/2/3/4/5/6/7/8/9/0/K
- 🖌️ **图形属性面板**：使用图形 / 画笔工具或选中图形时，左侧浮动属性面板（类 Excalidraw）——描边色、背景色（含透明棋盘格）、描边宽度（细/中/粗）、边框样式（实线/虚线/点线）、线条风格（圆滑/手绘/随性，手绘为确定性抖动路径）、边角（圆角/直角）、透明度滑杆、图层排序（置顶/上移/下移/置底）；修改实时应用到选中图形，同时作为新建图形的默认值
- ✍️ **文字属性面板**：使用文字工具或选中文字节点时，专属面板——文字颜色、字体大小（S/M/L/XL）、字体（无衬线/衬线/代码）、样式（正常/斜体）、文本对齐（左/中/右）、透明度、图层排序；点击画布即输入文字，双击再次编辑，样式实时生效并作为后续新建文字的默认值
- 📏 **直线自由变换**：直线 / 箭头选中后出现变换手柄——拖两端圆点改起点终点、拖中点圆点把直线弯曲为曲线（二次贝塞尔），细线加宽命中区更易点选
- 🔲 **框选多选**：选择工具下空白处左键拖拽框选（Shift 追加选择），选中后可整体拖动 / 删除

### 通用能力
- 👤 **账号体系**：邮箱注册 / 登录（PBKDF2 口令哈希 + HttpOnly Cookie 会话，`gm_sid`）
- ☁️ **云端存储**：Cloudflare D1（共享 `dev` 库，表前缀 `gm_`）+ R2 对象存储——导图内容优先存 R2（对象 Content-Type 统一为 `application/json; charset=utf-8`，key 格式 `maps/<用户ID>/<导图ID>.json`），`gm_maps.data` 置 NULL 不冗余；R2 不可用时自动回退 D1 `data` 列兜底，读取按 `r2_key` → 旧格式 key → D1 三级回退
- 💾 **保存状态与文件大小**：顶栏显示「已保存 09:39 · 12.3 KB」，浏览列表与分享页同样展示文件大小（`gm_maps.size` 落库）
- 🔄 **格式兼容**：自动识别并转换 simple-mind-map（mind-map 项目）格式的旧快照 / 导入文件（`layout/root/children` 树形 → 原生 `nodes` 平铺，`logicalStructure` 等布局名映射），云端加载即转换并回写自愈
- 📋 **模板库**：读书笔记 / 项目计划 / 会议纪要 / 知识梳理 / 请假流程 / 白板涂鸦
- 🔗 **分享链接**：一键生成公开只读页 `/share.html?id=<id>`
- 📤 **导入导出**：PNG / SVG / JSON 导出，JSON 导入（兼容 simple-mind-map 导出格式）
- 🛠 **增量迁移**：`scripts/migrate-r2-key.mjs`（补 `storage`/`r2_key`/`size` 列、`data` 放开为可 NULL、回填 size，幂等可重跑）；`scripts/fix-r2-content-type.mjs`（存量 R2 对象 Content-Type 统一刷为 `application/json; charset=utf-8`，幂等可重跑）；`scripts/deploy.mjs`（Machine 级 Token + `CLOUDFLARE_ACCOUNT_ID` 非交互部署）
- 📝 **大纲模式**：文字大纲与脑图双向转换
- 🧲 **白板右键菜单**：粘贴 / 复制（Ctrl+C/V 内部剪贴板，粘贴到鼠标位置）、复制为 PNG/SVG 到剪贴板（有选中时仅复制选中图形）、全部选中（Ctrl+A）、显示网格（Ctrl+'，随视图平移缩放，localStorage 记忆）、置顶/置底、删除、详细统计信息
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
