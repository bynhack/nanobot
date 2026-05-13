---
name: nanobot-channel-webui
description: Standalone WebUI channel plugin for nanobot gateway.
colors:
  page-light: "#f7f7f8"
  raised-light: "#ffffff"
  sunken-light: "#f1f2f4"
  text-primary-light: "#0f1419"
  text-secondary-light: "#4a5160"
  text-muted-light: "#8a92a3"
  accent-light: "#2563eb"
  accent-hover-light: "#1d4ed8"
  success-light: "#15803d"
  danger-light: "#b42318"
  user-bubble-light: "#ececf1"
  code-bg-light: "#0f0f10"
  code-text: "#e6e6e6"
  page-dark: "#1a1a1c"
  raised-dark: "#232326"
  elevated-dark: "#2a2a2d"
  sunken-dark: "#18181a"
  text-primary-dark: "#ececf1"
  text-secondary-dark: "#b4b8c2"
  text-muted-dark: "#7a808d"
  accent-dark: "#5b8cff"
  accent-hover-dark: "#7aa2ff"
  user-bubble-dark: "#3a3a3f"
  hr-accent-light: "#2f6fe4"
  business-accent-light: "#2f6fe4"
  gov-accent-light: "#43536e"
typography:
  headline:
    fontFamily: "Inter, SF Pro Display, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, SF Pro Display, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, SF Pro Display, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Inter, SF Pro Display, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "JetBrains Mono, Fira Code, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.6
rounded:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.raised-light}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "{colors.raised-light}"
    textColor: "{colors.text-secondary-light}"
    rounded: "{rounded.sm}"
    height: "34px"
    padding: "0 14px"
  composer-surface:
    backgroundColor: "{colors.raised-light}"
    textColor: "{colors.text-primary-light}"
    rounded: "{rounded.xl}"
    padding: "10px"
  user-bubble:
    backgroundColor: "{colors.user-bubble-light}"
    textColor: "{colors.text-primary-light}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  tool-card:
    backgroundColor: "{colors.raised-light}"
    textColor: "{colors.text-primary-light}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  settings-shell:
    backgroundColor: "{colors.raised-light}"
    textColor: "{colors.text-primary-light}"
    rounded: "{rounded.lg}"
---

# Design System: nanobot-channel-webui

## 1. Overview

**Creative North Star: "Quiet Operations Desk"**

这个设计系统服务一个内部工作台式聊天产品。它的主角是对话、工具结果、附件、会话和运行配置，而不是品牌展示。视觉语言保持克制：浅灰页面、白色或近黑的表面层级、低饱和蓝色强调色、细边框、轻阴影和明确的 hover / focus 反馈。

界面应该显得稳定、清楚、有秩序。聊天区给用户足够呼吸感，设置页和详情面板承载更高信息密度，内容区的小工具默认安静，只在 hover、focus 或触屏必要场景出现。

**Key Characteristics:**

- 产品型界面，设计服务任务完成，而不是制造视觉噱头。
- 对话居中，侧边栏、设置页、详情面板都围绕当前 thread 工作。
- 状态表达直接：连接、运行、工具调用、只读、错误和认证状态都要有清晰文字。
- 默认中文化：按钮、提示、工具提示、空状态和错误信息优先使用中文。
- assistant-ui primitive 是交互基座，视觉层只负责塑形，不绕过核心状态模型。

## 2. Colors

调色板采用「浅灰工作台 + 单一低饱和蓝色」策略。浅色主题是默认办公场景，深色主题用于系统偏好或低光环境；HR、企业、政务主题只调整 accent，不改变整体结构。

### Primary

- **Operational Blue** (`#2563eb`): 默认强调色，用于品牌标记、主按钮、焦点环、技能 chip、工具状态和选中态。
- **HR Clear Blue** (`#2f6fe4`): HR 清爽主题的 accent，保持蓝色信任感但略微更柔和。
- **Government Slate** (`#43536e`): 政务严肃主题的 accent，降低饱和度，强调秩序和克制。

### Neutral

- **Workspace Mist** (`#f7f7f8`): 页面背景，避免纯白造成大面积刺眼。
- **Raised White** (`#ffffff`): 侧边栏、卡片、设置面板、composer 等主要表面。
- **Sunken Grey** (`#f1f2f4`): 输入底、表头、工具组 header、局部容器背景。
- **Ink Primary** (`#0f1419`): 主文本和深色发送按钮。
- **Slate Secondary** (`#4a5160`): 次级文本、图标和辅助说明。
- **Muted Blue Grey** (`#8a92a3`): placeholder、时间、状态辅助信息和低优先级图标。

