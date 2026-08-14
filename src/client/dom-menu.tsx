/** Plugin-owned DOM adapter for the Host's private Session row menu. */

import { createRoot, type Root } from 'react-dom/client'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { DeleteConversationMenuItem } from './DeleteConversationMenuItem.tsx'
import type { DeletionRequestResult } from './index.ts'

const STYLE_ATTRIBUTE = 'data-dsh-essential-menu-style'
const EXTENSION_ATTRIBUTE = 'data-dsh-essential-session-menu'
const SESSION_ROW_SELECTOR = '[role="treeitem"][aria-selected]'
const MENU_SELECTOR = '[role="menu"]'
const REACT_FIBER_PREFIX = '__reactFiber$'
const TARGET_TTL_MS = 1_500

const MENU_STYLE = `
.dsh-essential-menu-extension {
  flex: none;
  display: flex;
  flex-direction: column;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh-essential-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-state-error-primary);
  text-align: left;
}
.dsh-essential-menu-item:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
.dsh-essential-menu-item-icon {
  display: inline-flex;
  flex: none;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-state-error-primary);
}
`

interface SnapshotSource<T> {
  getSnapshot(): T
}

/** Runtime inputs needed by the DOM menu adapter. */
export interface DomSessionMenuOptions {
  /** Live Session list, used only as a safe unique-title fallback. */
  sessions: SnapshotSource<SessionListState>
  /** Queue and immediately hide the selected Session. */
  queueDeletion: (sessionId: SessionId) => Promise<DeletionRequestResult>
  /** Namespace-bound translation function. */
  t: TranslateNS<'essentialDeletion'>
}

interface PendingTarget {
  anchor: HTMLButtonElement
  sessionId: SessionId
  capturedAt: number
}

interface MenuBridge {
  activated: boolean
  menuContainer: HTMLDivElement
  controllerContainer: HTMLDivElement
  root: Root
  disposePointerBridge: () => void
  dispose: () => void
}

interface FiberLike {
  return?: FiberLike | null | undefined
  memoizedProps?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Read the exact Session identity retained by the React owner chain. This is
 * intentionally isolated: the open-source Host does not expose a row id in
 * the DOM or a menu extension slot yet.
 */
function sessionIdFromReactOwner(element: HTMLElement): SessionId | undefined {
  const fiberKey = Object.getOwnPropertyNames(element).find(key => key.startsWith(REACT_FIBER_PREFIX))
  if (fiberKey === undefined) return undefined
  let fiber = (element as unknown as Record<string, unknown>)[fiberKey] as FiberLike | undefined
  for (let depth = 0; fiber !== undefined && fiber !== null && depth < 32; depth += 1) {
    const props = fiber.memoizedProps
    if (isRecord(props) && typeof props.onArchive === 'function' && isRecord(props.node)) {
      const id = props.node.id
      if (typeof id === 'string' && id.length > 0) return id as SessionId
    }
    fiber = fiber.return ?? undefined
  }
  return undefined
}

/** Resolve a unique visible title without guessing when duplicate titles exist. */
function sessionIdFromUniqueTitle(
  row: Element,
  anchor: HTMLButtonElement,
  sessions: SnapshotSource<SessionListState>,
): SessionId | undefined {
  const title = [...row.children]
    .find(child => !child.contains(anchor) && child.textContent?.trim() !== '')
    ?.textContent?.trim()
  if (title === undefined || title === '') return undefined
  const snapshot = sessions.getSnapshot()
  const matches = snapshot.ids.filter((id) => {
    const summary = snapshot.byId[id]
    return summary !== undefined && !summary.blank
      && (summary.displayTitle === title || summary.title === title)
  })
  return matches.length === 1 ? matches[0] : undefined
}

function resolveSessionId(
  anchor: HTMLButtonElement,
  row: Element,
  sessions: SnapshotSource<SessionListState>,
): SessionId | undefined {
  return sessionIdFromReactOwner(anchor) ?? sessionIdFromUniqueTitle(row, anchor, sessions)
}

function addedMenus(records: MutationRecord[]): HTMLElement[] {
  const menus = new Set<HTMLElement>()
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof HTMLElement)) continue
      if (node.matches(MENU_SELECTOR)) menus.add(node)
      for (const menu of node.querySelectorAll<HTMLElement>(MENU_SELECTOR)) menus.add(menu)
    }
  }
  return [...menus]
}

