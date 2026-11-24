/** Browser half: structured Session-row action and root confirmation dialog. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import deletionRemote, { type ConversationDeletionRemoteApi } from '../remote.ts'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { DeletionDialog, type DeletionDialogInjected } from './DeletionDialog.tsx'
import { en, zh, type EssentialDeletionKey } from './locales.ts'

export type { EssentialDeletionKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the recoverable Session deletion menu action. */
    essentialDeletion: EssentialDeletionKey
  }
}

/** Browser-visible outcome after the Host has considered a deletion request. */
export type DeletionRequestResult =
  | { kind: 'hidden' }
  | { kind: 'queued'; message: string }
  | { kind: 'failed'; message: string }

const NS = 'essentialDeletion'

/** Required browser services. */
export const inject = ['remote', 'workspaces', 'locale', 'contextMenus', 'slots']

/**
 * Queue a deletion through the Host Remote, then archive its list projection.
 * @param conversationDeletion - root Remote available to historical rows.
 * @param archiveSession - Workspace projection action.
 * @param sessionId - target Session.
 * @returns combined queue-and-hide outcome.
 */
export async function queueAndHideConversation(
  conversationDeletion: ConversationDeletionRemoteApi,
  archiveSession: (sessionId: SessionId) => Promise<void>,
  sessionId: SessionId,
): Promise<DeletionRequestResult> {
  const response = await conversationDeletion.queue(sessionId)
  if (!response.ok) {
    return { kind: 'failed', message: `${response.error.message} (${response.error.code})` }
  }
  try {
    await archiveSession(sessionId)
  } catch (reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason)
    return { kind: 'queued', message }
  }
  return { kind: 'hidden' }
}

/**
 * Install the root Remote, Session menu action, and confirmation dialog.
 * @param ctx - browser Cordis root.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(deletionRemote)
  ctx.effect(() => disposeRemote, 'dsh-essential: deletion Remote')
  ctx.inject(['remote.conversationDeletion'], (remoteCtx) => {
    const conversationDeletion = (remoteCtx.remote as typeof remoteCtx.remote & {
      conversationDeletion: ConversationDeletionRemoteApi
    }).conversationDeletion
    remoteCtx.effect(
      () => remoteCtx.locale.register(NS, { zh, en }),
      'dsh-essential: dictionaries',
    )
    const queueDeletion = (sessionId: SessionId) => queueAndHideConversation(
      conversationDeletion,
      id => remoteCtx.workspaces.archiveSession(id),
      sessionId,
    )
    const target = createSnapshotStore<SessionId | null>(null)
    const t = remoteCtx.locale.bind(NS)
    remoteCtx.slots.inject('contextMenu.icon', () => remoteCtx.slots.register({
      name: 'contextMenu.icon', key: 'essential.delete',
    }, IconTrashOutlineRegular))
    remoteCtx.effect(() => remoteCtx.contextMenus.register({
      id: 'essential.delete',
      target: 'session',
      order: 700,
      observe: () => [remoteCtx.locale, target],
      resolve: ({ sessionId }) => [{
        id: 'delete',
        label: t('menu.delete'),
        icon: { key: 'essential.delete' },
        danger: true,
        disabled: target.getSnapshot() !== null,
        run: () => { if (target.getSnapshot() === null) target.set(sessionId) },
      }],
    }), 'dsh-essential: Session deletion menu')
    remoteCtx.slots.inject('shell.overlay', () => remoteCtx.slots.register({
      name: 'shell.overlay',
      id: 'essential.delete',
      locale: NS,
      inject: (): DeletionDialogInjected => ({
        hooks: { deletionTarget: target },
        close: () => { target.set(null) },
        queueDeletion,
      }),
    }, DeletionDialog))
  })
}
