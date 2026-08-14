/**
 * Recoverable conversation deletion plugin for DeepSeek Harness.
 * @module @deepseek-ai/dsh-essential
 */

export const name = 'essential-conversation-delete'
export const inject = ['commands', 'sessionPersistence', 'sessions']

export { Config } from './config.ts'
export type { Config as ConversationDeletionConfig, ResolvedConfig } from './config.ts'
export { apply, ConversationDeletionRuntime } from './runtime.ts'
export type { QueuedConversationDeletion } from './runtime.ts'
export {
  ConversationDeletionError,
  deletionKey,
  enqueueDeletion,
  recoverPendingDeletions,
} from './queue.ts'
export type {
  DeletionPersistence,
  DeletionRequest,
  RecoveryFailure,
  RecoveryReport,
} from './queue.ts'
