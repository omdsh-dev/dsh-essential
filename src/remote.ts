/** Root-scoped Remote contract used by the Session-list deletion action. */

import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import type { QueuedConversationDeletion } from './runtime.ts'

/** Browser-facing namespace mounted under `ctx.remote`. */
export interface ConversationDeletionRemoteApi {
  /** Queue one persisted or live Session without requiring an active Agent. */
  queue: (
    sessionId: SessionId,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<QueuedConversationDeletion>>
}

const sessionIdSchema = z.intersection(z.string(), z.unknown())
const queuedDeletionSchema = z.object({
  sessionId: sessionIdSchema,
  state: z.literal('queued'),
}).readonly()

/** Stable descriptor shared by the Host Typert loader and browser Remote mount. */
export const queueDeletionInvocation: InvocationDescriptor = {
  id: '@deepseek-ai/dsh-essential#conversationDeletion/queue',
  service: 'conversationDeletion',
  namespace: 'conversationDeletion',
  method: 'queue',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'sessionId',
    wire: 'sessionId',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
      create: () => sessionIdSchema,
    },
  }],
  cancellation: { parameter: 'signal' },
  result: {
    mode: 'strict',
    typeSymbol: '@deepseek-ai/dsh-essential#QueuedConversationDeletion',
    create: () => queuedDeletionSchema,
  },
  sourceLocation: { file: 'src/runtime.ts', line: 58, column: 3 },
}

/** Client-mountable contribution for historical as well as live Sessions. */
export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-essential',
  descriptors: [queueDeletionInvocation],
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'conversationDeletion/queue': ConversationDeletionRemoteApi['queue']
  }

  interface TypertRemoteNamespaceMap {
    conversationDeletion: TypertRemoteNamespace<'conversationDeletion'>
  }
}

export default TYPERT_REMOTE
