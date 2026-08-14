/** Destructive action contributed to the Workspace Session-row menu. */

import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeleteConversationMenuInjected } from './index.ts'

/** Fully composed props for the row-menu contribution. */
export type DeleteConversationMenuItemProps =
  PropsRuntime<'sidebar.workspaces.sessionMenu'>
  & InjectFace<DeleteConversationMenuInjected>
  & PropsLocale<'essentialDeletion'>

/**
 * Confirm and queue deletion for one Session row in a Web-native card.
 * @param props - row identity, owner close callback, command callback, and locale seat.
 * @returns destructive menu button plus its controlled confirmation card.
 */
export function DeleteConversationMenuItem({
  sessionId,
  closeMenu,
  queueDeletion,
  t,
}: DeleteConversationMenuItemProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const closeDialog = (): void => {
    if (pending) return
    setOpen(false)
    setError(null)
  }

  const confirmDeletion = (): void => {
    if (pending) return
    setPending(true)
    setError(null)
    void queueDeletion(sessionId).then((result) => {
      if (result.kind === 'hidden') {
        setOpen(false)
        return
      }
      setPending(false)
      setError(result.kind === 'queued'
        ? t('queued.visible', { message: result.message })
        : t('failed', { message: result.message }))
    }, (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason)
      setPending(false)
      setError(t('failed', { message }))
    })
  }

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="dsh-session-menu-item dsh-session-menu-item-danger"
        onClick={() => {
          setError(null)
          setOpen(true)
          closeMenu()
        }}
      >
        <span className="dsh-session-menu-item-icon" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 4.5h9M6 2.75h4M5 4.5l.5 8.25h5l.5-8.25M6.75 6.5v4.25M9.25 6.5v4.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span>{t('menu.delete')}</span>
      </button>
      <Modal
        open={open}
        onClose={closeDialog}
        closeLabel={t('close')}
        title={t('confirm')}
        footer={(
          <>
            <Button variant="outline" disabled={pending} onClick={closeDialog}>{t('cancel')}</Button>
            <Button variant="primary" disabled={pending} onClick={confirmDeletion}>
              {pending ? t('pending') : t('menu.delete')}
            </Button>
          </>
        )}
      >
        {pending ? <div role="status">{t('pending')}</div> : null}
        {error === null ? null : <div role="alert">{error}</div>}
      </Modal>
    </>
  )
}
