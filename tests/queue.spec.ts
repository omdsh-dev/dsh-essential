import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session/types'
import { SessionPersistenceRevision, type SessionHandle, type SessionLocation } from '@deepseek-ai/dsh-session-persistence'
import {
  ConversationDeletionError,
  deletionKey,
  enqueueDeletion,
  recoverPendingDeletions,
  type DeletionPersistence,
} from '../src/queue.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-essential-'))
  roots.push(root)
  const stateDir = join(root, 'state')
  const sourceDir = join(root, 'sessions', 'project', 'session-id')
  const artifactName = 'session.v4.jsonl'
  const artifactPath = join(sourceDir, artifactName)
  await mkdir(sourceDir, { recursive: true })
  await writeFile(artifactPath, '{"version":4}\n', 'utf8')
  const header: SessionHeader = Object.freeze({
    version: 4,
    isSeeded: false,
    id: SessionId('session-id'),
    createdAt: 123,
    cwd: '/project',
  })
  const location: SessionLocation = { kind: 'jsonl', path: artifactPath }
  const revision = SessionPersistenceRevision('test-revision')
  const persistence: DeletionPersistence = {
    list: async () => [],
    stat: async () => ({ header, revision, location }),
    open: async () => readHandle(header),
  }
  return { root, stateDir, sourceDir, artifactPath, artifactName, header, location, revision, persistence }
}

function readHandle(header: SessionHeader): SessionHandle {
  return { header, close: async () => {} } as SessionHandle
}

