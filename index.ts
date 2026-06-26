import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { buildDtAiStylePrompt } from './prompt'
import type {
  DtAiSelectedElementContext,
  DtAiStyleEditorPluginOptions,
  DtAiStyleEditRequest,
  DtAiStyleEditResponse
} from './type'

export type {
  DtAiElementBrief,
  DtAiElementRect,
  DtAiSelectedElementContext,
  DtAiStyleEditorPluginOptions,
  DtAiStyleEditRequest,
  DtAiStyleEditResponse,
  DtAiStyleEditStatus
} from './type'

const dtDefaultEndpoint = '/__dt_ai_style/edit'
const dtDefaultMaxBodySize = 1024 * 1024
const dtDefaultClaudeTimeoutMs = 10 * 60 * 1000
const dtClientFile = fileURLToPath(new URL('./client.ts', import.meta.url))
const dtClientModule = `/@fs/${dtClientFile.replace(/\\/g, '/')}`

let dtIsClaudeRunning = false

type DtResolvedPluginOptions = {
  endpoint: string
  projectName: string
  projectRules: string
  sourceRoot: string
  allowedExtensions: string[]
  protectedPaths: string[]
  command: string
  permissionMode: string
  outputFormat: string
  timeoutMs: number
  maxBodySize: number
  requireComponentFile: boolean
}

class DtAiRequestError extends Error {
  constructor(public readonly statusCode: number, public readonly publicMessage: string) {
    super(publicMessage)
    this.name = 'DtAiRequestError'
  }
}

export function dtAiStyleEditorPlugin(options: DtAiStyleEditorPluginOptions = {}): Plugin {
  const dtOptions = dtResolvePluginOptions(options)
  let dtRoot = process.cwd()
  let dtEnabled = false
  let dtBase = '/'

  return {
    name: 'dt-ai-style-editor',
    apply: 'serve',
    enforce: 'post',
    configResolved(config) {
      dtRoot = config.root
      dtEnabled = typeof options.enabled === 'boolean' ? options.enabled : config.mode === 'test'
      dtBase = config.base && config.base !== './' ? (config.base.endsWith('/') ? config.base : `${config.base}/`) : '/'
    },
    transformIndexHtml() {
      if (!dtEnabled) return []

      return [
        {
          tag: 'script',
          attrs: {
            type: 'module',
            src: `${dtBase}${dtClientModule.slice(1)}`
          },
          injectTo: 'body'
        }
      ]
    },
    configureServer(server) {
      server.middlewares.use(dtOptions.endpoint, async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        if (!dtEnabled) {
          dtSendJson(res, 403, {
            success: false,
            message: 'AI 样式调试仅允许在启用模式下使用。',
            error: 'ai style editor is disabled'
          })
          return
        }

        if (dtIsClaudeRunning) {
          dtSendJson(res, 409, {
            success: false,
            message: '已有 AI 样式修改任务正在执行，请等待完成后再提交。',
            error: 'claude task is already running'
          })
          return
        }

        let dtLockedClaude = false

        try {
          const body = await dtReadJsonBody(req, dtOptions.maxBodySize)
          const request = dtNormalizeRequest(dtRoot, body, dtOptions)
          const error = dtValidateRequest(request, dtOptions)

          if (error) {
            dtSendJson(res, 400, {
              success: false,
              message: error,
              error
            })
            return
          }

          if (dtIsClaudeRunning) {
            dtSendJson(res, 409, {
              success: false,
              message: '已有 AI 样式修改任务正在执行，请等待完成后再提交。',
              error: 'claude task is already running'
            })
            return
          }

          dtIsClaudeRunning = true
          dtLockedClaude = true
          const result = await dtRunClaudeCode(dtRoot, request, dtOptions)
          dtSendJson(res, result.success ? 200 : 500, result)
        } catch (err) {
          if (err instanceof DtAiRequestError) {
            dtSendJson(res, err.statusCode, {
              success: false,
              message: err.publicMessage,
              error: err.publicMessage
            })
            return
          }

          console.error('[dt-ai-style-editor] 本地 AI 样式调试服务执行失败', err)
          dtSendJson(res, 500, {
            success: false,
            message: '本地 AI 样式调试服务执行失败。',
            error: 'internal server error'
          })
        } finally {
          if (dtLockedClaude) dtIsClaudeRunning = false
        }
      })
    }
  }
}

