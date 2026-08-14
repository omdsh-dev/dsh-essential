/** Browser half: Session-row deletion action over the commands Remote. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import deletionRemote, { type ConversationDeletionRemoteApi } from '../remote.ts'
import type {} from './contract.ts'
import { DeleteConversationMenuItem } from './DeleteConversationMenuItem.tsx'
import { en, zh, type EssentialDeletionKey } from './locales.ts'

export type { SessionMenuOwnerProps } from './contract.ts'
export type { EssentialDeletionKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the recoverable Session deletion menu action. */
    essentialDeletion: EssentialDeletionKey
  }
}

/** Business face injected into the menu contribution. */
export interface DeleteConversationMenuInjected {
  /**
   * Queue the selected Session through the Host command channel, then hide
   * it through the durable Workspace archive projection.
   * @param sessionId - Session addressed by the row.
   * @returns the combined queue-and-hide outcome.
   */
  queueDeletion: (sessionId: SessionId) => Promise<DeletionRequestResult>
}

/** Browser-visible outcome after the Host has considered a deletion request. */
export type DeletionRequestResult =
  | { kind: 'hidden' }
  | { kind: 'queued'; message: string }
  | { kind: 'failed'; message: string }

const NS = 'essentialDeletion'

/** Required browser services. */
export const inject = ['slots', 'remote', 'workspaces', 'locale']

/**
 * Register one destructive action after the Workspace package declares its
 * Session-menu extension slot.
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
    remoteCtx.slots.inject('sidebar.workspaces.sessionMenu', () => remoteCtx.slots.register({
      name: 'sidebar.workspaces.sessionMenu',
      id: 'essential.deleteConversation',
      order: 1000,
      locale: NS,
      inject: (): DeleteConversationMenuInjected => ({
        queueDeletion: async (sessionId) => {
          const response = await conversationDeletion.queue(sessionId)
          if (!response.ok) {
            return { kind: 'failed', message: `${response.error.message} (${response.error.code})` }
          }
          try {
            await remoteCtx.workspaces.archiveSession(sessionId)
          } catch (reason: unknown) {
            const message = reason instanceof Error ? reason.message : String(reason)
            return { kind: 'queued', message }
          }
          return { kind: 'hidden' }
        },
      }),
    }, DeleteConversationMenuItem))
  })
}
