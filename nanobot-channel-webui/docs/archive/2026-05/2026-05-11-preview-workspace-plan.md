# Preview Workspace Refactor Implementation Plan

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把插件预览工作区重构成按文件类型拆分的前端预览架构，并将 PDF/Excel 迁移到更强的开源前端实现。

**架构：** 保留现有右侧详情面板外壳，把具体预览能力拆到 `preview-workspace` 模块。PDF 改为正式 `pdfjs-dist` 集成，Excel 改为 Univer Sheets，Word 保留 `docx-preview` 但走独立 previewer，PPT 继续沿用现状。

**技术栈：** React 19, TypeScript, Vite, `pdfjs-dist`, `@univerjs/*`, `docx-preview`, `react-pptx-preview-kit`

---

## File Responsibilities

- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/media-types.ts`
  - 统一媒体类型判断和 preview capability 判断
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/media-router.tsx`
  - 根据 mime 路由到具体 previewer
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/pdf-previewer.tsx`
  - `pdfjs-dist` 集成和清理
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/sheet-previewer.tsx`
  - Univer Sheets 容器和 workbook 生命周期
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/docx-previewer.tsx`
  - `docx-preview` 专属封装
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/text-previewer.tsx`
  - 文本 / JSON / Markdown / HTML 预览
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/ppt-previewer.tsx`
  - 当前 PPT 预览的模块化搬迁
- 修改：`nanobot-channel-webui/frontend/src/detail-preview-pane.tsx`
  - 缩成 panel shell + router host
- 修改：`nanobot-channel-webui/frontend/src/styles.css`
  - 为新 preview workspace 增补必要样式
- 修改：`nanobot-channel-webui/frontend/package.json`
  - 增加 `pdfjs-dist` 与 Univer 相关依赖
- 测试：`nanobot-channel-webui/frontend/src/detail-preview-pane.test.tsx`
- 测试：`nanobot-channel-webui/frontend/src/preview-workspace/media-router.test.tsx`

### 任务 1：建立 preview workspace 模块边界

**文件：**
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/media-types.ts`
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/media-router.tsx`
- 修改：`nanobot-channel-webui/frontend/src/detail-preview-pane.tsx`
- 测试：`nanobot-channel-webui/frontend/src/preview-workspace/media-router.test.tsx`

- [ ] **步骤 1：编写失败的路由测试**

为以下行为添加测试：

- `application/pdf` -> `PdfPreviewer`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` -> `SheetPreviewer`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` -> `DocxPreviewer`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` -> `PptPreviewer`
- `text/plain` -> `TextPreviewer`
- 未支持类型 -> fallback 文案

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run src/preview-workspace/media-router.test.tsx`
预期：FAIL，缺少模块或导出

- [ ] **步骤 3：实现 media type 与路由模块**

提取现有 `mediaMime` 逻辑，新增统一媒体路由函数与 `MediaRouter` 组件，并让 `detail-preview-pane.tsx` 调用它。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test -- --run src/preview-workspace/media-router.test.tsx`
预期：PASS

### 任务 2：把文本与 PPT 逻辑迁入独立 previewer

**文件：**
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/text-previewer.tsx`
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/ppt-previewer.tsx`
- 修改：`nanobot-channel-webui/frontend/src/detail-preview-pane.tsx`

- [ ] **步骤 1：迁出当前文本与 PPT 预览逻辑**

把 `TextPreview`、`HtmlPreview`、`PptPreview` 从 `detail-preview-pane.tsx` 中迁到独立 previewer 文件，保持现有行为不变。

- [ ] **步骤 2：运行构建检查模块拆分无回归**

运行：`npm run build`
预期：PASS

### 任务 3：PDF 迁移到正式 `pdfjs-dist` 实现

**文件：**
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/pdf-previewer.tsx`
- 修改：`nanobot-channel-webui/frontend/package.json`
- 修改：`nanobot-channel-webui/frontend/src/detail-preview-pane.tsx`
- 修改：`nanobot-channel-webui/frontend/src/styles.css`
- 测试：`nanobot-channel-webui/frontend/src/detail-preview-pane.test.tsx`

- [ ] **步骤 1：添加 `pdfjs-dist` 依赖**

安装 `pdfjs-dist`，并确保 lockfile 同步更新。

- [ ] **步骤 2：实现 package-based PDF previewer**

实现要点：

- 使用 npm 依赖，而非 CDN script
- 配置 worker
- 加载文档时保留 `loadingTask`
- 关闭 / 卸载时销毁任务与文档引用
- 保留错误提示与加载状态

- [ ] **步骤 3：补充 PDF preview 行为测试**

测试目标：

- `MediaRouter` 对 PDF 走 `PdfPreviewer`
- previewer 在无内容时显示加载中 / 错误提示

- [ ] **步骤 4：运行相关测试与构建**

运行：
- `npm test -- --run src/preview-workspace/media-router.test.tsx src/detail-preview-pane.test.tsx`
- `npm run build`

预期：PASS

### 任务 4：Excel 迁移到 Univer Sheets

**文件：**
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/sheet-previewer.tsx`
- 修改：`nanobot-channel-webui/frontend/package.json`
- 修改：`nanobot-channel-webui/frontend/src/styles.css`
- 修改：`nanobot-channel-webui/frontend/src/detail-preview-pane.tsx`
- 测试：`nanobot-channel-webui/frontend/src/detail-preview-pane.test.tsx`

- [ ] **步骤 1：添加 Univer 依赖**

引入构建 spreadsheet workspace 所需的 `@univerjs/*` 包。

- [ ] **步骤 2：实现 Sheet previewer**

实现要点：

- 在独立容器中初始化 Univer
- 读取 XLSX 文件后创建 workbook
- 卸载时销毁实例与 DOM 绑定
- 维持右侧预览区尺寸内可滚动和可视化

- [ ] **步骤 3：删除旧的 `sheet_to_html` 路径**

把现有 SheetJS HTML 注入型预览从主面板逻辑中移除，避免双实现并存。

- [ ] **步骤 4：运行相关测试与构建**

运行：
- `npm test -- --run src/detail-preview-pane.test.tsx`
- `npm run build`

预期：PASS

### 任务 5：Word 预览模块化并硬化接入

**文件：**
- 创建：`nanobot-channel-webui/frontend/src/preview-workspace/docx-previewer.tsx`
- 修改：`nanobot-channel-webui/frontend/src/detail-preview-pane.tsx`
- 修改：`nanobot-channel-webui/frontend/src/styles.css`

- [ ] **步骤 1：迁出 docx previewer**

把 `DocxPreview` 迁到独立模块，并保持当前 `.docx` 预览行为。

- [ ] **步骤 2：减少 pane 中的第三方全局耦合**

把与 `docx-preview` 相关的加载和渲染状态局部化在 previewer 内，不再让 `detail-preview-pane.tsx` 承担库接入细节。

- [ ] **步骤 3：运行完整前端测试与构建**

运行：
- `npm test`
- `npm run build`

预期：PASS

### 任务 6：发布验证

**文件：**
- 修改：构建产物与静态资源同步结果

- [ ] **步骤 1：运行插件发布脚本**

运行：`./scripts/publish-local.sh`
预期：Python tests 通过、frontend tests 通过、build 通过、wheel 构建成功、安装到全局 tool 环境成功

- [ ] **步骤 2：记录用户手测关注点**

需要用户在页面上验证：

- PDF 是否能稳定打开并滚动
- Excel 是否进入真正的表格工作区
- Word 是否继续可预览
- 文件卡片点击与下载行为是否正常