### Dark Mode

- **Dark Canvas** (`#1a1a1c`): 深色页面背景。
- **Dark Raised** (`#232326`): 深色侧边栏和主要容器。
- **Dark Elevated** (`#2a2a2d`): 深色弹层、composer 和设置面板。
- **Dark Text** (`#ececf1`): 深色主文本。
- **Electric Soft Blue** (`#5b8cff`): 深色强调色，比浅色更亮以保证对比。

### Semantic

- **Success Green** (`#15803d`): 连接成功、工具成功和正向状态。
- **Danger Red** (`#b42318`): 错误、断开、认证失败、删除 hover 等风险动作。
- **Code Black** (`#0f0f10`): 代码块背景，确保代码内容与聊天文本分层。

### Named Rules

**The One Accent Rule.** 单屏只允许一个主强调色体系。主题可以切换 accent，但不要同时引入多套高饱和颜色。

**The Quiet Tool Rule.** 内容区工具按钮默认降低可见性，hover / focus 后出现；触屏设备保持可见。不要为了放工具按钮给内容额外加一层包围外框。

## 3. Typography

**Display Font:** Inter（fallback 为 SF Pro Display、system-ui、sans-serif）  
**Body Font:** Inter（fallback 为 SF Pro Display、system-ui、sans-serif）  
**Label/Mono Font:** JetBrains Mono（fallback 为 Fira Code、ui-monospace、monospace）

**Character:** 字体系统偏向产品工具感，字重和尺寸都克制。正文阅读优先，标题不用夸张比例；mono 只用于工具名、代码、参数和值，不承担装饰。

### Hierarchy

- **Headline** (600, `22px`, `1.3`): 欢迎页标题和关键空状态。
- **Title** (600, `16px`, `1.4`): 设置页标题、详情面板标题和区块标题。
- **Body** (400, `15px`, `1.65`): 聊天正文、Markdown、Streamdown 内容和主要说明。
- **Compact Body** (400 / 500, `13px` - `13.5px`, `1.45` - `1.6`): 设置行说明、附件 chip、会话标题和控件文字。
- **Label** (500 / 700, `10.5px` - `12.5px`, `0.07em` - `0.10em`): kicker、工具区标题、状态标签和小型元信息。
- **Mono** (500, `12.5px`, `1.6`): 工具名、参数值、代码块和结构化结果。

### Named Rules

**The Reading First Rule.** 聊天内容的正文行高固定偏松，优先保证中文、表格、代码和 Markdown 混排时可读。

**The Mono Boundary Rule.** 只有机器语义内容使用 mono：代码、参数、工具名、JSON 和路径。普通 UI 文案不要用 mono。

## 4. Elevation

系统采用细边框 + 轻阴影的混合策略。默认表面主要依靠背景层级和 `1px` 边框区分；阴影只用于 composer、弹层、卡片浮起、详情面板内预览和全屏表格等需要明确空间层级的地方。

### Shadow Vocabulary

- **Raise** (`0 1px 2px rgba(15, 23, 42, 0.04)`): 建议卡片、工具卡片、轻量内容容器。
- **Card** (`0 4px 14px rgba(15, 23, 42, 0.06)`): composer、hero logo、滚动到底按钮、图片下载浮层。
- **Float** (`0 18px 48px rgba(15, 23, 42, 0.10)`): 设置页、认证弹窗、菜单和高优先级浮层。

### Named Rules

**The Flat At Rest Rule.** 静态内容尽量平，hover、focus、拖拽、弹层和全屏才提升层级。

**The Border Carries Structure Rule.** 表格、设置行、工具组和详情面板优先用细边框组织结构，不用厚重分割线。

## 5. Components

### Buttons

- **Shape:** 常规按钮使用 `10px` 圆角，图标按钮使用 `10px`，发送和 pill 操作使用 `999px`。
- **Primary:** 背景使用 accent，文字使用 accent-on，高度通常为 `36px`，设置页和确认操作用此样式。
- **Send / Cancel:** 使用主文本色作为实心背景，保证 composer 主动作足够明确。
- **Ghost:** 透明或 raised 背景，细边框，hover 时进入 `bg-hover`。
- **Focus:** 使用 `2px` accent outline，不用仅靠颜色深浅表达可达状态。

