# Nanobot WebUI 现代极简风格重构计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 WebUI 彻底重构为精致的现代极简风格，提升视觉质感和交互体验。

**Architecture:** 基于 CSS 变量的全局主题控制，利用 Tailwind 4 的 `@theme` 块重定义设计语言，对核心 React 组件进行样式注入和结构微调。

**Tech Stack:** React 19, Tailwind CSS 4, Assistant-UI.

---

### Task 1: 全局设计基础与 CSS 变量重定义

**Files:**
- Modify: `nanobot-channel-webui/frontend/src/styles.css`

- [ ] **Step 1: 重定义核心 CSS 变量**
  更新 `:root` 和 `[data-theme='dark']` 下的颜色、圆角和阴影变量，引入 Inter 字体。
- [ ] **Step 2: 配置 Tailwind 4 主题块**
  在 `styles.css` 中使用 `@theme` 将 CSS 变量映射到 Tailwind 类。
- [ ] **Step 3: 验证构建**
  Run: `cd nanobot-channel-webui/frontend && npm run build`
  Expected: 构建成功，生成的 CSS 包含新的变量定义。

### Task 2: 整体布局与侧边栏优化

**Files:**
- Modify: `nanobot-channel-webui/frontend/src/app.tsx`
- Modify: `nanobot-channel-webui/frontend/src/styles.css`

- [ ] **Step 1: 调整主容器样式**
  为主界面增加微妙的淡入动画和更现代的背景色层级。
- [ ] **Step 2: 重构侧边栏 (Sidebar)**
  采用无边框设计，使用悬浮感更强的活跃项高亮效果。
- [ ] **Step 3: 验证视觉一致性**
  检查全局布局是否符合极简风格。

### Task 3: 消息流与气泡重构

**Files:**
- Modify: `nanobot-channel-webui/frontend/src/app.tsx`
- Modify: `nanobot-channel-webui/frontend/src/styles.css`

- [ ] **Step 1: 重构用户消息气泡**
  使用深色背景、精致阴影和连续圆角。
- [ ] **Step 2: 重构助手消息显示**
  去除背景块，优化文字排版和头像显示。
- [ ] **Step 3: 增加消息进入动画**
  利用 CSS Transitions 或 Framer Motion (如果已安装) 增加平滑位移。

### Task 4: Composer (输入框) 交互升级

**Files:**
- Modify: `nanobot-channel-webui/frontend/src/app.tsx`
- Modify: `nanobot-channel-webui/frontend/src/styles.css`

- [ ] **Step 1: 实现悬浮式输入框**
  增加毛玻璃效果 (Backdrop Blur) 和更强的交互焦点反馈。
- [ ] **Step 2: 优化附件预览样式**
  重构已上传文件的缩略图展示，增加移除动画。
- [ ] **Step 3: 验证输入流体验**

### Task 5: Markdown 与代码块样式精修

**Files:**
- Modify: `nanobot-channel-webui/frontend/src/markdown.ts`
- Modify: `nanobot-channel-webui/frontend/src/styles.css`

- [ ] **Step 1: 注入代码块精致样式**
  增加代码行号支持（如果可能）和右上角的一键复制按钮。
- [ ] **Step 2: 优化正文排版**
  调整行高、列表间距和引用块 (Blockquote) 的视觉引导线。
- [ ] **Step 3: 最终验证与交付**
  运行全面测试，确保重构不影响功能。
