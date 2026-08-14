/** Conversation-deletion menu dictionaries. */

/** Simplified Chinese dictionary and key source. */
export const zh = {
  'menu.delete': '删除对话',
  'confirm': '确认删除该对话吗？',
  'close': '关闭',
  'cancel': '取消',
  'pending': '正在删除…',
  'queued.visible': '删除请求已加入队列，但暂时无法隐藏对话：{message}',
  'failed': '无法删除对话：{message}',
} satisfies Record<string, string>

/** Dictionary key union. */
export type EssentialDeletionKey = keyof typeof zh

/** English dictionary, complete against the Chinese key set. */
export const en = {
  'menu.delete': 'Delete conversation',
  'confirm': 'Delete this conversation?',
  'close': 'Close',
  'cancel': 'Cancel',
  'pending': 'Deleting…',
  'queued.visible': 'Deletion was queued, but the conversation could not be hidden yet: {message}',
  'failed': 'Could not delete the conversation: {message}',
} satisfies Record<EssentialDeletionKey, string>
