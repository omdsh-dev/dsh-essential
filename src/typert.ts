/** Host Typert manifest for the root-scoped conversation deletion Remote. */

import { TYPERT_REMOTE } from './remote.ts'

/** Loader-owned Host contribution. Remote methods remain absent from model tools. */
export const TYPERT = {
  package: '@deepseek-ai/dsh-essential',
  face: 'host',
  schemas: [],
  invocations: TYPERT_REMOTE.descriptors,
  model: {
    services: [],
    events: [],
    objects: [],
  },
}
