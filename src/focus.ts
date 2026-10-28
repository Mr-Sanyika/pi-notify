import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { FocusInputScanner } from './focus-scanner.js'
import { Registrar } from './shared/registrar.js'
import type { UnreadTracker } from './unread-tracker.js'

export class FocusTracker extends Registrar {
  private readonly scanner: FocusInputScanner
  private readonly unreadTracker: UnreadTracker
  private _focused: boolean | undefined = undefined
  private _lastActivityAt = Date.now()

  constructor(pi: ExtensionAPI, unreadTracker: UnreadTracker) {
    super(pi)
    this.unreadTracker = unreadTracker
    this.scanner = new FocusInputScanner({
      onActivity: () => {
        this.touch()
      },
      onFocus: (focused) => {
        this.touch()
        this._focused = focused
        if (focused) {
          this.unreadTracker.clearUnread()
        }
      },
    })
  }

  get isFocused(): boolean | undefined {
    return this._focused
  }

  get lastActivityAt(): number {
    return this._lastActivityAt
  }

  private touch(): void {
    this._lastActivityAt = Date.now()
  }

  protected override setup(): void {
    this.pi.on('session_start', (_event, ctx) => {
      if (ctx.mode !== 'tui') return
      this.touch()
      this.scanner.start()
    })
  }

  // Known limitation: focus reporting (1004) can get disabled on TUI fullscreen switches; not handled here.
  override stop(): void {
    this.scanner.stop()
    super.stop()
    this._focused = undefined
  }
}
