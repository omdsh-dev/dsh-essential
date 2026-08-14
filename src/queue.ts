/** Crash-recoverable queue and JSONL artifact quarantine. */

import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SessionInspection,
  SessionLocation,
} from '@deepseek-ai/dsh-session-persistence'

const REQUEST_VERSION = 1
const ARTIFACT_NAME = /^session\.jsonl(?:\.zstd)?$/u

/** Durable identity and source path captured when deletion is requested. */
export interface DeletionRequest {
  readonly version: 1
  readonly sessionId: string
  readonly createdAt: number
  readonly cwd?: string
  readonly artifactPath: string
  readonly queuedAt: number
}

/** Minimal persistence surface used while recovering pending deletions. */
export interface DeletionPersistence {
  list(signal?: AbortSignal): Promise<SessionHeader[]>
  locate(meta: SessionHeader): SessionLocation | undefined
  inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>
}

/** One recovery failure retained for a later retry. */
export interface RecoveryFailure {
  readonly requestFile: string
  readonly message: string
}

/** Startup recovery report. */
export interface RecoveryReport {
  readonly recovered: readonly string[]
  readonly failures: readonly RecoveryFailure[]
}

/** A deletion request cannot be represented safely by the installed backend. */
export class ConversationDeletionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationDeletionError'
  }
}

/** Stable filename and trash directory key for one exact Session lifecycle. */
export function deletionKey(sessionId: string, createdAt: number): string {
  return createHash('sha256').update(sessionId).update('\0').update(String(createdAt)).digest('hex').slice(0, 32)
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error: unknown) {
    if (isEnoent(error)) return false
    throw error
  }
}

function assertJsonlLocation(location: SessionLocation | undefined): asserts location is SessionLocation {
  if (location === undefined || location.kind !== 'jsonl' || !isAbsolute(location.path)
    || !ARTIFACT_NAME.test(basename(location.path))) {
    throw new ConversationDeletionError(
      'conversation deletion requires the per-session JSONL persistence backend',
    )
  }
}

function requestFromUnknown(value: unknown): DeletionRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request is not an object')
  }
  const request = value as Record<string, unknown>
  if (request.version !== REQUEST_VERSION
    || typeof request.sessionId !== 'string' || request.sessionId.length === 0
    || typeof request.createdAt !== 'number' || !Number.isSafeInteger(request.createdAt) || request.createdAt < 0
    || request.cwd !== undefined && typeof request.cwd !== 'string'
    || typeof request.artifactPath !== 'string' || !isAbsolute(request.artifactPath)
    || !ARTIFACT_NAME.test(basename(request.artifactPath as string))
    || typeof request.queuedAt !== 'number' || !Number.isSafeInteger(request.queuedAt) || request.queuedAt < 0) {
    throw new Error('request has invalid fields')
  }
  return Object.freeze({
    version: REQUEST_VERSION,
    sessionId: request.sessionId,
    createdAt: request.createdAt,
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    artifactPath: resolve(request.artifactPath),
    queuedAt: request.queuedAt,
  })
}

function sameIdentity(header: SessionHeader, request: DeletionRequest): boolean {
  return header.id === request.sessionId
    && header.createdAt === request.createdAt
    && header.cwd === request.cwd
}

function ensureSeparateStateDir(stateDir: string, artifactPath: string): void {
  const sourceDir = dirname(artifactPath)
  const stateInsideSource = relative(sourceDir, stateDir)
  const sourceInsideState = relative(stateDir, sourceDir)
  const overlaps = stateInsideSource === '' || sourceInsideState === ''
    || !stateInsideSource.startsWith('..') && !isAbsolute(stateInsideSource)
    || !sourceInsideState.startsWith('..') && !isAbsolute(sourceInsideState)
  if (overlaps) {
    throw new ConversationDeletionError('conversation deletion stateDir must be outside the session artifact directory')
  }
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    try {
      await unlink(temporary)
    } catch (cleanupError: unknown) {
      if (!isEnoent(cleanupError)) throw new AggregateError([error, cleanupError], `failed to write ${path}`)
    }
    throw error
  }
}

/**
 * Durably enqueue one exact Session lifecycle for recovery on the next boot.
 * @param stateDir - absolute plugin state directory.
 * @param header - target Session identity.
 * @param location - backend-owned artifact location.
 * @returns the durable request and its request-file path.
 */
