import type { DtAiElementBrief, DtAiSelectedElementContext, DtAiStyleEditRequest, DtAiStyleEditResponse, DtAiStyleEditStatus } from './type'

declare global {
  interface Window {
    __DT_AI_STYLE_EDITOR_INSTALLED__?: boolean
  }
}

type DtVueComponentInternal = {
  type?: {
    __file?: string
    __name?: string
    name?: string
  }
  parent?: DtVueComponentInternal | null
}

const dtEditorAttr = 'data-dt-ai-style-editor'
const dtEndpoint = '/__dt_ai_style/edit'
const dtPanelViewportMargin = 12
const dtButtonViewportMargin = 0
const dtDragClickThreshold = 5
const dtPanelTouchListenerOptions = { capture: true, passive: false } as const

type DtPanelDragState = {
  offsetX: number
  offsetY: number
}

type DtButtonDragState = {
  offsetX: number
  offsetY: number
  startX: number
  startY: number
  moved: boolean
}

let dtStatus: DtAiStyleEditStatus = 'idle'
let dtSelectedContext: DtAiSelectedElementContext | null = null
let dtPanelDragState: DtPanelDragState | null = null
let dtButtonDragState: DtButtonDragState | null = null
let dtButtonClickFromDrag = false
let dtButtonClickResetTimer: number | undefined

if (!window.__DT_AI_STYLE_EDITOR_INSTALLED__) {
  window.__DT_AI_STYLE_EDITOR_INSTALLED__ = true
  dtInitAiStyleEditor()
}

function dtInitAiStyleEditor() {
  dtInjectStyle()

  const root = document.createElement('div')
  root.setAttribute(dtEditorAttr, 'root')
  root.className = 'dt-ai-style-root'
  root.innerHTML = `
    <button class="dt-ai-style-button" type="button" aria-label="AI 样式调试">
      <span class="dt-ai-style-button-glow"></span>
      <span class="dt-ai-style-button-surface">
        <svg class="dt-ai-style-button-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.94 4.94 8.5 8.5 4.94 9.94 8.5 11.38l1.44 3.56 1.44-3.56 3.56-1.44-3.56-1.44-1.44-3.56Z"></path>
          <path d="M17.2 3.5 16.4 5.6 14.3 6.4l2.1.8.8 2.1.8-2.1 2.1-.8-2.1-.8-.8-2.1Z"></path>
          <path d="M17.2 14.7 16.4 16.8l-2.1.8 2.1.8.8 2.1.8-2.1 2.1-.8-2.1-.8-.8-2.1Z"></path>
        </svg>
      </span>
    </button>
    <div class="dt-ai-style-outline"></div>
    <div class="dt-ai-style-tooltip"></div>
    <section class="dt-ai-style-panel" aria-label="AI 样式调试面板">
      <header class="dt-ai-style-panel-header">
        <div>
          <div class="dt-ai-style-panel-title">AI 样式调试</div>
          <div class="dt-ai-style-panel-subtitle">仅 pnpm test 模式可用，拖动标题区域可移动</div>
        </div>
        <button class="dt-ai-style-close" type="button">关闭</button>
      </header>
      <div class="dt-ai-style-target"></div>
      <textarea class="dt-ai-style-input" rows="4" placeholder="例如：让这个卡片更有层次，圆角更大，阴影更柔和"></textarea>
      <div class="dt-ai-style-actions">
        <button class="dt-ai-style-cancel" type="button">取消</button>
        <button class="dt-ai-style-submit" type="button">直接修改</button>
      </div>
      <div class="dt-ai-style-message"></div>
    </section>
  `
  document.body.appendChild(root)

  const button = root.querySelector<HTMLButtonElement>('.dt-ai-style-button')
  const closeButton = root.querySelector<HTMLButtonElement>('.dt-ai-style-close')
  const cancelButton = root.querySelector<HTMLButtonElement>('.dt-ai-style-cancel')
  const submitButton = root.querySelector<HTMLButtonElement>('.dt-ai-style-submit')
  const panelHeader = root.querySelector<HTMLElement>('.dt-ai-style-panel-header')

  root.addEventListener('click', dtStopEditorEvent)
  root.addEventListener('mousedown', dtStopEditorEvent)
  root.addEventListener('touchstart', dtStopEditorEvent)
  button?.addEventListener('click', dtHandleButtonClick)
  button?.addEventListener('mousedown', dtStartButtonMouseDrag)
  button?.addEventListener('touchstart', dtStartButtonTouchDrag, { passive: false })
  closeButton?.addEventListener('click', dtClosePanel)
  cancelButton?.addEventListener('click', dtClosePanel)
  submitButton?.addEventListener('click', dtSubmitEdit)
  panelHeader?.addEventListener('mousedown', dtStartPanelMouseDrag)
  panelHeader?.addEventListener('touchstart', dtStartPanelTouchDrag, { passive: false })

  document.addEventListener('mousemove', dtHandleMouseMove, true)
  document.addEventListener('click', dtHandleDocumentClick, true)
  document.addEventListener('keydown', dtHandleKeydown, true)
  window.addEventListener('resize', dtConstrainPanelToViewport)
  window.addEventListener('resize', dtConstrainButtonToViewport)
}

