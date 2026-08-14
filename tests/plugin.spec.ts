import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('@deepseek-ai/dsh-essential', () => {
  it('preserves the function-plugin namespace through Loader unwrapping', () => {
    expect('default' in plugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as Record<string, unknown>
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('essential-conversation-delete')
    expect(unwrapped.inject).toEqual(['commands', 'sessionPersistence', 'sessions'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('registers the deletion command, queues a cold session, and disposes cleanly', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dsh-essential-plugin-'))
    roots.push(stateDir)
    const header: SessionHeader = Object.freeze({
      version: 0,
      id: SessionId('cold-session'),
      createdAt: 42,
      cwd: '/project',
    })
    let definition: CommandDefinition | undefined
    const unregister = vi.fn()
    const ctx = new Context()
    ctx.provide('commands', {
      register(candidate: CommandDefinition) {
        definition = candidate
        return unregister
      },
    })
    ctx.provide('sessions', { get: () => undefined })
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([header]),
      locate: () => ({ kind: 'jsonl', path: join(stateDir, '..', 'logs', 'session.jsonl') }),
      inspect: () => Promise.resolve({ meta: header, events: [] }),
    })

    const fiber = await ctx.plugin(plugin, { stateDir })
    expect(definition).toMatchObject({
      name: 'delete-conversation',
      description: 'Delete a conversation on the next DSH restart',
    })
    expect(ctx.conversationDeletion).toBeDefined()
    const result = await definition?.handler({
      rawInput: 'cold-session CONFIRM',
      signal: new AbortController().signal,
      agent: { session: { id: SessionId('current-session') } },
    } as CommandInvocation)
    expect(result).toEqual({
      kind: 'success',
      text: 'Conversation "cold-session" is queued for deletion. Restart DSH to move its log into recovery trash.',
    })
    expect(await readdir(join(stateDir, 'pending'))).toHaveLength(1)

    await fiber.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
  })

  it('requires the explicit confirmation phrase', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dsh-essential-plugin-'))
    roots.push(stateDir)
    let definition: CommandDefinition | undefined
    const ctx = new Context()
    ctx.provide('commands', { register: (candidate: CommandDefinition) => { definition = candidate; return () => {} } })
    ctx.provide('sessions', { get: () => undefined })
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([]),
      locate: () => undefined,
      inspect: () => Promise.reject(new Error('not reached')),
    })
    const fiber = await ctx.plugin(plugin, { stateDir })

    const result = await definition?.handler({
      rawInput: '',
      signal: new AbortController().signal,
      agent: { session: { id: SessionId('current-session') } },
    } as CommandInvocation)
    expect(result).toEqual({
      kind: 'error',
      text: 'Use /delete-conversation CONFIRM for this conversation, or /delete-conversation <session-id> CONFIRM.',
    })
    await fiber.dispose()
  })

  it('keeps the stable menu command when a human alias is configured', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dsh-essential-plugin-'))
    roots.push(stateDir)
    const definitions: CommandDefinition[] = []
    const ctx = new Context()
    ctx.provide('commands', {
      register: (candidate: CommandDefinition) => {
        definitions.push(candidate)
        return () => {}
      },
    })
    ctx.provide('sessions', { get: () => undefined })
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([]),
      locate: () => undefined,
      inspect: () => Promise.reject(new Error('not reached')),
    })

    const fiber = await ctx.plugin(plugin, { stateDir, commandName: 'remove-chat' })

    expect(definitions.map(definition => definition.name)).toEqual(['delete-conversation', 'remove-chat'])
    const aliasResult = await definitions[1]?.handler({
      rawInput: '',
      signal: new AbortController().signal,
      agent: { session: { id: SessionId('current-session') } },
    } as CommandInvocation)
    expect(aliasResult).toEqual({
      kind: 'error',
      text: 'Use /remove-chat CONFIRM for this conversation, or /remove-chat <session-id> CONFIRM.',
    })
    await fiber.dispose()
  })

  it('targets the current live Session, flushes it, and reports expected failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-essential-plugin-'))
    roots.push(root)
    const stateDir = join(root, 'state')
    const header: SessionHeader = Object.freeze({
      version: 0,
      id: SessionId('current-session'),
      createdAt: 7,
      cwd: '/project',
    })
    const live = { id: header.id, header }
    const flush = vi.fn(() => Promise.resolve(true))
    let definition: CommandDefinition | undefined
    const ctx = new Context()
    ctx.provide('commands', { register: (candidate: CommandDefinition) => { definition = candidate; return () => {} } })
    ctx.provide('sessions', { get: (id: SessionId) => id === header.id ? live : undefined, flush })
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([header]),
      locate: () => ({ kind: 'jsonl', path: join(root, 'logs', 'session.jsonl') }),
      inspect: () => Promise.resolve({ meta: header, events: [] }),
    })
    const fiber = await ctx.plugin(plugin, { stateDir })

    const invocation = {
      rawInput: 'CONFIRM',
      signal: new AbortController().signal,
      agent: { session: live },
    } as CommandInvocation
    await expect(definition?.handler(invocation)).resolves.toMatchObject({ kind: 'success' })
    expect(flush).toHaveBeenCalledWith(live)

    const missing = await definition?.handler({ ...invocation, rawInput: 'missing CONFIRM' })
    expect(missing).toEqual({ kind: 'error', text: 'conversation "missing" was not found' })
    await fiber.dispose()
  })

  it('logs recovery failures and propagates unexpected command failures', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'dsh-essential-plugin-'))
    roots.push(stateDir)
    await mkdir(join(stateDir, 'pending'), { recursive: true })
    await writeFile(join(stateDir, 'pending', 'broken.json'), '{', 'utf8')
    let definition: CommandDefinition | undefined
    const ctx = new Context()
    const errorLog = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)
    ctx.provide('commands', { register: (candidate: CommandDefinition) => { definition = candidate; return () => {} } })
    ctx.provide('sessions', { get: () => undefined })
    let failList = false
    ctx.provide('sessionPersistence', {
      list: () => failList ? Promise.reject(new Error('storage offline')) : Promise.resolve([]),
      locate: () => undefined,
      inspect: () => Promise.reject(new Error('not reached')),
    })
    const fiber = await ctx.plugin(plugin, { stateDir })
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('retained'))
    failList = true
    await expect(definition?.handler({
      rawInput: 'missing CONFIRM',
      signal: new AbortController().signal,
      agent: { session: { id: SessionId('current') } },
    } as CommandInvocation)).rejects.toThrow('storage offline')
    await fiber.dispose()
    errorLog.mockRestore()
  })

  it('registers the invariant companion through its local host contract', async () => {
    const ctx = new Context()
    const unregister = vi.fn()
    let installer: ((ctx: Context, fail: (message: string) => never) => void | Promise<void>) | undefined
    const register = vi.fn((_packageName: string, candidate: typeof installer) => {
      installer = candidate
      return unregister
    })
    const removeService = ctx.provide('invariants', { register })

    const fiber = await ctx.plugin(invariant)
    expect(register.mock.calls[0]?.[0]).toBe('@deepseek-ai/dsh-essential')
    expect(typeof register.mock.calls[0]?.[1]).toBe('function')
    await installer?.(ctx, message => { throw new Error(message) })
    await fiber.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
    await removeService()
  })

  it('fails direct invariant activation without the host service', async () => {
    expect(() => invariant.apply(new Context())).toThrow(/requires the "invariants" service/)
  })
})
