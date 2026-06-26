export type DtAiStyleEditStatus = 'idle' | 'selecting' | 'selected' | 'submitting' | 'success' | 'error'

export interface DtAiStyleEditorPluginOptions {
  enabled?: boolean
  endpoint?: string
  projectName?: string
  projectRules?: string
  sourceRoot?: string
  allowedExtensions?: string[]
  protectedPaths?: string[]
  command?: string
  permissionMode?: string
  outputFormat?: string
  timeoutMs?: number
  maxBodySize?: number
  requireComponentFile?: boolean
}

export interface DtAiElementRect {
  top: number
  left: number
  width: number
  height: number
  scrollX: number
  scrollY: number
}

export interface DtAiDomPathItem {
  tagName: string
  id: string
  className: string
  index: number
  text: string
}

export interface DtAiElementBrief {
  tagName: string
  id: string
  className: string
  text: string
}

export interface DtAiSelectedElementContext {
  tagName: string
  id: string
  className: string
  text: string
  componentFile: string
  componentName: string
  route: string
  pageUrl: string
  domPath: DtAiDomPathItem[]
  parent?: DtAiElementBrief
  children: DtAiElementBrief[]
  rect: DtAiElementRect
}

export interface DtAiStyleEditRequest {
  instruction: string
  selected: DtAiSelectedElementContext
}

export interface DtAiStyleEditResponse {
  success: boolean
  message: string
  summary?: string
  error?: string
}
