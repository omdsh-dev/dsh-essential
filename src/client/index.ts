/** Browser half: Session-row deletion action over the commands Remote. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import deletionRemote, { type ConversationDeletionRemoteApi } from '../remote.ts'
import { installDomSessionMenu } from './dom-menu.tsx'
import { en, zh, type EssentialDeletionKey } from './locales.ts'

export type { DeleteConversationMenuItemProps } from './DeleteConversationMenuItem.tsx'
export type { DomSessionMenuOptions } from './dom-menu.tsx'
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
export const inject = ['remote', 'workspaces', 'sessions', 'locale']

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
 * Install the root Remote and the plugin-owned Session-menu DOM adapter.
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
    // This mixed host/browser package sees both Cordis `sessions` declarations
    // during declaration generation. The browser runtime provides the
    // observable client face here; narrow it at the platform boundary.
    const sessionList = (remoteCtx.sessions as unknown as {
      list: { getSnapshot(): SessionListState }
    }).list
    remoteCtx.effect(() => installDomSessionMenu({
      sessions: sessionList,
      queueDeletion,
      t: remoteCtx.locale.bind(NS),
    }), 'dsh-essential: Session menu DOM adapter')
  })
}
