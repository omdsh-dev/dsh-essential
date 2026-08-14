import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.ts'

describe('conversation deletion configuration', () => {
  it('uses the stable command name default', () => {
    const stateDir = resolve('/tmp', 'dsh-essential-test')
    expect(resolveConfig(Config({ stateDir }))).toEqual({
      stateDir,
      commandName: 'delete-conversation',
    })
    expect(resolveConfig({ stateDir })).toEqual({ stateDir, commandName: 'delete-conversation' })
  })

  it('accepts a configured command name', () => {
    const stateDir = resolve('/tmp', 'dsh-essential-test')
    expect(resolveConfig(Config({ stateDir, commandName: 'remove-chat' })).commandName).toBe('remove-chat')
  })

  it('rejects relative state paths for direct callers', () => {
    expect(() => resolveConfig({ stateDir: 'relative/trash' })).toThrow(/must be absolute/)
  })

  it('rejects invalid command names for direct callers', () => {
    expect(() => resolveConfig({ stateDir: '/tmp/trash', commandName: 'Delete Chat' })).toThrow(/invalid/)
  })

  it('rejects invalid command names at the Loader schema', () => {
    expect(() => Config({ stateDir: '/tmp/trash', commandName: '9bad' })).toThrow()
  })
})
