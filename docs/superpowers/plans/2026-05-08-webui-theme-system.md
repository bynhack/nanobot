# WebUI Theme System 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 `nanobot-channel-webui` 前端建立可扩展的主题系统，并落地 `HR 冷灰蓝轻奢 / 企业中性 / 政务严肃克制` 三套官方主题。

**架构：** 保持现有布局和交互结构不变，把视觉系统拆成双轴主题：`appearanceMode` 控制 `light/dark/system`，`uiTheme` 控制业务风格。通过 `html[data-theme][data-ui-theme]` 驱动 CSS 变量，再让组件样式统一消费这些设计令牌，避免把配色写死在单个组件中。

**技术栈：** React 19、TypeScript、Tailwind CSS 4、CSS custom properties、Vite、Vitest

---

### 任务 1：补齐主题状态模型与设置入口

**文件：**
- 修改：`nanobot-channel-webui/frontend/src/store.ts`
- 修改：`nanobot-channel-webui/frontend/src/components/settings/types.ts`
- 修改：`nanobot-channel-webui/frontend/src/components/settings/tabs/GeneralTab.tsx`
- 修改：`nanobot-channel-webui/frontend/src/settings-page.tsx`
- 修改：`nanobot-channel-webui/frontend/src/app.tsx`

- [ ] **步骤 1：统一主题存储键和默认值**

```ts
export const STORAGE_KEYS = {
  authToken: 'nanobot_channel_webui_auth_token',
  chatId: 'nanobot_channel_webui_chat_id',
  appearanceMode: 'nanobot_channel_webui_appearance_mode',
  uiTheme: 'nanobot_channel_webui_ui_theme',
} as const;
```

- [ ] **步骤 2：定义双轴主题类型和文案**

```ts
export type AppearanceMode = 'system' | 'light' | 'dark';
export type UiTheme = 'hr' | 'business' | 'gov';
```

- [ ] **步骤 3：在常规设置中暴露主题切换控件**

```tsx
<SettingsRow label="业务主题" hint="按使用场景切换界面气质，布局与交互保持不变。" vertical>
  <div className="settings-theme-grid" role="group" aria-label="业务主题切换">
    {UI_THEME_OPTIONS.map((option) => (
      <button
        key={option.value}
        type="button"
        className={`settings-theme-card${uiTheme === option.value ? ' active' : ''}`}
        onClick={() => onUiThemeChange(option.value)}
      >
        <span className="settings-theme-card-title">{option.label}</span>
        <span className="settings-theme-card-desc">{option.description}</span>
      </button>
    ))}
  </div>
</SettingsRow>
```

- [ ] **步骤 4：在应用根部同步主题到 DOM**

```ts
useEffect(() => {
  document.documentElement.dataset.theme = appearanceMode;
  window.localStorage.setItem(STORAGE_KEYS.appearanceMode, appearanceMode);
}, [appearanceMode]);

useEffect(() => {
  document.documentElement.dataset.uiTheme = uiTheme;
  window.localStorage.setItem(STORAGE_KEYS.uiTheme, uiTheme);
}, [uiTheme]);
```

- [ ] **步骤 5：运行前端构建确认主题状态链路可编译**

运行：`npm run build`
预期：构建成功，`settings-page.tsx`、`GeneralTab.tsx`、`app.tsx` 的主题类型保持一致

### 任务 2：重构全局设计令牌，建立三套主题变量

**文件：**
- 修改：`nanobot-channel-webui/frontend/src/styles.css`

- [ ] **步骤 1：保留明暗模式变量层，新增业务主题变量层**

```css
html[data-ui-theme='business'] {
  --color-accent: #2f6fe4;
  --color-accent-hover: #245dc5;
}

html[data-ui-theme='hr'] {
  --color-accent: #43536e;
  --color-accent-hover: #2f3c52;
}

html[data-ui-theme='gov'] {
  --color-accent: #39475d;
  --color-accent-hover: #273244;
}
```

- [ ] **步骤 2：为 HR 主题补齐冷灰蓝轻奢材质令牌**

