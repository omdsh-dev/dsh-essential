// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ClientContext, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant: _variant, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string
    children?: ReactNode
  }) => <button type="button" {...props}>{children}</button>,
  Modal: ({ open, title, children, footer, onClose: _onClose }: {
    open: boolean
    title: string
    children?: ReactNode
    footer?: ReactNode
    onClose?: () => void
  }) => open
    ? <div role="dialog" aria-label={title}>{children}<div>{footer}</div></div>
    : null,
}))

import {
  DeleteConversationMenuItem,
  type DeleteConversationMenuItemProps,
} from '../src/client/DeleteConversationMenuItem.tsx'
import { installDomSessionMenu } from '../src/client/dom-menu.tsx'
import {
  apply,
  queueAndHideConversation,
  type DeletionRequestResult,
} from '../src/client/index.ts'

const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  cleanup()
  document.head.querySelectorAll('[data-dsh-essential-menu-style]').forEach(node => { node.remove() })
  document.body.replaceChildren()
})

const translate: DeleteConversationMenuItemProps['t'] = ((key: string, params?: Record<string, unknown>) => {
  if (key === 'menu.delete') return '删除对话'
  if (key === 'confirm') return '确认删除该对话吗？'
  if (key === 'close') return '关闭'
  if (key === 'cancel') return '取消'
  if (key === 'pending') return '正在删除…'
  if (key === 'queued.visible') return `删除请求已加入队列，但暂时无法隐藏：${String(params?.message)}`
  return `无法删除对话：${String(params?.message)}`
}) as DeleteConversationMenuItemProps['t']

function renderItem(
  queueDeletion: DeleteConversationMenuItemProps['queueDeletion'] = vi.fn(() => Promise.resolve({ kind: 'hidden' } as const)),
) {
  const menuContainer = document.createElement('div')
  document.body.append(menuContainer)
  const onActivate = vi.fn()
  const keepMenuOpen = vi.fn()
  const closeMenu = vi.fn()
  const onFinished = vi.fn()
  render(<DeleteConversationMenuItem
    sessionId={'session-1' as SessionId}
    menuContainer={menuContainer}
    onActivate={onActivate}
    keepMenuOpen={keepMenuOpen}
    closeMenu={closeMenu}
    queueDeletion={queueDeletion}
    t={translate}
    onFinished={onFinished}
  />)
  return { closeMenu, keepMenuOpen, onActivate, onFinished, queueDeletion }
}

describe('DeleteConversationMenuItem', () => {
  it('opens a Web confirmation card and cancels without queueing', async () => {
    const { closeMenu, keepMenuOpen, onActivate, onFinished, queueDeletion } = renderItem()

    fireEvent.pointerOver(screen.getByRole('menuitem', { name: '删除对话' }))
    expect(keepMenuOpen).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }))

    const dialog = screen.getByRole('dialog', { name: '确认删除该对话吗？' })
    expect(onActivate).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(closeMenu).toHaveBeenCalledTimes(1) })
    expect(queueDeletion).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('queues the selected Session from the card and closes on success', async () => {
    const { onFinished, queueDeletion } = renderItem()

    fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }))
    const dialog = screen.getByRole('dialog', { name: '确认删除该对话吗？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除对话' }))

    expect(queueDeletion).toHaveBeenCalledWith('session-1')
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('pins the card and disables actions while deletion is pending', async () => {
    let resolveDeletion: ((value: DeletionRequestResult) => void) | undefined
    const queueDeletion = vi.fn(() => new Promise<DeletionRequestResult>((resolve) => { resolveDeletion = resolve }))
    renderItem(queueDeletion)

    fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }))
    const dialog = screen.getByRole('dialog', { name: '确认删除该对话吗？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除对话' }))

    expect(within(dialog).getByRole('status').textContent).toContain('正在删除…')
    expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: '正在删除…' }) as HTMLButtonElement).disabled).toBe(true)
    resolveDeletion?.({ kind: 'hidden' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('reports queued-but-visible, command, and transport failures inside the card', async () => {
    const queueDeletion = vi.fn()
      .mockResolvedValueOnce({ kind: 'queued', message: 'archive offline' } as const)
      .mockResolvedValueOnce({ kind: 'failed', message: 'storage offline' } as const)
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockRejectedValueOnce('socket closed')
    renderItem(queueDeletion)

    fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }))
    const dialog = screen.getByRole('dialog', { name: '确认删除该对话吗？' })
    const confirm = within(dialog).getByRole('button', { name: '删除对话' })
    fireEvent.click(confirm)
    await waitFor(() => { expect(within(dialog).getByRole('alert').textContent).toContain('删除请求已加入队列，但暂时无法隐藏：archive offline') })
    fireEvent.click(confirm)
    await waitFor(() => { expect(within(dialog).getByRole('alert').textContent).toContain('无法删除对话：storage offline') })
    fireEvent.click(confirm)
    await waitFor(() => { expect(within(dialog).getByRole('alert').textContent).toContain('无法删除对话：connection closed') })
    fireEvent.click(confirm)
    await waitFor(() => { expect(within(dialog).getByRole('alert').textContent).toContain('无法删除对话：socket closed') })
  })
})