function dtHandleButtonClick(event: MouseEvent) {
  if (dtButtonClickFromDrag) {
    dtButtonClickFromDrag = false
    if (dtButtonClickResetTimer) window.clearTimeout(dtButtonClickResetTimer)
    dtButtonClickResetTimer = undefined
    event.preventDefault()
    event.stopPropagation()
    return
  }

  dtStartSelecting()
}

function dtStartButtonMouseDrag(event: MouseEvent) {
  if (event.button !== 0) return

  dtStartButtonDrag(event, event.clientX, event.clientY)
  document.addEventListener('mousemove', dtHandleButtonMouseDrag, true)
  document.addEventListener('mouseup', dtStopButtonMouseDrag, true)
}

function dtStartButtonTouchDrag(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch) return

  dtStartButtonDrag(event, touch.clientX, touch.clientY)
  document.addEventListener('touchmove', dtHandleButtonTouchDrag, dtPanelTouchListenerOptions)
  document.addEventListener('touchend', dtStopButtonTouchDrag, true)
  document.addEventListener('touchcancel', dtStopButtonTouchDrag, true)
}

function dtStartButtonDrag(event: Event, clientX: number, clientY: number) {
  const button = dtButtonElement()
  if (!button) return

  const rect = button.getBoundingClientRect()
  dtButtonDragState = {
    offsetX: clientX - rect.left,
    offsetY: clientY - rect.top,
    startX: clientX,
    startY: clientY,
    moved: false
  }
  dtButtonClickFromDrag = false
  dtSetButtonPosition(button, rect.left, rect.top)
  button.classList.add('is-dragging')
  document.body.classList.add('dt-ai-style-button-dragging')
  event.preventDefault()
  event.stopPropagation()
}

function dtHandleButtonMouseDrag(event: MouseEvent) {
  if (!dtButtonDragState) return

  dtUpdateButtonDragMovement(event.clientX, event.clientY)
  event.preventDefault()
  event.stopPropagation()
  dtMoveButton(event.clientX, event.clientY)
}

function dtHandleButtonTouchDrag(event: TouchEvent) {
  const touch = event.touches[0]
  if (!dtButtonDragState || !touch) return

  dtUpdateButtonDragMovement(touch.clientX, touch.clientY)
  event.preventDefault()
  event.stopPropagation()
  dtMoveButton(touch.clientX, touch.clientY)
}

function dtMoveButton(clientX: number, clientY: number) {
  const button = dtButtonElement()
  if (!button || !dtButtonDragState) return

  dtSetButtonPosition(button, clientX - dtButtonDragState.offsetX, clientY - dtButtonDragState.offsetY)
}

