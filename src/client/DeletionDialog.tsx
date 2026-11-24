/** Root-owned confirmation for a stable, captured Session identity. */

import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeletionRequestResult } from './index.ts'

export interface DeletionDialogInjected {
  hooks: { deletionTarget: ObservableSnapshot<SessionId | null> }
  close: () => void
  queueDeletion: (sessionId: SessionId) => Promise<DeletionRequestResult>
}

type DeletionDialogProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'essentialDeletion'> & InjectFace<DeletionDialogInjected>

type ConfirmationProps = Pick<DeletionDialogProps, 't' | 'close' | 'queueDeletion' | 'useDeletionTarget'>

export function DeletionDialog({ useDeletionTarget, ...props }: ConfirmationProps) {
  const sessionId = useDeletionTarget(value => value)
  return sessionId === null ? null : <ConfirmDeletion key={sessionId} {...props} sessionId={sessionId} />
}

function ConfirmDeletion({ sessionId, close, queueDeletion, t }: Omit<ConfirmationProps, 'useDeletionTarget'> & {
  sessionId: SessionId
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const closeDialog = (): void => {
    if (pending) return
    close()
  }

  const confirmDeletion = (): void => {
    if (pending) return
    setPending(true)
    setError(null)
    void queueDeletion(sessionId).then((result) => {
      if (result.kind === 'hidden') {
        close()
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
    <Modal
      open={true}
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
  )
}
