/** Browser contract for conversation-row menu contributions. */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Owner data supplied by one rendered conversation row. */
export interface SessionMenuOwnerProps {
  /** Session targeted by the row menu. */
  sessionId: SessionId
  /** Current display title retained as row-action context. */
  title: string
  /** Close the owning dropdown after an action is admitted. */
  closeMenu: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Plugin-contributed actions appended to every non-blank Session row menu. */
    'sidebar.workspaces.sessionMenu': {
      kind: 'list'
      scope: 'root'
      owner: SessionMenuOwnerProps
    }
  }
}