function dtUpdateButtonDragMovement(clientX: number, clientY: number) {
  if (!dtButtonDragState) return

  const distance = Math.hypot(clientX - dtButtonDragState.startX, clientY - dtButtonDragState.startY)
  if (distance >= dtDragClickThreshold) {
    dtButtonDragState.moved = true
  }
}

function dtStopButtonMouseDrag(event?: MouseEvent) {
  if (dtButtonDragState && event) dtUpdateButtonDragMovement(event.clientX, event.clientY)
  if (dtButtonDragState?.moved) dtMarkButtonClickFromDrag()
  event?.stopPropagation()
  dtStopButtonDrag()
}

function dtStopButtonTouchDrag(event?: TouchEvent) {
  const touch = event?.changedTouches[0]
  if (dtButtonDragState && touch) dtUpdateButtonDragMovement(touch.clientX, touch.clientY)

  const shouldStartSelecting = !dtButtonDragState?.moved
  dtMarkButtonClickFromDrag()
  event?.stopPropagation()
  dtStopButtonDrag()
  if (shouldStartSelecting) dtStartSelecting()
}

function dtMarkButtonClickFromDrag() {
  dtButtonClickFromDrag = true
  if (dtButtonClickResetTimer) window.clearTimeout(dtButtonClickResetTimer)
  dtButtonClickResetTimer = window.setTimeout(() => {
    dtButtonClickFromDrag = false
    dtButtonClickResetTimer = undefined
  }, 400)
}

function dtStopButtonDrag() {
  const button = dtButtonElement()
  dtButtonDragState = null
  button?.classList.remove('is-dragging')
  document.body.classList.remove('dt-ai-style-button-dragging')
  document.removeEventListener('mousemove', dtHandleButtonMouseDrag, true)
  document.removeEventListener('mouseup', dtStopButtonMouseDrag, true)
  document.removeEventListener('touchmove', dtHandleButtonTouchDrag, dtPanelTouchListenerOptions)
  document.removeEventListener('touchend', dtStopButtonTouchDrag, true)
  document.removeEventListener('touchcancel', dtStopButtonTouchDrag, true)
}

function dtConstrainButtonToViewport() {
  const button = dtButtonElement()
  if (!button) return

  const rect = button.getBoundingClientRect()
  dtSetButtonPosition(button, rect.left, rect.top)
}

function dtSetButtonPosition(button: HTMLElement, left: number, top: number) {
  const rect = button.getBoundingClientRect()
  const maxLeft = Math.max(dtButtonViewportMargin, window.innerWidth - rect.width - dtButtonViewportMargin)
  const maxTop = Math.max(dtButtonViewportMargin, window.innerHeight - rect.height - dtButtonViewportMargin)
  button.style.left = `${Math.round(Math.min(Math.max(dtButtonViewportMargin, left), maxLeft))}px`
  button.style.top = `${Math.round(Math.min(Math.max(dtButtonViewportMargin, top), maxTop))}px`
  button.style.right = 'auto'
  button.style.bottom = 'auto'
}

function dtStartSelecting() {
  dtStatus = 'selecting'
  dtSelectedContext = null
  dtSetMessage('移动鼠标选择页面区域，点击后输入修改要求。')
  dtPanelElement()?.classList.remove('is-open')
  document.body.classList.add('dt-ai-style-selecting')
}

function dtHandleMouseMove(event: MouseEvent) {
  if (dtStatus !== 'selecting') return

  const target = event.target
  if (!(target instanceof HTMLElement) || dtIsEditorElement(target)) return

  dtUpdateOutline(target)
}

function dtHandleDocumentClick(event: MouseEvent) {
  if (dtStatus !== 'selecting') return

  const target = event.target
  if (!(target instanceof HTMLElement) || dtIsEditorElement(target)) return

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()

  dtSelectedContext = dtCollectElementContext(target)
  dtStatus = 'selected'
  document.body.classList.remove('dt-ai-style-selecting')
  dtOpenPanel(dtSelectedContext)
}

function dtHandleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    dtStatus = 'idle'
    dtSelectedContext = null
    document.body.classList.remove('dt-ai-style-selecting')
    dtOutlineElement()?.classList.remove('is-visible')
    dtTooltipElement()?.classList.remove('is-visible')
    dtPanelElement()?.classList.remove('is-open')
    dtStopPanelDrag()
    return
  }

  if (event.altKey && event.key.toLowerCase() === 'a') {
    if (event.target instanceof HTMLElement && dtIsEditableElement(event.target)) return
    event.preventDefault()
    dtStartSelecting()
  }
}

function dtOpenPanel(context: DtAiSelectedElementContext) {
  const panel = dtPanelElement()
  const target = document.querySelector<HTMLElement>('.dt-ai-style-target')
  const input = document.querySelector<HTMLTextAreaElement>('.dt-ai-style-input')

  if (!panel || !target || !input) return

  target.innerHTML = `
    <div class="dt-ai-style-target-label">已选择</div>
    <div class="dt-ai-style-target-main">${dtEscapeHtml(context.tagName)} · ${dtEscapeHtml(context.componentFile || '未定位到文件')}</div>
    <div class="dt-ai-style-target-class">${dtEscapeHtml(context.className || '无 class')}</div>
  `
  input.value = ''
  panel.classList.add('is-open')
  dtPlacePanelAtDefault(panel)
  input.focus()
  dtSetMessage('输入样式要求后点击“直接修改”。')
}

function dtClosePanel() {
  dtStatus = 'idle'
  dtSelectedContext = null
  document.body.classList.remove('dt-ai-style-selecting')
  dtOutlineElement()?.classList.remove('is-visible')
  dtTooltipElement()?.classList.remove('is-visible')
  dtPanelElement()?.classList.remove('is-open')
  dtStopPanelDrag()
  dtSetMessage('')
}

function dtStartPanelMouseDrag(event: MouseEvent) {
  if (event.button !== 0 || dtShouldIgnorePanelDrag(event.target)) return

  dtStartPanelDrag(event, event.clientX, event.clientY)
  document.addEventListener('mousemove', dtHandlePanelMouseDrag, true)
  document.addEventListener('mouseup', dtStopPanelMouseDrag, true)
}

function dtStartPanelTouchDrag(event: TouchEvent) {
  if (dtShouldIgnorePanelDrag(event.target)) return

  const touch = event.touches[0]
  if (!touch) return

  dtStartPanelDrag(event, touch.clientX, touch.clientY)
  document.addEventListener('touchmove', dtHandlePanelTouchDrag, dtPanelTouchListenerOptions)
  document.addEventListener('touchend', dtStopPanelTouchDrag, true)
  document.addEventListener('touchcancel', dtStopPanelTouchDrag, true)
}

function dtStartPanelDrag(event: Event, clientX: number, clientY: number) {
  const panel = dtPanelElement()
  if (!panel) return

  const rect = panel.getBoundingClientRect()
  dtPanelDragState = {
    offsetX: clientX - rect.left,
    offsetY: clientY - rect.top
  }
  dtSetPanelPosition(panel, rect.left, rect.top)
  panel.classList.add('is-dragging')
  document.body.classList.add('dt-ai-style-dragging')
  event.preventDefault()
  event.stopPropagation()
}

function dtHandlePanelMouseDrag(event: MouseEvent) {
  if (!dtPanelDragState) return

  event.preventDefault()
  event.stopPropagation()
  dtMovePanel(event.clientX, event.clientY)
}

function dtHandlePanelTouchDrag(event: TouchEvent) {
  const touch = event.touches[0]
  if (!dtPanelDragState || !touch) return

  event.preventDefault()
  event.stopPropagation()
  dtMovePanel(touch.clientX, touch.clientY)
}