function installStyles(rootDocument: Document): () => void {
  const existing = rootDocument.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`)
  if (existing !== null) return () => {}
  const style = rootDocument.createElement('style')
  style.setAttribute(STYLE_ATTRIBUTE, '')
  style.textContent = MENU_STYLE
  rootDocument.head.append(style)
  return () => { style.remove() }
}

/**
 * Observe Host Session action menus and mount the deletion action into the
 * menu currently opened from a semantic Session tree row.
 *
 * The adapter fails closed: if an exact id cannot be read from React's owner
 * chain, only a unique title match is accepted. Ambiguous rows receive no
 * destructive action.
 *
 * @param options - Session identity source, deletion action, and translations.
 * @returns disposer for listeners, observer, styles, and every mounted React root.
 */
export function installDomSessionMenu(options: DomSessionMenuOptions): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const rootDocument = document
  const disposeStyles = installStyles(rootDocument)
  const suppressedAnchors = new WeakSet<HTMLButtonElement>()
  const bridges = new Set<MenuBridge>()
  let pendingTarget: PendingTarget | undefined
  let disposed = false

  const disposeBridge = (bridge: MenuBridge): void => {
    if (!bridges.delete(bridge)) return
    bridge.disposePointerBridge()
    bridge.root.unmount()
    bridge.menuContainer.remove()
    bridge.controllerContainer.remove()
  }

  const mountIntoMenu = (menu: HTMLElement, target: PendingTarget): void => {
    if (menu.hasAttribute(EXTENSION_ATTRIBUTE)) return
    const viewport = menu.firstElementChild
    if (!(viewport instanceof HTMLElement)) return
    menu.setAttribute(EXTENSION_ATTRIBUTE, '')
    const menuContainer = rootDocument.createElement('div')
    menuContainer.className = 'dsh-essential-menu-extension'
    menuContainer.setAttribute(EXTENSION_ATTRIBUTE, target.sessionId)
    viewport.append(menuContainer)
    // The controller must not live under the Host menu. That subtree may be
    // removed during the action click before the Modal has committed.
    const controllerContainer = rootDocument.createElement('div')
    controllerContainer.setAttribute('data-dsh-essential-dialog-controller', target.sessionId)
    rootDocument.body.append(controllerContainer)
    const root = createRoot(controllerContainer)
    const onHostPointerOut = (event: PointerEvent): void => {
      const from = event.target
      const to = event.relatedTarget
      if (!(from instanceof Node) || !(to instanceof Node)) return
      const fromHostBoundary = menu.contains(from) || target.anchor.contains(from)
      if (!fromHostBoundary || menuContainer.contains(from) || !menuContainer.contains(to)) return
      // React's enter/leave plugin follows Fiber ownership rather than the
      // physical DOM. Crossing from a Host-owned row into our portaled row is
      // therefore misclassified as leaving the whole Host menu. Keep this one
      // transition from reaching the Host's delegated pointerout listener.
      event.stopPropagation()
    }
    const onPluginPointerOut = (event: PointerEvent): void => {
      if (!target.anchor.isConnected || !menu.isConnected) return
      const to = event.relatedTarget
      if (to instanceof Node && menuContainer.contains(to)) return
      const PointerBoundaryEvent = rootDocument.defaultView?.PointerEvent
        ?? rootDocument.defaultView?.MouseEvent
      if (PointerBoundaryEvent === undefined) return
      // Hand a real exit back to the Host boundary. If relatedTarget belongs
      // to the Host menu, React keeps the boundary entered; if it is outside,
      // the Host arms its normal pointer grace.
      target.anchor.dispatchEvent(new PointerBoundaryEvent('pointerout', {
        bubbles: true,
        composed: true,
        relatedTarget: event.relatedTarget,
      }))
    }
    rootDocument.addEventListener('pointerout', onHostPointerOut, true)
    menuContainer.addEventListener('pointerout', onPluginPointerOut)
    const bridge: MenuBridge = {
      activated: false,
      menuContainer,
      controllerContainer,
      root,
      disposePointerBridge: () => {
        rootDocument.removeEventListener('pointerout', onHostPointerOut, true)
        menuContainer.removeEventListener('pointerout', onPluginPointerOut)
      },
      dispose: () => {},
    }
    bridge.dispose = () => { disposeBridge(bridge) }
    bridges.add(bridge)
    root.render(
      <DeleteConversationMenuItem
        sessionId={target.sessionId}
        menuContainer={menuContainer}
        onActivate={() => { bridge.activated = true }}
        keepMenuOpen={() => {
          // Some browser transitions cross React roots with a null
          // relatedTarget, so the boundary bridge cannot classify them.
          // Re-enter the Host trigger to cancel any armed pointer grace.
          const PointerBoundaryEvent = rootDocument.defaultView?.PointerEvent
            ?? rootDocument.defaultView?.MouseEvent
          if (PointerBoundaryEvent === undefined) return
          target.anchor.dispatchEvent(new PointerBoundaryEvent('pointerover', {
            bubbles: true,
            composed: true,
          }))
        }}
        queueDeletion={options.queueDeletion}
        t={options.t}
        closeMenu={() => {
          // The Host can already have closed the menu through blur or
          // pointer-leave. Its anchor is a toggle, so clicking it after that
          // point would reopen the menu and corrupt the next interaction.
          if (!menu.isConnected) return
          suppressedAnchors.add(target.anchor)
          target.anchor.click()
          queueMicrotask(() => { suppressedAnchors.delete(target.anchor) })
        }}
        onFinished={() => { queueMicrotask(bridge.dispose) }}
      />,
    )
  }

  const onDocumentClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('button')
    if (!(anchor instanceof HTMLButtonElement) || suppressedAnchors.has(anchor)) return
    const row = anchor.closest(SESSION_ROW_SELECTOR)
    if (row === null) return
    const sessionId = resolveSessionId(anchor, row, options.sessions)
    pendingTarget = sessionId === undefined
      ? undefined
      : { anchor, sessionId, capturedAt: performance.now() }
  }

  const observer = new MutationObserver((records) => {
    for (const bridge of [...bridges]) {
      if (!bridge.menuContainer.isConnected && !bridge.activated) bridge.dispose()
    }
    const target = pendingTarget
    if (target === undefined) return
    if (performance.now() - target.capturedAt > TARGET_TTL_MS) {
      pendingTarget = undefined
      return
    }
    const menu = addedMenus(records).find(candidate => !candidate.hasAttribute(EXTENSION_ATTRIBUTE))
    if (menu === undefined) return
    pendingTarget = undefined
    mountIntoMenu(menu, target)
  })

  rootDocument.addEventListener('click', onDocumentClick, true)
  observer.observe(rootDocument.body, { childList: true, subtree: true })

  return () => {
    if (disposed) return
    disposed = true
    rootDocument.removeEventListener('click', onDocumentClick, true)
    observer.disconnect()
    for (const bridge of [...bridges]) bridge.dispose()
    disposeStyles()
  }
}
