/** Cordis activation and human-command adapter. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionLocation } from '@deepseek-ai/dsh-session-persistence'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULT_COMMAND_NAME, resolveConfig, type Config, type ResolvedConfig } from './config.ts'
import {
  ConversationDeletionError,
  enqueueDeletion,
  recoverPendingDeletions,
  type RecoveryReport,
} from './queue.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    conversationDeletion: ConversationDeletionRuntime
  }
}

/** Result returned when a Session lifecycle is durably queued. */
export interface QueuedConversationDeletion {
  readonly sessionId: SessionId
  readonly state: 'queued'
}

/**
 * Recover pending removals and queue new Session lifecycles without deleting
 * an active log in place.
 */
export class ConversationDeletionRuntime extends TypertRemoteService {
  private readonly active = new Set<Promise<unknown>>()

  constructor(
    ctx: Context,
    readonly config: ResolvedConfig,
  ) {
    super(ctx, 'conversationDeletion')
  }

  /**
   * Recover requests left by earlier processes.
   * @returns startup recovery report.
   */
  recover(): Promise<RecoveryReport> {
    return this.track(recoverPendingDeletions(
      this.config.stateDir,
      this.ctx.sessionPersistence,
      sessionId => this.ctx.sessions.get(SessionId(sessionId)) !== undefined,
    ))
  }

  /**
   * Flush and durably queue one known Session for removal on next startup.
   * @param sessionId - live or persisted Session identity.
   * @param signal - caller cancellation checked around durability boundaries.
   * @returns queued identity.
   */
  queue(sessionId: SessionId, signal: AbortSignal): Promise<QueuedConversationDeletion> {
    return this.track(this.queueOwned(sessionId, signal))
  }

  /** Wait for admitted operations during plugin teardown. */
  async drain(): Promise<void> {
    await Promise.allSettled(this.active)
  }

  private async queueOwned(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<QueuedConversationDeletion> {
    signal?.throwIfAborted()
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) {
      await this.ctx.sessions.flush(live)
      signal?.throwIfAborted()
    }
    const header = live?.header ?? await this.findPersistedHeader(sessionId, signal)
    signal?.throwIfAborted()
    const location: SessionLocation | undefined = this.ctx.sessionPersistence.locate(header)
    await enqueueDeletion(this.config.stateDir, header, location)
    return Object.freeze({ sessionId, state: 'queued' as const })
  }

  private async findPersistedHeader(sessionId: SessionId, signal?: AbortSignal): Promise<SessionHeader> {
    const header = (await this.ctx.sessionPersistence.list(signal)).find(candidate => candidate.id === sessionId)
    if (header === undefined) {
      throw new ConversationDeletionError(`conversation "${sessionId}" was not found`)
    }
    return header
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.active.add(operation)
    const retire = (): void => { this.active.delete(operation) }
    void operation.then(retire, retire)
    return operation
  }
}

function commandTarget(invocation: CommandInvocation): SessionId | undefined {
  const input = invocation.rawInput.trim()
  if (input === 'CONFIRM') return invocation.agent.session.id
  if (!input.endsWith(' CONFIRM')) return undefined
  const id = input.slice(0, -' CONFIRM'.length).trim()
  return id === '' ? undefined : SessionId(id)
}

function usage(commandName: string): CommandResult {
  return {
    kind: 'error',
    text: `Use /${commandName} CONFIRM for this conversation, or /${commandName} <session-id> CONFIRM.`,
  }
}

async function executeCommand(
  runtime: ConversationDeletionRuntime,
  invocation: CommandInvocation,
  commandName: string,
): Promise<CommandResult> {
  const target = commandTarget(invocation)
  if (target === undefined) return usage(commandName)
  try {
    await runtime.queue(target, invocation.signal)
    return {
      kind: 'success',
      text: `Conversation "${target}" is queued for deletion. Restart DSH to move its log into recovery trash.`,
    }
  } catch (error: unknown) {
    if (error instanceof ConversationDeletionError) return { kind: 'error', text: error.message }
    throw error
  }
}

/**
 * Recover queued removals, publish the service, and register the slash command.
 * @param ctx - DSH context with commands, sessions, and persistence.
 * @param config - Loader-normalized plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const runtime = new ConversationDeletionRuntime(ctx, resolveConfig(config))
  const report = await runtime.recover()
  for (const sessionId of report.recovered) {
    ctx.logger.info(`conversation "${sessionId}" moved to recovery trash`)
  }
  for (const failure of report.failures) {
    ctx.logger.error(`conversation deletion recovery retained "${failure.requestFile}": ${failure.message}`)
  }

  ctx.effect(function* () {
    yield async () => { await runtime.drain() }
    for (const commandName of new Set([DEFAULT_COMMAND_NAME, runtime.config.commandName])) {
      yield ctx.commands.register({
        name: commandName,
        description: 'Delete a conversation on the next DSH restart',
        input: { hint: '[session-id] CONFIRM' },
        handler: invocation => executeCommand(runtime, invocation, commandName),
      })
    }
  }, 'dsh-essential.conversationDeletion')
}