function dtMovePanel(clientX: number, clientY: number) {
  const panel = dtPanelElement()
  if (!panel || !dtPanelDragState) return

  dtSetPanelPosition(panel, clientX - dtPanelDragState.offsetX, clientY - dtPanelDragState.offsetY)
}

function dtStopPanelMouseDrag(event?: MouseEvent) {
  event?.stopPropagation()
  dtStopPanelDrag()
}

function dtStopPanelTouchDrag(event?: TouchEvent) {
  event?.stopPropagation()
  dtStopPanelDrag()
}

function dtStopPanelDrag() {
  const panel = dtPanelElement()
  dtPanelDragState = null
  panel?.classList.remove('is-dragging')
  document.body.classList.remove('dt-ai-style-dragging')
  document.removeEventListener('mousemove', dtHandlePanelMouseDrag, true)
  document.removeEventListener('mouseup', dtStopPanelMouseDrag, true)
  document.removeEventListener('touchmove', dtHandlePanelTouchDrag, dtPanelTouchListenerOptions)
  document.removeEventListener('touchend', dtStopPanelTouchDrag, true)
  document.removeEventListener('touchcancel', dtStopPanelTouchDrag, true)
}

function dtPlacePanelAtDefault(panel: HTMLElement) {
  panel.style.left = ''
  panel.style.top = ''
  panel.style.right = ''
  panel.style.bottom = ''

  const rect = panel.getBoundingClientRect()
  dtSetPanelPosition(
    panel,
    window.innerWidth - rect.width - dtPanelViewportMargin,
    window.innerHeight - rect.height - dtPanelViewportMargin
  )
}

function dtConstrainPanelToViewport() {
  const panel = dtPanelElement()
  if (!panel || !panel.classList.contains('is-open')) return

  const rect = panel.getBoundingClientRect()
  dtSetPanelPosition(panel, rect.left, rect.top)
}

function dtSetPanelPosition(panel: HTMLElement, left: number, top: number) {
  const rect = panel.getBoundingClientRect()
  const position = dtGetConstrainedPanelPosition(left, top, rect.width, rect.height)
  panel.style.left = `${Math.round(position.left)}px`
  panel.style.top = `${Math.round(position.top)}px`
  panel.style.right = 'auto'
  panel.style.bottom = 'auto'
}

function dtGetConstrainedPanelPosition(left: number, top: number, width: number, height: number) {
  const maxLeft = Math.max(dtPanelViewportMargin, window.innerWidth - width - dtPanelViewportMargin)
  const maxTop = Math.max(dtPanelViewportMargin, window.innerHeight - height - dtPanelViewportMargin)

  return {
    left: Math.min(Math.max(dtPanelViewportMargin, left), maxLeft),
    top: Math.min(Math.max(dtPanelViewportMargin, top), maxTop)
  }
}

function dtShouldIgnorePanelDrag(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('button, textarea, input, select, a'))
}

async function dtSubmitEdit() {
  const input = document.querySelector<HTMLTextAreaElement>('.dt-ai-style-input')
  const submit = document.querySelector<HTMLButtonElement>('.dt-ai-style-submit')
  const instruction = input?.value.trim() || ''

  if (!dtSelectedContext) {
    dtSetMessage('请先选择页面元素。')
    return
  }

  if (!instruction) {
    dtSetMessage('请输入样式修改要求。')
    input?.focus()
    return
  }

  const request: DtAiStyleEditRequest = {
    instruction,
    selected: dtSelectedContext
  }

  try {
    dtStatus = 'submitting'
    if (submit) submit.disabled = true
    dtSetMessage('正在提交 Claude Code 修改任务...')

    const response = await fetch(dtEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    })
    const data = await dtParseStyleEditResponse(response)

    if (!response.ok || !data.success) {
      dtStatus = 'error'
      dtSetMessage(data.error || data.message || '修改失败。')
      return
    }

    dtStatus = 'success'
    dtSetMessage(data.summary || data.message || '源码已修改，请查看页面热更新。')
  } catch (err) {
    dtStatus = 'error'
    dtSetMessage(err instanceof Error ? err.message : '本地 AI 样式调试服务不可用，请确认正在使用 pnpm test 启动。')
  } finally {
    if (submit) submit.disabled = false
  }
}