function dtResolvePluginOptions(options: DtAiStyleEditorPluginOptions): DtResolvedPluginOptions {
  return {
    endpoint: options.endpoint || dtDefaultEndpoint,
    projectName: options.projectName || '当前项目',
    projectRules: options.projectRules?.trim() || '',
    sourceRoot: dtNormalizeSourceRoot(options.sourceRoot),
    allowedExtensions: dtNormalizeExtensions(options.allowedExtensions),
    protectedPaths: options.protectedPaths?.length
      ? options.protectedPaths
      : ['node_modules', 'dist', '.env*', 'src/router', 'src/stores', 'src/apis', 'mock'],
    command: options.command || 'claude',
    permissionMode: options.permissionMode || 'acceptEdits',
    outputFormat: options.outputFormat || 'json',
    timeoutMs: options.timeoutMs || dtDefaultClaudeTimeoutMs,
    maxBodySize: options.maxBodySize || dtDefaultMaxBodySize,
    requireComponentFile: options.requireComponentFile ?? true
  }
}

function dtNormalizeSourceRoot(sourceRoot?: string) {
  return (sourceRoot || 'src').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || 'src'
}

function dtNormalizeExtensions(extensions?: string[]) {
  const rawExtensions = extensions?.length ? extensions : ['.vue']
  return rawExtensions.map((extension) => (extension.startsWith('.') ? extension : `.${extension}`))
}

function dtReadJsonBody(req: IncomingMessage, maxBodySize: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    let bodySize = 0
    let bodyTooLarge = false

    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (bodyTooLarge) return

      bodySize += Buffer.byteLength(chunk, 'utf8')
      if (bodySize > maxBodySize) {
        bodyTooLarge = true
        raw = ''
        return
      }

      raw += chunk
    })
    req.on('end', () => {
      if (bodyTooLarge) {
        reject(new DtAiRequestError(413, '请求内容过大。'))
        return
      }

      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new DtAiRequestError(400, '请求 JSON 格式不正确。'))
      }
    })
    req.on('error', reject)
  })
}

function dtNormalizeRequest(root: string, body: unknown, options: DtResolvedPluginOptions): DtAiStyleEditRequest {
  if (!dtIsRecord(body)) {
    throw new DtAiRequestError(400, '请求参数格式不正确。')
  }

  const selected = dtNormalizeSelected(root, body.selected, options)

  return {
    instruction: dtLimitText(body.instruction, 2000),
    selected
  }
}

function dtNormalizeSelected(
  root: string,
  selected: unknown,
  options: DtResolvedPluginOptions
): DtAiSelectedElementContext {
  const raw = dtIsRecord(selected) ? selected : {}
  const parent = dtIsRecord(raw.parent) ? raw.parent : undefined
  const rect = dtIsRecord(raw.rect) ? raw.rect : {}
  const componentFile = dtNormalizeComponentFile(root, raw.componentFile, options)

  return {
    tagName: dtLimitText(raw.tagName, 40),
    id: dtLimitText(raw.id, 120),
    className: dtLimitText(raw.className, 1200),
    text: dtLimitText(raw.text, 800),
    componentFile,
    componentName: dtLimitText(raw.componentName, 160),
    route: dtLimitText(raw.route, 300),
    pageUrl: dtLimitText(raw.pageUrl, 500),
    domPath: Array.isArray(raw.domPath)
      ? raw.domPath.slice(0, 8).map((item) => {
          const domItem = dtIsRecord(item) ? item : {}

          return {
            tagName: dtLimitText(domItem.tagName, 40),
            id: dtLimitText(domItem.id, 120),
            className: dtLimitText(domItem.className, 500),
            index: typeof domItem.index === 'number' && Number.isFinite(domItem.index) ? domItem.index : -1,
            text: dtLimitText(domItem.text, 200)
          }
        })
      : [],
    parent: parent
      ? {
          tagName: dtLimitText(parent.tagName, 40),
          id: dtLimitText(parent.id, 120),
          className: dtLimitText(parent.className, 500),
          text: dtLimitText(parent.text, 200)
        }
      : undefined,
    children: Array.isArray(raw.children)
      ? raw.children.slice(0, 6).map((item) => {
          const child = dtIsRecord(item) ? item : {}

          return {
            tagName: dtLimitText(child.tagName, 40),
            id: dtLimitText(child.id, 120),
            className: dtLimitText(child.className, 500),
            text: dtLimitText(child.text, 200)
          }
        })
      : [],
    rect: {
      top: dtNormalizeNumber(rect.top),
      left: dtNormalizeNumber(rect.left),
      width: dtNormalizeNumber(rect.width),
      height: dtNormalizeNumber(rect.height),
      scrollX: dtNormalizeNumber(rect.scrollX),
      scrollY: dtNormalizeNumber(rect.scrollY)
    }
  }
}