export async function enqueueDeletion(
  stateDir: string,
  header: SessionHeader,
  location: SessionLocation | undefined,
): Promise<{ request: DeletionRequest; requestFile: string }> {
  assertJsonlLocation(location)
  const canonicalStateDir = resolve(stateDir)
  ensureSeparateStateDir(canonicalStateDir, location.path)
  const pendingDir = join(canonicalStateDir, 'pending')
  await mkdir(pendingDir, { recursive: true, mode: 0o700 })
  const request: DeletionRequest = Object.freeze({
    version: REQUEST_VERSION,
    sessionId: header.id,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    artifactPath: resolve(location.path),
    queuedAt: Date.now(),
  })
  const requestFile = join(pendingDir, `${deletionKey(header.id, header.createdAt)}.json`)
  await writeAtomic(requestFile, request)
  return { request, requestFile }
}

async function writeRecoveryManifest(targetDir: string, request: DeletionRequest): Promise<void> {
  await writeAtomic(join(targetDir, 'deletion.json'), {
    version: REQUEST_VERSION,
    sessionId: request.sessionId,
    createdAt: request.createdAt,
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    originalDirectory: dirname(request.artifactPath),
    deletedAt: Date.now(),
  })
}

/**
 * Move every valid pending JSONL Session directory into recovery trash.
 * Requests are retained on validation or storage failure and retried next boot.
 * @param stateDir - plugin state directory.
 * @param persistence - active persistence service, before Workspace indexing.
 * @param isLive - optional process-local liveness fence used during HMR.
 * @returns recovered session ids and retained failures.
 */
export async function recoverPendingDeletions(
  stateDir: string,
  persistence: DeletionPersistence,
  isLive?: (sessionId: string) => boolean,
): Promise<RecoveryReport> {
  const canonicalStateDir = resolve(stateDir)
  const pendingDir = join(canonicalStateDir, 'pending')
  const trashDir = join(canonicalStateDir, 'trash')
  await mkdir(pendingDir, { recursive: true, mode: 0o700 })
  await mkdir(trashDir, { recursive: true, mode: 0o700 })
  const filenames = (await readdir(pendingDir)).filter(name => name.endsWith('.json')).sort()
  if (filenames.length === 0) return Object.freeze({ recovered: [], failures: [] })

  const headers = await persistence.list()
  const recovered: string[] = []
  const failures: RecoveryFailure[] = []

  for (const filename of filenames) {
    const requestFile = join(pendingDir, filename)
    try {
      const request = requestFromUnknown(JSON.parse(await readFile(requestFile, 'utf8')))
      const expectedFilename = `${deletionKey(request.sessionId, request.createdAt)}.json`
      if (filename !== expectedFilename) throw new Error('request filename does not match its Session identity')
      if (isLive?.(request.sessionId) === true) {
        throw new Error('Session is live in this process; retry on the next cold start')
      }
      ensureSeparateStateDir(canonicalStateDir, request.artifactPath)
      const sourceDir = dirname(request.artifactPath)
      const targetDir = join(trashDir, deletionKey(request.sessionId, request.createdAt))
      const sourceExists = await exists(sourceDir)
      const targetExists = await exists(targetDir)

      if (targetExists) {
        if (sourceExists) throw new Error('both source and recovery-trash directories exist')
        if (!await exists(join(targetDir, 'deletion.json'))) await writeRecoveryManifest(targetDir, request)
        await unlink(requestFile)
        recovered.push(request.sessionId)
        continue
      }

      const header = headers.find(candidate => sameIdentity(candidate, request))
      if (!sourceExists) {
        if (header !== undefined) throw new Error('Session still exists but its queued artifact path changed')
        await unlink(requestFile)
        recovered.push(request.sessionId)
        continue
      }
      if (!await exists(request.artifactPath)) throw new Error('Session artifact is missing from its source directory')
      if (header === undefined) throw new Error('Session persistence no longer reports the queued lifecycle')
      const currentLocation = persistence.locate(header)
      assertJsonlLocation(currentLocation)
      if (resolve(currentLocation.path) !== request.artifactPath) {
        throw new Error('Session artifact location changed after deletion was queued')
      }
      const inspected = await persistence.inspect(header.id)
      if (!sameIdentity(inspected.meta, request)) throw new Error('Session identity changed during recovery')

      await rename(sourceDir, targetDir)
      await writeRecoveryManifest(targetDir, request)
      await unlink(requestFile)
      recovered.push(request.sessionId)
    } catch (error: unknown) {
      failures.push(Object.freeze({
        requestFile,
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }
  return Object.freeze({ recovered: Object.freeze(recovered), failures: Object.freeze(failures) })
}
