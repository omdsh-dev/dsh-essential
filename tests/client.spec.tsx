// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ variant: _variant, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string
    children?: ReactNode
  }) => <button type="button" {...props}>{children}</button>,
  Modal: ({ open, title, children, footer }: {
    open: boolean
    title: string
    children?: ReactNode
    footer?: ReactNode
  }) => open
    ? <div role="dialog" aria-label={title}>{children}<div>{footer}</div></div>
    : null,
}))

import {
  DeleteConversationMenuItem,
  type DeleteConversationMenuItemProps,
} from '../src/client/DeleteConversationMenuItem.tsx'
import {
  apply,
  type DeleteConversationMenuInjected,
  type DeletionRequestResult,
} from '../src/client/index.ts'

afterEach(() => {
  cleanup()
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
  queueDeletion: DeleteConversationMenuInjected['queueDeletion'] = vi.fn(() => Promise.resolve({ kind: 'hidden' } as const)),
) {
  const closeMenu = vi.fn()
  const props = {
    sessionId: 'session-1' as SessionId,
    title: '设计讨论',
    closeMenu,
    queueDeletion,
    t: translate,
  } as unknown as DeleteConversationMenuItemProps
  render(<DeleteConversationMenuItem {...props} />)
  return { closeMenu, queueDeletion }
}

describe('DeleteConversationMenuItem', () => {
  it('opens a Web confirmation card and cancels without queueing', () => {
    const { closeMenu, queueDeletion } = renderItem()

    fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }))

    const dialog = screen.getByRole('dialog', { name: '确认删除该对话吗？' })
    expect(closeMenu).toHaveBeenCalledTimes(1)
    expect(queueDeletion).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(closeMenu).toHaveBeenCalledTimes(1)
  })

  it('queues the selected Session from the card and closes on success', async () => {
    const { closeMenu, queueDeletion } = renderItem()

    fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }))
    const dialog = screen.getByRole('dialog', { name: '确认删除该对话吗？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除对话' }))

    expect(queueDeletion).toHaveBeenCalledWith('session-1')
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(closeMenu).toHaveBeenCalledTimes(1)
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

describe('browser plugin apply', () => {
  it('mounts the root Remote, registers the menu contribution, and maps outcomes', async () => {
    const queue = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { sessionId: 's1', state: 'queued' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'offline', message: 'disconnected' } })
    const mount = vi.fn(async () => async () => {})
    const localeRegister = vi.fn(() => () => {})
    const archiveSession = vi.fn(async () => {})
    let options: {
      name: string
      id: string
      order: number
      inject: () => { queueDeletion: (sessionId: SessionId) => Promise<DeletionRequestResult> }
    } | undefined
    const register = vi.fn((candidate: typeof options) => {
      options = candidate
      return () => {}
    })
    const ctx = {
      effect: (install: () => unknown) => { install() },
      inject: (_services: string[], install: (scope: ClientContext) => unknown) => { install(ctx as unknown as ClientContext) },
      locale: { register: localeRegister },
      remote: { $mount: mount, conversationDeletion: { queue } },
      workspaces: { archiveSession },
      slots: {
        inject: (_name: string, install: () => unknown) => { install() },
        register,
      },
    } as unknown as ClientContext

    await apply(ctx)

    expect(localeRegister).toHaveBeenCalledWith('essentialDeletion', expect.any(Object))
    expect(options).toMatchObject({
      name: 'sidebar.workspaces.sessionMenu',
      id: 'essential.deleteConversation',
      order: 1000,
    })
    const queueDeletion = options?.inject().queueDeletion
    expect(queueDeletion).toBeDefined()
    await expect(queueDeletion?.('s1' as SessionId)).resolves.toEqual({ kind: 'hidden' })
    await expect(queueDeletion?.('s2' as SessionId)).resolves.toEqual({ kind: 'failed', message: 'disconnected (offline)' })
    expect(mount).toHaveBeenCalledWith(expect.objectContaining({ package: '@deepseek-ai/dsh-essential' }))
    expect(queue).toHaveBeenNthCalledWith(1, 's1')
    expect(archiveSession).toHaveBeenCalledTimes(1)
    expect(archiveSession).toHaveBeenCalledWith('s1')
  })

  it('keeps a successful deletion queued when immediate hiding fails', async () => {
    const queue = vi.fn().mockResolvedValue({ ok: true, value: { sessionId: 's1', state: 'queued' } })
    const archiveSession = vi.fn()
      .mockRejectedValueOnce(new Error('archive unavailable'))
      .mockRejectedValueOnce('archive disconnected')
    let queueDeletion: DeleteConversationMenuInjected['queueDeletion'] | undefined
    const ctx = {
      effect: (install: () => unknown) => { install() },
      inject: (_services: string[], install: (scope: ClientContext) => unknown) => { install(ctx as unknown as ClientContext) },
      locale: { register: () => () => {} },
      remote: {
        $mount: async () => async () => {},
        conversationDeletion: { queue },
      },
      workspaces: { archiveSession },
      slots: {
        inject: (_name: string, install: () => unknown) => { install() },
        register: (options: { inject: () => DeleteConversationMenuInjected }) => {
          queueDeletion = options.inject().queueDeletion
          return () => {}
        },
      },
    } as unknown as ClientContext

    await apply(ctx)

    await expect(queueDeletion?.('s1' as SessionId)).resolves.toEqual({ kind: 'queued', message: 'archive unavailable' })
    await expect(queueDeletion?.('s2' as SessionId)).resolves.toEqual({ kind: 'queued', message: 'archive disconnected' })
  })
})
