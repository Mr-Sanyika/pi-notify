import type { SessionStore } from './stores/session-store.js'
import type { TmuxTitleTracker } from './tmux-title.js'

export class UnreadTracker {
  private readonly titleTracker: TmuxTitleTracker
  private readonly sessionStore: SessionStore

  constructor({
    titleTracker,
    sessionStore,
  }: {
    titleTracker: TmuxTitleTracker
    sessionStore: SessionStore
  }) {
    this.titleTracker = titleTracker
    this.sessionStore = sessionStore
  }

  markUnread(): void {
    this.titleTracker.mark()
    void this.sessionStore.markUnread().catch(() => {})
  }

  clearUnread(): void {
    this.titleTracker.restore()
    void this.sessionStore.clearUnread().catch(() => {})
  }
}