async function dtParseStyleEditResponse(response: Response): Promise<DtAiStyleEditResponse> {
  try {
    return await response.json() as DtAiStyleEditResponse
  } catch {
    return {
      success: false,
      message: response.ok ? '本地服务返回格式异常。' : '本地服务返回异常响应。'
    }
  }
}

function dtCollectElementContext(element: HTMLElement): DtAiSelectedElementContext {
  const rect = element.getBoundingClientRect()
  const vueInfo = dtFindVueComponent(element)

  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || '',
    className: dtGetClassName(element),
    text: dtGetText(element, 500),
    componentFile: vueInfo.file,
    componentName: vueInfo.name,
    route: window.location.pathname + window.location.search + window.location.hash,
    pageUrl: window.location.href,
    domPath: dtGetDomPath(element),
    parent: element.parentElement ? dtBriefElement(element.parentElement) : undefined,
    children: Array.from(element.children).slice(0, 6).filter((child): child is HTMLElement => child instanceof HTMLElement).map(dtBriefElement),
    rect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY)
    }
  }
}

function dtFindVueComponent(element: HTMLElement) {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    let instance: DtVueComponentInternal | null | undefined = (current as unknown as { __vueParentComponent?: DtVueComponentInternal }).__vueParentComponent

    while (instance) {
      const file = instance.type?.__file || ''
      if (file) {
        return {
          file,
          name: instance.type?.__name || instance.type?.name || ''
        }
      }
      instance = instance.parent || null
    }
  }

  return { file: '', name: '' }
}

function dtGetDomPath(element: HTMLElement) {
  const path: DtAiSelectedElementContext['domPath'] = []
  let current: HTMLElement | null = element

  while (current && current !== document.body && path.length < 8) {
    path.unshift({
      tagName: current.tagName.toLowerCase(),
      id: current.id || '',
      className: dtGetClassName(current).slice(0, 500),
      index: dtGetElementIndex(current),
      text: dtGetText(current, 160)
    })
    current = current.parentElement
  }

  return path
}

function dtBriefElement(element: HTMLElement): DtAiElementBrief {
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || '',
    className: dtGetClassName(element).slice(0, 500),
    text: dtGetText(element, 160)
  }
}

function dtGetElementIndex(element: HTMLElement) {
  if (!element.parentElement) return -1
  return Array.from(element.parentElement.children).indexOf(element)
}

function dtUpdateOutline(element: HTMLElement) {
  const outline = dtOutlineElement()
  const tooltip = dtTooltipElement()
  if (!outline || !tooltip) return

  const rect = element.getBoundingClientRect()
  outline.style.top = `${rect.top}px`
  outline.style.left = `${rect.left}px`
  outline.style.width = `${rect.width}px`
  outline.style.height = `${rect.height}px`
  outline.classList.add('is-visible')

  const vueInfo = dtFindVueComponent(element)
  tooltip.textContent = `${element.tagName.toLowerCase()} · ${vueInfo.file || '未定位到文件'}`
  tooltip.style.top = `${Math.max(8, rect.top - 34)}px`
  tooltip.style.left = `${Math.max(8, rect.left)}px`
  tooltip.classList.add('is-visible')
}

function dtGetClassName(element: HTMLElement) {
  return typeof element.className === 'string' ? element.className : element.getAttribute('class') || ''
}

