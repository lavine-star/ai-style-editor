import type { DtAiStyleEditorPluginOptions, DtAiStyleEditRequest } from './type'

const dtDefaultStyleRules = `
前端样式修改规范：
- 优先修改选中元素及其附近模板。
- 优先使用项目现有样式体系和工具类。
- 可以为视觉效果调整局部 HTML 结构，但不得修改业务逻辑。
- 不引入新的 UI 组件库、图标库或样式框架。
- 不修改 API、store、router、mock 数据或构建配置。
`

export function buildDtAiStylePrompt(request: DtAiStyleEditRequest, options: DtAiStyleEditorPluginOptions = {}) {
  const selected = request.selected
  const projectName = options.projectName || '当前项目'
  const sourceRoot = options.sourceRoot || 'src'
  const allowedExtensions = options.allowedExtensions?.length ? options.allowedExtensions : ['.vue']
  const allowedPaths = allowedExtensions.map((extension) => `${sourceRoot}/**/*${extension}`).join('、')
  const protectedPaths = options.protectedPaths?.length
    ? options.protectedPaths.join('、')
    : 'node_modules、dist、.env*、API、store、router、mock 数据、构建配置'
  const projectRules = options.projectRules?.trim() || dtDefaultStyleRules.trim()
  const targetFileLine = selected.componentFile
    ? `优先检查并修改这个源码文件：${selected.componentFile}`
    : `没有可靠的源码文件路径，请先根据路由、DOM 文本、class 和结构在 ${sourceRoot} 中定位对应模板。`

  return `你正在为 ${projectName} 修改一个被浏览器点选的页面区域样式。

用户样式要求：
${request.instruction.trim()}

${targetFileLine}

被选中的 DOM 上下文如下：
${JSON.stringify(selected, null, 2)}

项目规范：
${projectRules}

执行边界：
- 只修改当前项目源码。
- 默认允许修改：${allowedPaths}，以及与当前选中区域强相关的局部样式文件。
- 默认禁止修改：${protectedPaths}。
- 不要运行 typecheck、build、dev、install 或任何包安装命令。
- 不要创建 git commit。
- 修改完成后，用中文简要说明修改了哪些文件和视觉变化。
`
}
