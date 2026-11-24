// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconTrashOutlineRegular: () => null,
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

import { DeletionDialog } from '../src/client/DeletionDialog.tsx'
import { apply, queueAndHideConversation, type DeletionRequestResult } from '../src/client/index.ts'

afterEach(cleanup)

const translate = ((key: string, params?: Record<string, unknown>) => {
  if (key === 'menu.delete') return '删除对话'
  if (key === 'confirm') return '确认删除该对话吗？'
  if (key === 'close') return '关闭'
  if (key === 'cancel') return '取消'
  if (key === 'pending') return '正在删除…'
  if (key === 'queued.visible') return `删除请求已加入队列，但暂时无法隐藏：${String(params?.message)}`
  return `无法删除对话：${String(params?.message)}`
}) as Parameters<typeof DeletionDialog>[0]['t']

function renderDialog(
  queueDeletion = vi.fn<Parameters<typeof DeletionDialog>[0]['queueDeletion']>()
    .mockResolvedValue({ kind: 'hidden' }),
) {
  const sessionId = 'session-1' as SessionId
  const close = vi.fn(() => view.rerender(<DeletionDialog
    t={translate} useDeletionTarget={select => select(null)} close={close} queueDeletion={queueDeletion}
  />))
  const view = render(<DeletionDialog
    t={translate} useDeletionTarget={select => select(sessionId)} close={close} queueDeletion={queueDeletion}
  />)
  return { close, queueDeletion, dialog: screen.getByRole('dialog', { name: '确认删除该对话吗？' }) }
}

describe('DeletionDialog', () => {
  it('cancels without queueing', () => {
    const { close, dialog, queueDeletion } = renderDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(queueDeletion).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('queues the captured Session and closes after success', async () => {
    const { dialog, queueDeletion } = renderDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除对话' }))
    expect(queueDeletion).toHaveBeenCalledWith('session-1')
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('pins a pending request and renders a partial failure', async () => {
    let resolveDeletion!: (value: DeletionRequestResult) => void
    const queueDeletion = vi.fn(() => new Promise<DeletionRequestResult>(resolve => { resolveDeletion = resolve }))
    const { close, dialog } = renderDialog(queueDeletion)
    fireEvent.click(within(dialog).getByRole('button', { name: '删除对话' }))
    expect(within(dialog).getByRole('status').textContent).toContain('正在删除')
    expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    resolveDeletion({ kind: 'queued', message: 'archive unavailable' })
    expect((await within(dialog).findByRole('alert')).textContent).toContain('archive unavailable')
    expect(close).not.toHaveBeenCalled()
  })
})

describe('browser plugin apply', () => {
  it('mounts the root Remote and contributes a native Session action and overlay', async () => {
    const mount = vi.fn(async () => async () => {})
    const registerMenu = vi.fn(() => () => {})
    const registerSlot = vi.fn()
    const localeRegister = vi.fn(() => () => {})
    const ctx = {
      effect: (install: () => unknown) => { install() },
      inject: (_services: string[], install: (scope: ClientContext) => unknown) => { install(ctx as unknown as ClientContext) },
      locale: { register: localeRegister, bind: () => translate },
      remote: { $mount: mount, conversationDeletion: { queue: vi.fn() } },
      workspaces: { archiveSession: vi.fn() },
      contextMenus: { register: registerMenu },
      slots: { inject: (_name: string, setup: () => unknown) => setup(), register: registerSlot },
    } as unknown as ClientContext

    await apply(ctx)

    expect(localeRegister).toHaveBeenCalledWith('essentialDeletion', expect.any(Object))
    expect(registerMenu).toHaveBeenCalledWith(expect.objectContaining({ target: 'session', id: 'essential.delete' }))
    expect(registerSlot).toHaveBeenCalledWith(expect.objectContaining({ name: 'shell.overlay' }), DeletionDialog)
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