describe('conversation deletion queue', () => {
  it('uses one stable key per exact Session lifecycle', () => {
    expect(deletionKey('session-id', 123)).toBe(deletionKey('session-id', 123))
    expect(deletionKey('session-id', 123)).not.toBe(deletionKey('session-id', 124))
    expect(deletionKey('session-id', 123)).toHaveLength(32)
  })

  it('queues and recoverably moves a JSONL Session directory', async () => {
    const f = await fixture()
    const queued = await enqueueDeletion(f.stateDir, f.header, f.location)
    expect(JSON.parse(await readFile(queued.requestFile, 'utf8'))).toMatchObject({
      version: 1,
      sessionId: 'session-id',
      createdAt: 123,
      artifactPath: f.artifactPath,
    })

    const report = await recoverPendingDeletions(f.stateDir, f.persistence)
    expect(report).toEqual({ recovered: ['session-id'], failures: [] })
    await expect(readdir(f.sourceDir)).rejects.toMatchObject({ code: 'ENOENT' })
    const trash = join(f.stateDir, 'trash', deletionKey('session-id', 123))
    expect(await readFile(join(trash, f.artifactName), 'utf8')).toBe('{"version":4}\n')
    expect(JSON.parse(await readFile(join(trash, 'deletion.json'), 'utf8'))).toMatchObject({
      sessionId: 'session-id',
      originalDirectory: f.sourceDir,
    })
    expect(await readdir(join(f.stateDir, 'pending'))).toEqual([])
  })

  it('retains a queued log that a newly stored fork may still reference', async () => {
    const f = await fixture()
    await enqueueDeletion(f.stateDir, f.header, f.location)
    const report = await recoverPendingDeletions(f.stateDir, {
      ...f.persistence,
      list: async () => [{
        header: { ...f.header, id: SessionId('child'), isSeeded: true, parentSession: f.header.id },
        revision: f.revision,
      }],
    })
    expect(report.recovered).toEqual([])
    expect(report.failures[0]?.message).toContain('required by a stored fork')
    expect(await readdir(f.sourceDir)).toContain(f.artifactName)
    expect(await readdir(join(f.stateDir, 'pending'))).toHaveLength(1)
  })

  it('finishes a crash recovery when the deterministic trash target already exists', async () => {
    const f = await fixture()
    await enqueueDeletion(f.stateDir, f.header, f.location)
    const trash = join(f.stateDir, 'trash', deletionKey('session-id', 123))
    await mkdir(join(f.stateDir, 'trash'), { recursive: true })
    await rm(trash, { recursive: true, force: true })
    await mkdir(trash)
    await writeFile(join(trash, 'session.jsonl'), 'moved', 'utf8')
    await rm(f.sourceDir, { recursive: true, force: true })

    const report = await recoverPendingDeletions(f.stateDir, {
      ...f.persistence,
      stat: async () => undefined,
    })
    expect(report).toEqual({ recovered: ['session-id'], failures: [] })
    expect(JSON.parse(await readFile(join(trash, 'deletion.json'), 'utf8'))).toMatchObject({
      sessionId: 'session-id',
    })
  })

  it('retains a request when the persisted lifecycle no longer matches', async () => {
    const f = await fixture()
    await enqueueDeletion(f.stateDir, f.header, f.location)
    const report = await recoverPendingDeletions(f.stateDir, {
      ...f.persistence,
      stat: async () => ({ header: { ...f.header, createdAt: 999 }, location: f.location, revision: f.revision }),
    })
    expect(report.recovered).toEqual([])
    expect(report.failures[0]?.message).toMatch(/no longer reports the queued lifecycle/)
    expect(await readdir(join(f.stateDir, 'pending'))).toHaveLength(1)
    expect(await readFile(f.artifactPath, 'utf8')).toBe('{"version":4}\n')
  })

  it('retains a request while the target Session is live during HMR', async () => {
    const f = await fixture()
    await enqueueDeletion(f.stateDir, f.header, f.location)
    const report = await recoverPendingDeletions(f.stateDir, f.persistence, id => id === 'session-id')
    expect(report.failures[0]?.message).toMatch(/live in this process/)
    expect(await readFile(f.artifactPath, 'utf8')).toBe('{"version":4}\n')
  })

  it('rejects backends without a per-Session JSONL artifact', async () => {
    const f = await fixture()
    await expect(enqueueDeletion(f.stateDir, f.header, undefined)).rejects.toBeInstanceOf(ConversationDeletionError)
    await expect(enqueueDeletion(f.stateDir, f.header, { kind: 'sqlite', path: f.artifactPath }))
      .rejects.toThrow(/JSONL/)
  })

  it('rejects a state directory nested inside the Session directory', async () => {
    const f = await fixture()
    await expect(enqueueDeletion(join(f.sourceDir, 'state'), f.header, f.location))
      .rejects.toThrow(/must be outside/)
  })

  it('retains malformed and misnamed requests without touching artifacts', async () => {
    const f = await fixture()
    const pending = join(f.stateDir, 'pending')
    await mkdir(pending, { recursive: true })
    await writeFile(join(pending, 'broken.json'), 'not json', 'utf8')
    await writeFile(join(pending, `${deletionKey('null', 1)}.json`), 'null', 'utf8')
    await writeFile(join(pending, 'wrong-name.json'), JSON.stringify({
      version: 1,
      sessionId: 'session-id',
      createdAt: 123,
      cwd: '/project',
      artifactPath: f.artifactPath,
      queuedAt: 1,
    }), 'utf8')
    const report = await recoverPendingDeletions(f.stateDir, f.persistence)
    expect(report.failures.map(failure => failure.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(/Unexpected token|not valid JSON/),
      'request is not an object',
      'request filename does not match its Session identity',
    ]))
    expect(report.failures).toHaveLength(3)
    expect(await readFile(f.artifactPath, 'utf8')).toBe('{"version":4}\n')
  })

  it('retires a request when its source is already absent and persistence agrees', async () => {
    const f = await fixture()
    await enqueueDeletion(f.stateDir, f.header, f.location)
    await rm(f.sourceDir, { recursive: true, force: true })
    const report = await recoverPendingDeletions(f.stateDir, {
      ...f.persistence,
      stat: async () => undefined,
    })
    expect(report).toEqual({ recovered: ['session-id'], failures: [] })
  })

  it('retains a request when the source path vanished but persistence still lists it', async () => {
    const f = await fixture()
    await enqueueDeletion(f.stateDir, f.header, f.location)
    await rm(f.sourceDir, { recursive: true, force: true })
    const report = await recoverPendingDeletions(f.stateDir, f.persistence)
    expect(report.failures[0]?.message).toMatch(/artifact path changed/)
  })

  it('retains a request when the artifact or resolved location changes', async () => {
    const missing = await fixture()
    await enqueueDeletion(missing.stateDir, missing.header, missing.location)
    await rm(missing.artifactPath)
    const missingReport = await recoverPendingDeletions(missing.stateDir, missing.persistence)
    expect(missingReport.failures[0]?.message).toMatch(/artifact is missing/)

    const moved = await fixture()
    await enqueueDeletion(moved.stateDir, moved.header, moved.location)
    const movedReport = await recoverPendingDeletions(moved.stateDir, {
      ...moved.persistence,
      stat: async () => ({
        header: moved.header, revision: moved.revision,
        location: { kind: 'jsonl', path: join(moved.root, 'elsewhere', 'session.jsonl') },
      }),
    })
    expect(movedReport.failures[0]?.message).toMatch(/location changed/)
  })

  it('retains a request when inspection changes identity or trash collides', async () => {
    const changed = await fixture()
    await enqueueDeletion(changed.stateDir, changed.header, changed.location)
    const changedReport = await recoverPendingDeletions(changed.stateDir, {
      ...changed.persistence,
      open: async () => readHandle({ ...changed.header, createdAt: 999 }),
    })
    expect(changedReport.failures[0]?.message).toMatch(/identity changed/)

    const collided = await fixture()
    await enqueueDeletion(collided.stateDir, collided.header, collided.location)
    const target = join(collided.stateDir, 'trash', deletionKey('session-id', 123))
    await mkdir(target, { recursive: true })
    const collisionReport = await recoverPendingDeletions(collided.stateDir, collided.persistence)
    expect(collisionReport.failures[0]?.message).toMatch(/both source and recovery-trash/)
  })
})
