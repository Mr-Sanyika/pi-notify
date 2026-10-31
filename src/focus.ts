import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { FocusInputScanner } from './focus-scanner.js'
import { Registrar } from './shared/registrar.js'
import type { UnreadTracker } from './unread-tracker.js'

/**
 * Clears the tmux window marker when the pane regains focus.
 *
 * This is the only use of terminal focus reporting here: notifications are
 * always delivered, focus only decides when the 🔔 disappears.
 */
export class FocusTracker extends Registrar {
  private readonly scanner: FocusInputScanner
  private readonly unreadTracker: UnreadTracker

  constructor(pi: ExtensionAPI, unreadTracker: UnreadTracker) {
    super(pi)
    this.unreadTracker = unreadTracker
    this.scanner = new FocusInputScanner({
      onFocusIn: () => {
        this.unreadTracker.clearUnread()
      },
    })
  }

  protected override setup(): void {
    this.pi.on('session_start', (_event, ctx) => {
      if (ctx.mode !== 'tui') return
      this.scanner.start()
    })
  }

  override stop(): void {
    this.scanner.stop()
    super.stop()
  }
}
