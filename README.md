# AI Style Editor

一个 Vite 插件，让你在浏览器中点选页面元素，通过 Claude Code 自动修改源码样式。

## 仓库地址

- [Gitee](https://gitee.com/Lavines/ai-style-editor)
- [GitHub](https://github.com/lavine-star/ai-style-editor)

## 功能介绍

- **浏览器端点选**：悬浮按钮进入选区模式，自动采集 DOM 信息、路由和 Vue 组件文件
- **自然语言描述**：输入样式要求，例如"按钮更醒目，卡片更轻盈"
- **Claude Code 修改源码**：本地调用 Claude Code，按项目规则修改源文件
- **热更新查看效果**：源码保存后由 Vite HMR 自动刷新，无需手动查找组件

## 快速开始

### 1. 复制插件目录

将整个 `tools/ai-style-editor` 目录复制到目标项目：

```
tools/ai-style-editor/
```

### 2. 配置 Vite 插件

在 `vite.config.ts` 中引入插件：

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { dtAiStyleEditorPlugin } from './tools/ai-style-editor'

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    dtAiStyleEditorPlugin({
      enabled: mode === 'test',
      projectName: '你的项目名',
      projectRules: `
        当前项目使用 Vue3 + TypeScript + Vite。
        Vue 文件必须使用 <script setup lang="ts">。
        样式优先使用项目现有样式体系。
        不修改业务逻辑，优先修改选中元素附近结构。
        不修改 API、store、router、mock 数据或构建配置。
      `
    })
  ]
}))
```

### 3. 添加启动脚本

在 `package.json` 中添加 test 模式脚本：

```json
{
  "scripts": {
    "test": "vite --host 0.0.0.0 --mode test"
  }
}
```

### 4. 启动并使用

```bash
pnpm run test
```

浏览器会显示悬浮按钮，点击后：
1. 选择页面元素
2. 输入样式修改要求
3. Claude Code 自动修改源码
4. 页面热更新显示效果

## 配置选项

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `config.mode === 'test'` | 控制是否启用插件 |
| `projectName` | `当前项目` | 项目名称，帮助 Claude 理解上下文 |
| `projectRules` | 通用前端规范 | 项目约束规则，限制 AI 修改范围 |
| `sourceRoot` | `src` | 源码目录，其他目录会被忽略 |
| `allowedExtensions` | `['.vue']` | 允许修改的文件类型 |
| `protectedPaths` | `router/stores/apis/mock` | 禁止修改的路径 |
| `command` | `claude` | Claude Code 命令名 |
| `permissionMode` | `acceptEdits` | Claude Code 权限模式 |
| `requireComponentFile` | `true` | 要求必须定位到组件文件 |

## 前置要求

- 本机已安装并登录 [Claude Code](https://claude.ai/code)
- 目标项目为 Vite 开发环境
- Vue3 项目（当前客户端依赖 Vue 组件实例信息）

## 安全边界

- **只在启用模式注入**：默认仅 `test` 模式生效
- **生产构建无残留**：插件只作用于 Vite serve，不进入 production build
- **限制源码定位**：组件文件必须在 `sourceRoot` 且扩展名在允许列表内
- **禁止修改敏感路径**：router、stores、apis、mock 等路径受保护

## 文件结构

```
tools/ai-style-editor/
├── index.ts      # Vite 插件入口
├── client.ts     # 浏览器端脚本（悬浮按钮、选区逻辑）
├── prompt.ts     # Claude prompt 构建
├── type.ts       # TypeScript 类型定义
├── index.html    # 配置指南文档
└── README.md     # 项目说明
```

## License

MIT