import type { TmuxTitleTracker } from './tmux-title.js'

/**
 * Owns the "this window has something for you" marker.
 *
 * Without the dashboard there is no session registry to persist to, so the
 * marker lives entirely in the tmux window title: it is appended when a
 * notification fires and removed as soon as the user focuses the pane again.
 */
export class UnreadTracker {
  private readonly titleTracker: TmuxTitleTracker

  constructor({ titleTracker }: { titleTracker: TmuxTitleTracker }) {
    this.titleTracker = titleTracker
  }

  markUnread(): void {
    this.titleTracker.mark()
  }

  clearUnread(): void {
    this.titleTracker.restore()
  }
}