```css
html[data-ui-theme='hr'] {
  --color-bg-main: #edf1f5;
  --color-bg-elevated: rgba(255, 255, 255, 0.92);
  --color-bg-panel: #e8edf3;
  --color-bg-surface: rgba(67, 83, 110, 0.08);
  --color-border-subtle: rgba(67, 83, 110, 0.10);
  --color-border-strong: rgba(67, 83, 110, 0.16);
  --color-text-primary: #172033;
  --color-text-secondary: #5b6678;
  --color-text-muted: #7a8597;
  --color-shell-shadow: 0 24px 60px rgba(26, 37, 56, 0.08);
  --color-card-shadow: 0 18px 40px rgba(26, 37, 56, 0.06);
}
```

- [ ] **步骤 3：为 business 和 gov 主题定义各自的配色与材质**

```css
html[data-ui-theme='business'] { /* 中性蓝灰企业风 */ }
html[data-ui-theme='gov'] { /* 深灰政务风 */ }
```

- [ ] **步骤 4：去掉当前零散写死的蓝色和黑白配色**

```css
/* before */
.composer-button.send { @apply bg-[#171717] text-white; }

/* after */
.composer-send {
  background: var(--color-contrast-button-bg);
  color: var(--color-contrast-button-text);
}
```

- [ ] **步骤 5：运行构建确认 CSS 变量无语法错误**

运行：`npm run build`
预期：构建成功，生成的 CSS 中包含 `data-ui-theme='hr' | 'business' | 'gov'` 选择器

### 任务 3：统一核心界面皮肤，落实 HR 冷灰蓝轻奢气质

**文件：**
- 修改：`nanobot-channel-webui/frontend/src/styles.css`

- [ ] **步骤 1：重做应用壳层与侧边栏皮肤**

```css
.shell {
  background:
    radial-gradient(circle at top left, rgba(67, 83, 110, 0.08), transparent 24%),
    linear-gradient(180deg, var(--color-bg-main) 0%, color-mix(in srgb, var(--color-bg-main) 92%, #dfe6ef) 100%);
}

.sidebar {
  background: color-mix(in srgb, var(--color-bg-panel) 88%, white 12%);
  border-color: var(--color-border-subtle);
  box-shadow: inset -1px 0 0 rgba(255,255,255,0.35);
}
```

- [ ] **步骤 2：重做消息气泡与工具卡材质**

```css
.bubble.user {
  background: color-mix(in srgb, var(--color-bg-surface) 92%, white 8%);
  border: 1px solid var(--color-border-subtle);
}

.tool-row,
.tool-list,
.tool-group-header {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-strong);
}
```

- [ ] **步骤 3：重做输入框、右侧查看器和设置弹层**

```css
.input,
.composer-surface,
.detail-panel,
.settings-shell {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
  box-shadow: var(--color-card-shadow);
}
```

- [ ] **步骤 4：补齐主题卡和主题切换器样式**

```css
.settings-theme-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.settings-theme-card.active {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 14%, transparent);
}
```

- [ ] **步骤 5：运行构建观察核心皮肤变更是否可编译**

运行：`npm run build`
预期：构建成功，核心类名全部来自统一主题令牌

### 任务 4：验证、打包并同步插件静态资源

**文件：**
- 修改：`nanobot-channel-webui/static/**/*`
- 修改：`nanobot-channel-webui/src/nanobot_channel_webui/static/**/*`

- [ ] **步骤 1：运行前端测试**

运行：`npm test`
预期：Vitest 全部通过

- [ ] **步骤 2：运行前端构建**

运行：`npm run build`
预期：生成新的 `static/assets/*.css` 与 `static/assets/*.js`

- [ ] **步骤 3：同步静态资源到 Python 包目录**

运行：`rsync -a --delete static/ src/nanobot_channel_webui/static/`
预期：插件运行时目录与打包目录资源一致

- [ ] **步骤 4：重新安装本地插件包**

运行：`./scripts/publish-local.sh`
预期：`nanobot-channel-webui` wheel 构建成功并安装进全局 `nanobot-ai` 工具环境

- [ ] **步骤 5：验证服务实际返回新资源**

运行：`curl -s http://127.0.0.1:8081/ | rg 'assets/'`
预期：返回新的构建资源名，而不是旧的 hash