### Composer

- **Surface:** `28px` 大圆角、白色或深色 elevated 背景、轻阴影、`10px` 内边距。
- **Layout:** 附件和技能 chip 在上方，输入占据中间，底部左右分别是添加附件和发送 / 停止。
- **Skill Chip:** 使用 accent-soft 背景，文本不带 `$`，发送后一次性清除。
- **Drag State:** 边框切换 accent，并增加 `0 0 0 4px` 的 soft focus halo。

### Messages

- **Assistant:** 透明背景，内容宽度随消息列，强调阅读和富内容渲染。
- **User:** 最大宽度约 75%，`20px` 圆角，使用 neutral bubble 背景。
- **Markdown / Streamdown:** 正文 `15px / 1.65`；代码块深色；inline code 使用 accent 文本和轻背景。
- **Tables:** 只用内部单元格分割线表达结构，不给表格、滚动容器或工具 wrapper 额外加包围外框；不要让 `td/th` 的四周边线闭合成外轮廓。工具栏作为右上角浮层，hover / focus 才出现。
- **Images / Files:** 下载和文件名等辅助工具默认隐藏，hover / focus 后出现；触屏设备保持可见。默认不要为了工具入口额外套 outline 卡片。

### Sidebar And Thread List

- **Width:** 默认 `260px`，移动端可折叠到 `0`。
- **Brand Mark:** 使用实心 accent 方形标记，`10px` 圆角。
- **Thread Item:** `40px` 最小高度，hover 使用 `bg-hover`，active 使用 `bg-active`。
- **Delete:** 删除按钮默认隐藏，thread item hover / focus 后出现；只读会话显示 pill。

### Settings

- **Shell:** 居中 overlay，最大 `960px × 680px`，`20px` 圆角，float 阴影。
- **Navigation:** 左侧 `220px` 导航，active 和 hover 都使用 `bg-hover`。
- **Rows:** 设置项以横向 row 为主，`14px 0` 间距，细边框分隔。
- **Theme Cards:** `14px` 圆角，sunken 背景，active 使用 accent-soft 和 accent border。

### Detail Panel

- **Placement:** 右侧可调整宽度面板，默认宽度由应用状态控制。
- **Header:** kicker 使用 accent 和大写 tracking，标题单行省略。
- **Resize:** 拖拽 handle 默认安静，hover / focus 时切换 accent。
- **Preview:** 图片、视频、PDF、DOCX、PPT、HTML 和工具结果各自保留内容原貌，容器只负责边界、滚动和下载入口。

### Tool Calls

- **Group:** 工具调用以分组卡片呈现，header 为 sunken 背景。
- **Row:** 三列布局：工具名、参数摘要、状态。hover 使用 `bg-hover`。
- **Status:** pending 使用 spinner，成功用 success，失败用 danger，同时保留中文状态文本。
- **Detail:** 点击进入右侧详情面板，参数和值用结构化块展示。

## 6. Do's and Don'ts

### Do

- 使用 `frontend/src/styles.css` 里的 CSS custom properties，不在组件样式里散落 raw hex。
- 新 UI 默认支持浅色、深色和系统主题，主题切换只覆盖必要 token。
- 内容区辅助工具用 hover、focus 和触屏 fallback 三套状态共同保证可用。
- 工具提示、按钮 aria-label、空状态、错误提示优先写中文。
- 新聊天相关交互优先查 assistant-ui primitive 和 adapter 的官方模式，再决定是否扩展。
- 表格、代码块、附件、图片和工具结果都要保证长内容可滚动，不撑破消息列。

### Don't

- 不要把这个产品做成营销页：避免大面积渐变、口号式 hero 和装饰性图形。
- 不要默认显示所有复制、下载、全屏、删除按钮，也不要为了这些按钮给内容额外加包围外框。
- 不要引入第二套并行的 thread / composer 状态，除非能证明 assistant-ui runtime 无法表达。
- 不要用纯黑 `#000000` 或纯白大面积替代现有 token；白色只在已有 raised / document preview 场景中使用。
- 不要把管理员设置、运行数据和普通聊天路径混在同一个视觉层级里。
- 不要只改开发态样式不发布。涉及前端产物时，必须同步静态资源并通过本地发布脚本验证。