function sessionState(rows: Array<{ id: string; title: string }>): SessionListState {
  return {
    ids: rows.map(row => row.id as SessionId),
    byId: Object.fromEntries(rows.map(row => [row.id, {
      id: row.id as SessionId,
      title: row.title,
      displayTitle: row.title,
      running: false,
      blank: false,
      updatedAt: 1,
    }])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function appendSessionRow(title: string, sessionId?: string): HTMLButtonElement {
  const row = document.createElement('div')
  row.setAttribute('role', 'treeitem')
  row.setAttribute('aria-selected', 'false')
  const status = document.createElement('span')
  const titleCell = document.createElement('span')
  titleCell.textContent = title
  const actions = document.createElement('span')
  const anchor = document.createElement('button')
  anchor.type = 'button'
  anchor.setAttribute('aria-label', `会话“${title}”的操作`)
  actions.append(anchor)
  row.append(status, titleCell, actions)
  document.body.append(row)
  if (sessionId !== undefined) {
    Object.defineProperty(anchor, '__reactFiber$test', {
      value: {
        memoizedProps: {},
        return: {
          memoizedProps: {
            node: { id: sessionId },
            onArchive: () => {},
          },
        },
      },
    })
  }
  return anchor
}

function appendHostMenu(): HTMLElement {
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  const viewport = document.createElement('div')
  viewport.setAttribute('role', 'presentation')
  const archive = document.createElement('button')
  archive.setAttribute('role', 'menuitem')
  archive.textContent = '归档会话'
  viewport.append(archive)
  menu.append(viewport)
  document.body.append(menu)
  return menu
}

describe('DOM Session menu adapter', () => {
  it('mounts against the exact React-owned row and retains the card after the Host menu closes', async () => {
    const queueDeletion = vi.fn(() => Promise.resolve({ kind: 'hidden' } as const))
    const anchor = appendSessionRow('设计讨论', 'session-1')
    let menu: HTMLElement | undefined
    let anchorClicks = 0
    anchor.addEventListener('click', () => {
      anchorClicks += 1
      if (anchorClicks > 1) menu?.remove()
    })
    const dispose = installDomSessionMenu({
      sessions: { getSnapshot: () => sessionState([{ id: 'session-1', title: '设计讨论' }]) },
      queueDeletion,
      t: translate,
    })
    disposers.push(dispose)

    fireEvent.click(anchor)
    menu = appendHostMenu()
    const deleteItem = await screen.findByRole('menuitem', { name: '删除对话' })
    expect(menu.getAttribute('data-dsh-essential-session-menu')).toBe('')

    fireEvent.click(deleteItem)
    const dialog = await screen.findByRole('dialog', { name: '确认删除该对话吗？' })
    await waitFor(() => { expect(anchorClicks).toBe(2) })
    expect(menu.isConnected).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: '删除对话' }))

    expect(queueDeletion).toHaveBeenCalledWith('session-1')
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('keeps the card alive when the Host removes its menu during the action click', async () => {
    const queueDeletion = vi.fn(() => Promise.resolve({ kind: 'hidden' } as const))
    const anchor = appendSessionRow('自动收起菜单', 'session-race')
    let anchorClicks = 0
    anchor.addEventListener('click', () => { anchorClicks += 1 })
    const dispose = installDomSessionMenu({
      sessions: { getSnapshot: () => sessionState([{ id: 'session-race', title: '自动收起菜单' }]) },
      queueDeletion,
      t: translate,
    })
    disposers.push(dispose)

    fireEvent.click(anchor)
    const menu = appendHostMenu()
    const deleteItem = await screen.findByRole('menuitem', { name: '删除对话' })
    menu.addEventListener('click', () => { menu.remove() })
    fireEvent.click(deleteItem)

    const dialog = await screen.findByRole('dialog', { name: '确认删除该对话吗？' })
    expect(menu.isConnected).toBe(false)
    expect(document.querySelector('[data-dsh-essential-dialog-controller="session-race"]')?.isConnected).toBe(true)
    await waitFor(() => { expect(anchorClicks).toBe(1) })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => {
      expect(document.querySelector('[data-dsh-essential-dialog-controller="session-race"]')).toBeNull()
    })
  })

  it('bridges pointer transitions between the Host menu and portaled delete row', async () => {
    const anchor = appendSessionRow('悬停菜单', 'session-hover')
    let hostPointerOuts = 0
    let hostPointerEnters = 0
    anchor.addEventListener('pointerout', () => { hostPointerOuts += 1 })
    anchor.addEventListener('pointerover', () => { hostPointerEnters += 1 })
    const dispose = installDomSessionMenu({
      sessions: { getSnapshot: () => sessionState([{ id: 'session-hover', title: '悬停菜单' }]) },
      queueDeletion: vi.fn(() => Promise.resolve({ kind: 'hidden' } as const)),
      t: translate,
    })
    disposers.push(dispose)

    fireEvent.click(anchor)
    const menu = appendHostMenu()
    let falseHostLeaves = 0
    menu.addEventListener('pointerout', () => { falseHostLeaves += 1 })
    const hostItem = menu.querySelector('[role="menuitem"]')
    expect(hostItem).not.toBeNull()
    const deleteItem = await screen.findByRole('menuitem', { name: '删除对话' })
    hostItem?.dispatchEvent(new MouseEvent('pointerout', {
      bubbles: true,
      relatedTarget: deleteItem,
    }))
    anchor.dispatchEvent(new MouseEvent('pointerout', {
      bubbles: true,
      relatedTarget: deleteItem,
    }))

    expect(falseHostLeaves).toBe(0)
    expect(hostPointerOuts).toBe(0)
    expect(menu.isConnected).toBe(true)
    fireEvent.pointerOver(deleteItem)
    expect(hostPointerEnters).toBe(1)
    fireEvent.pointerOut(deleteItem, { relatedTarget: document.body })
    expect(hostPointerOuts).toBeGreaterThan(0)
  })

  it('uses a unique visible title when the production DOM exposes no React owner', async () => {
    const queueDeletion = vi.fn(() => Promise.resolve({ kind: 'hidden' } as const))
    const anchor = appendSessionRow('唯一标题')
    const dispose = installDomSessionMenu({
      sessions: { getSnapshot: () => sessionState([
        { id: 'session-unique', title: '唯一标题' },
        { id: 'session-other', title: '另一个标题' },
      ]) },
      queueDeletion,
      t: translate,
    })
    disposers.push(dispose)

    fireEvent.click(anchor)
    appendHostMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除对话' }))
    const dialog = await screen.findByRole('dialog', { name: '确认删除该对话吗？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除对话' }))

    expect(queueDeletion).toHaveBeenCalledWith('session-unique')
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('fails closed when the Host exposes no owner identity and titles are ambiguous', async () => {
    const anchor = appendSessionRow('重复标题')
    const dispose = installDomSessionMenu({
      sessions: { getSnapshot: () => sessionState([
        { id: 'session-1', title: '重复标题' },
        { id: 'session-2', title: '重复标题' },
      ]) },
      queueDeletion: vi.fn(),
      t: translate,
    })
    disposers.push(dispose)

    fireEvent.click(anchor)
    appendHostMenu()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(screen.queryByRole('menuitem', { name: '删除对话' })).toBeNull()
  })
})

describe('browser plugin apply', () => {
  it('mounts the root Remote, locale, and DOM adapter without a Host menu slot', async () => {
    const mount = vi.fn(async () => async () => {})
    const localeRegister = vi.fn(() => () => {})
    const installed: Array<() => void> = []
    const ctx = {
      effect: (install: () => unknown) => {
        const result = install()
        if (typeof result === 'function') installed.push(result as () => void)
      },
      inject: (_services: string[], install: (scope: ClientContext) => unknown) => { install(ctx as unknown as ClientContext) },
      locale: { register: localeRegister, bind: () => translate },
      remote: { $mount: mount, conversationDeletion: { queue: vi.fn() } },
      workspaces: { archiveSession: vi.fn() },
      sessions: { list: { getSnapshot: () => sessionState([]) } },
    } as unknown as ClientContext

    await apply(ctx)
    disposers.push(...installed)

    expect(localeRegister).toHaveBeenCalledWith('essentialDeletion', expect.any(Object))
    expect(document.head.querySelector('[data-dsh-essential-menu-style]')).not.toBeNull()
    expect(mount).toHaveBeenCalledWith(expect.objectContaining({ package: '@deepseek-ai/dsh-essential' }))
  })

  it('maps queue, archive, rejection, and partial-success outcomes', async () => {
    const queue = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { sessionId: 's1', state: 'queued' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'offline', message: 'disconnected' } })
      .mockResolvedValue({ ok: true, value: { sessionId: 's3', state: 'queued' } })
    const archiveSession = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('archive unavailable'))
      .mockRejectedValueOnce('archive disconnected')

    await expect(queueAndHideConversation({ queue }, archiveSession, 's1' as SessionId))
      .resolves.toEqual({ kind: 'hidden' })
    await expect(queueAndHideConversation({ queue }, archiveSession, 's2' as SessionId))
      .resolves.toEqual({ kind: 'failed', message: 'disconnected (offline)' })
    await expect(queueAndHideConversation({ queue }, archiveSession, 's3' as SessionId))
      .resolves.toEqual({ kind: 'queued', message: 'archive unavailable' })
    await expect(queueAndHideConversation({ queue }, archiveSession, 's4' as SessionId))
      .resolves.toEqual({ kind: 'queued', message: 'archive disconnected' })
  })
})
