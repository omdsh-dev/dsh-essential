/** Serializable configuration for recoverable conversation deletion. */

import { isAbsolute, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u

/** Stable command used by the browser menu and default human entry point. */
export const DEFAULT_COMMAND_NAME = 'delete-conversation'

/** Plugin configuration supplied by a DSH profile. */
export interface Config {
  /** Absolute directory holding pending requests and recoverable deleted logs. */
  stateDir: string
  /** Slash-command name without the leading slash. */
  commandName?: string
}

/** Fully validated runtime configuration. */
export interface ResolvedConfig {
  /** Canonical absolute state directory. */
  stateDir: string
  /** Configured human alias; the stable browser command remains registered. */
  commandName: string
}

/** Loader-visible schema. The profile must choose the storage location. */
export const Config: z<Config> = z.object({
  stateDir: z.string().required(),
  commandName: z.string().pattern(COMMAND_NAME).default(DEFAULT_COMMAND_NAME),
})

/**
 * Resolve defaults and reject paths that depend on the process working directory.
 * @param config - Loader-normalized or direct-call configuration.
 * @returns immutable runtime configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  if (!isAbsolute(config.stateDir)) {
    throw new TypeError(`dsh-essential: stateDir must be absolute, got "${config.stateDir}"`)
  }
  const commandName = config.commandName ?? DEFAULT_COMMAND_NAME
  if (!COMMAND_NAME.test(commandName)) {
    throw new TypeError(`dsh-essential: commandName "${commandName}" is invalid`)
  }
  return Object.freeze({ stateDir: resolve(config.stateDir), commandName })
}