function dtGetText(element: HTMLElement, maxLength: number) {
  return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function dtIsEditorElement(element: HTMLElement) {
  return Boolean(element.closest(`[${dtEditorAttr}]`))
}

function dtIsEditableElement(element: HTMLElement) {
  return element.matches('input, textarea, select, [contenteditable="true"]')
}

function dtStopEditorEvent(event: Event) {
  event.stopPropagation()
}

function dtOutlineElement() {
  return document.querySelector<HTMLElement>('.dt-ai-style-outline')
}

function dtTooltipElement() {
  return document.querySelector<HTMLElement>('.dt-ai-style-tooltip')
}

function dtPanelElement() {
  return document.querySelector<HTMLElement>('.dt-ai-style-panel')
}

function dtButtonElement() {
  return document.querySelector<HTMLElement>('.dt-ai-style-button')
}

function dtSetMessage(message: string) {
  const messageElement = document.querySelector<HTMLElement>('.dt-ai-style-message')
  if (messageElement) messageElement.textContent = message
}

function dtEscapeHtml(value: string) {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }

  return value.replace(/[&<>"]/g, (char) => escapeMap[char] || char)
}

function dtInjectStyle() {
  const style = document.createElement('style')
  style.setAttribute(dtEditorAttr, 'style')
  style.textContent = `
    .dt-ai-style-root {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .dt-ai-style-button {
      position: fixed;
      right: 32px;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 32px);
      z-index: 2147483647;
      width: 56px;
      height: 56px;
      pointer-events: auto;
      border: 0;
      padding: 0;
      color: #fff;
      background: transparent;
      cursor: grab;
      user-select: none;
      touch-action: none;
      -webkit-user-select: none;
    }
    .dt-ai-style-button.is-dragging {
      cursor: grabbing;
    }
    .dt-ai-style-button-glow {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      background: #6366f1;
      opacity: .4;
      filter: blur(12px);
      animation: dt-ai-style-pulse 1.8s ease-in-out infinite;
      transition: opacity .3s ease;
    }
    .dt-ai-style-button:hover .dt-ai-style-button-glow {
      opacity: .75;
    }
    .dt-ai-style-button-surface {
      position: relative;
      display: flex;
      width: 56px;
      height: 56px;
      align-items: center;
      justify-content: center;
      border: 2px solid rgb(255 255 255 / 20%);
      border-radius: 999px;
      background: linear-gradient(45deg, #4f46e5, #a855f7);
      box-shadow: 0 18px 36px rgb(99 102 241 / 30%);
      transform: translateZ(0);
      transition: transform .3s ease;
    }
    .dt-ai-style-button:hover .dt-ai-style-button-surface {
      transform: scale(1.1);
    }
    .dt-ai-style-button:active .dt-ai-style-button-surface,
    .dt-ai-style-button.is-dragging .dt-ai-style-button-surface {
      transform: scale(.95);
      transition: none;
    }
    .dt-ai-style-button-icon {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .dt-ai-style-button-dragging,
    .dt-ai-style-button-dragging * {
      cursor: grabbing !important;
      user-select: none !important;
    }
    @keyframes dt-ai-style-pulse {
      0%, 100% { opacity: .4; transform: scale(1); }
      50% { opacity: .68; transform: scale(1.08); }
    }
    .dt-ai-style-selecting * {
      cursor: crosshair !important;
    }
    .dt-ai-style-outline {
      position: fixed;
      z-index: 2147483646;
      display: none;
      pointer-events: none;
      border: 2px solid #2563eb;
      border-radius: 12px;
      background: rgb(37 99 235 / 8%);
      box-shadow: 0 0 0 9999px rgb(15 23 42 / 8%);
    }
    .dt-ai-style-outline.is-visible {
      display: block;
    }
    .dt-ai-style-tooltip {
      position: fixed;
      z-index: 2147483647;
      display: none;
      max-width: min(320px, calc(100vw - 24px));
      pointer-events: none;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      border-radius: 999px;
      padding: 7px 10px;
      color: #fff;
      background: rgb(15 23 42 / 92%);
      box-shadow: 0 10px 30px rgb(15 23 42 / 22%);
      font-size: 12px;
      font-weight: 700;
    }
    .dt-ai-style-tooltip.is-visible {
      display: block;
    }
    .dt-ai-style-panel {
      position: fixed;
      right: 12px;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
      z-index: 2147483647;
      display: none;
      width: min(420px, calc(100vw - 24px));
      max-height: calc(100vh - 24px);
      overflow-y: auto;
      pointer-events: auto;
      border: 1px solid rgb(226 232 240 / 90%);
      border-radius: 28px;
      padding: 16px;
      color: #0f172a;
      background: rgb(255 255 255 / 96%);
      box-shadow: 0 24px 70px rgb(15 23 42 / 24%);
      backdrop-filter: blur(16px);
    }
    .dt-ai-style-panel.is-open {
      display: block;
    }
    .dt-ai-style-panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    .dt-ai-style-panel.is-dragging .dt-ai-style-panel-header {
      cursor: grabbing;
    }
    .dt-ai-style-dragging,
    .dt-ai-style-dragging * {
      cursor: grabbing !important;
      user-select: none !important;
    }
    .dt-ai-style-panel-title {
      font-size: 16px;
      font-weight: 900;
    }
    .dt-ai-style-panel-subtitle,
    .dt-ai-style-target-label,
    .dt-ai-style-message {
      margin-top: 4px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.5;
    }
    .dt-ai-style-close,
    .dt-ai-style-cancel,
    .dt-ai-style-submit {
      border: 0;
      cursor: pointer;
      font-weight: 800;
    }
    .dt-ai-style-close {
      border-radius: 999px;
      padding: 8px 10px;
      color: #64748b;
      background: #f1f5f9;
      font-size: 12px;
    }
    .dt-ai-style-target {
      margin-bottom: 10px;
      border-radius: 18px;
      padding: 10px 12px;
      background: #f8fafc;
    }
    .dt-ai-style-target-main {
      margin-top: 2px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: #0f172a;
      font-size: 13px;
      font-weight: 900;
    }
    .dt-ai-style-target-class {
      margin-top: 4px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: #64748b;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .dt-ai-style-input {
      display: block;
      width: 100%;
      min-height: 104px;
      box-sizing: border-box;
      resize: vertical;
      border: 1px solid #dbeafe;
      border-radius: 18px;
      padding: 12px;
      color: #0f172a;
      background: #fff;
      outline: none;
      font-size: 16px;
      line-height: 1.5;
    }
    .dt-ai-style-input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgb(37 99 235 / 12%);
    }
    .dt-ai-style-actions {
      display: flex;
      gap: 10px;
      margin-top: 12px;
    }
    .dt-ai-style-cancel,
    .dt-ai-style-submit {
      flex: 1;
      min-height: 44px;
      border-radius: 16px;
      font-size: 14px;
    }
    .dt-ai-style-cancel {
      color: #475569;
      background: #f1f5f9;
    }
    .dt-ai-style-submit {
      color: #fff;
      background: #2563eb;
      box-shadow: 0 14px 34px rgb(37 99 235 / 22%);
    }
    .dt-ai-style-submit:disabled {
      cursor: not-allowed;
      opacity: .6;
    }
    @media (prefers-color-scheme: dark) {
      .dt-ai-style-panel {
        border-color: rgb(46 60 82 / 90%);
        color: #f8fafc;
        background: rgb(26 37 54 / 96%);
      }
      .dt-ai-style-panel-title,
      .dt-ai-style-target-main {
        color: #f8fafc;
      }
      .dt-ai-style-panel-subtitle,
      .dt-ai-style-target-label,
      .dt-ai-style-message,
      .dt-ai-style-target-class {
        color: #94a3b8;
      }
      .dt-ai-style-close,
      .dt-ai-style-cancel,
      .dt-ai-style-target {
        color: #cbd5e1;
        background: #253143;
      }
      .dt-ai-style-input {
        border-color: #2e3c52;
        color: #f8fafc;
        background: #101725;
      }
    }
  `
  document.head.appendChild(style)
}