function dtNormalizeComponentFile(root: string, file: unknown, options: DtResolvedPluginOptions) {
  if (typeof file !== 'string') return ''

  const normalized = file.replace(/\\/g, '/')
  const withoutQuery = normalized.split('?')[0]
  const absolute = path.isAbsolute(withoutQuery) ? withoutQuery : path.resolve(root, withoutQuery)
  const relative = path.relative(root, absolute).replace(/\\/g, '/')

  if (relative.startsWith('..') || path.isAbsolute(relative)) return ''
  if (!relative.startsWith(`${options.sourceRoot}/`)) return ''
  if (!options.allowedExtensions.some((extension) => relative.endsWith(extension))) return ''

  return relative
}

function dtValidateRequest(request: DtAiStyleEditRequest, options: DtResolvedPluginOptions) {
  if (!request.instruction.trim()) return '请输入样式修改要求。'
  if (!request.selected.tagName) return '无法识别选中元素，请重新选择。'
  if (options.requireComponentFile && !request.selected.componentFile) return '无法准确定位源码，请选择更具体的元素。'

  return ''
}

// 获取跨平台 spawn 选项
function dtGetSpawnOptions(root: string, options: DtResolvedPluginOptions) {
  // Windows: npm 全局包通常是 .cmd/.ps1 文件，需要 shell 来执行
  // macOS/Linux: 直接执行可执行文件，不需要 shell
  const isWindows = process.platform === 'win32'

  return {
    cwd: root,
    env: process.env,
    // Windows 必须使用 shell 执行 .cmd 文件
    // macOS/Linux 不需要 shell，直接执行更高效
    shell: isWindows,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe']
  }
}

// 跨平台终止进程
function dtKillProcess(child: ReturnType<typeof spawn>, platform: string) {
  if (platform === 'win32') {
    // Windows 不支持 SIGTERM，使用 taskkill 强制终止
    child.kill() // Windows 上 kill() 会使用 TerminateProcess
  } else {
    // macOS/Linux 使用 SIGTERM 优雅终止
    child.kill('SIGTERM')
  }
}

function dtRunClaudeCode(
  root: string,
  request: DtAiStyleEditRequest,
  options: DtResolvedPluginOptions
): Promise<DtAiStyleEditResponse> {
  return new Promise((resolve) => {
    const prompt = buildDtAiStylePrompt(request, options)
    const platform = process.platform

    // 使用跨平台 spawn 选项
    const spawnOptions = dtGetSpawnOptions(root, options)
    const child = spawn(
      options.command,
      ['--permission-mode', options.permissionMode, '--output-format', options.outputFormat],
      spawnOptions
    )

    // 通过 stdin 写入 prompt，避免 shell 参数解析问题（换行符、JSON、中文等）
    if (child.stdin) {
      child.stdin.write(prompt)
      child.stdin.end()
    }

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      dtKillProcess(child, platform)
      resolve({
        success: false,
        message: 'Claude Code 执行超时，已终止任务。',
        error: 'claude timeout'
      })
    }, options.timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      console.error('[dt-ai-style-editor] 无法启动 Claude Code', err)
      resolve({
        success: false,
        message: `无法启动 Claude Code，请确认本机已安装并可执行 ${options.command} 命令。`,
        error: 'claude start failed'
      })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code === 0) {
        resolve({
          success: true,
          message: '源码已修改，请查看页面热更新。',
          summary: dtParseClaudeSummary(stdout)
        })
        return
      }

      console.error('[dt-ai-style-editor] Claude Code 执行失败', {
        code,
        stderr: dtLimitText(stderr, 4000),
        stdout: dtLimitText(stdout, 4000)
      })
      resolve({
        success: false,
        message: 'Claude Code 执行失败，请查看终端日志。',
        error: 'claude execution failed'
      })
    })
  })
}

function dtParseClaudeSummary(stdout: string) {
  const text = stdout.trim()
  if (!text) return 'Claude Code 已完成修改。'

  try {
    const parsed = JSON.parse(text) as { result?: string; message?: string; summary?: string }
    return dtLimitText(parsed.result || parsed.summary || parsed.message || text, 2000)
  } catch {
    return dtLimitText(text, 2000)
  }
}

function dtSendJson(res: ServerResponse, statusCode: number, data: DtAiStyleEditResponse) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function dtIsRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function dtNormalizeNumber(value: unknown) {
  const numberValue = Number(value || 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function dtLimitText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value : ''
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength)
}
