/** Package-owned invariant companion for `@deepseek-ai/dsh-essential`. */

import type { Context } from '@deepseek-ai/cordis'

const PACKAGE_NAME = '@deepseek-ai/dsh-essential'

type InvariantFailure = (message: string) => never
type InvariantInstaller = (ctx: Context, fail: InvariantFailure) => void | Promise<void>

interface InvariantRegistry {
  register(packageName: string, installer: InvariantInstaller): () => void
}

export const name = 'essential-conversation-delete-invariant'
export const inject = ['invariants']

// Pending requests are legitimate durable state. Recovery validates every
// Session identity before moving bytes, so there is no additional live event
// relationship for the host invariant runner to sample.
const install: InvariantInstaller = () => {}

function getInvariantRegistry(ctx: Context): InvariantRegistry {
  const registry = ctx.get('invariants') as InvariantRegistry | undefined
  if (registry === undefined) {
    throw new Error(`invariant companion requires the "invariants" service for ${PACKAGE_NAME}`)
  }
  return registry
}

/** Register the package attribution with the optional invariant service. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(getInvariantRegistry(ctx).register(PACKAGE_NAME, install))
