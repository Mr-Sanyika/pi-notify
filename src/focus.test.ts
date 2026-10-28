import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FocusTracker } from './focus.js'
import type { FocusScannerCallbacks } from './focus-scanner.js'
import type { SessionStore } from './stores/session-store.js'
import type { TmuxTitleTracker } from './tmux-title.js'
import { UnreadTracker } from './unread-tracker.js'

const scannerCallbacks: FocusScannerCallbacks[] = []

vi.mock('./focus-scanner.js', () => ({
  FocusInputScanner: class {
    constructor(callbacks: FocusScannerCallbacks) {
      scannerCallbacks.push(callbacks)
    }
    start(): void {}
    stop(): void {}
  },
}))

function makeTracker(): {
  tracker: FocusTracker
  titleTracker: { restore: ReturnType<typeof vi.fn> }
  sessionStore: { clearUnread: ReturnType<typeof vi.fn> }
} {
  const titleTracker = { restore: vi.fn() }
  const sessionStore = { clearUnread: vi.fn(async () => {}) }
  const unreadTracker = new UnreadTracker({
    titleTracker: titleTracker as unknown as TmuxTitleTracker,
    sessionStore: sessionStore as unknown as SessionStore,
  })
  const tracker = new FocusTracker(
    { on: vi.fn() } as unknown as ExtensionAPI,
    unreadTracker,
  )
  return { tracker, titleTracker, sessionStore }
}

describe('FocusTracker focus-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores title and clears unread on focus-in', () => {
    const { tracker, titleTracker, sessionStore } = makeTracker()
    tracker.register(() => {})

    const callbacks = scannerCallbacks.at(-1)
    callbacks?.onFocus(true)

    expect(titleTracker.restore).toHaveBeenCalledOnce()
    expect(sessionStore.clearUnread).toHaveBeenCalledOnce()
    expect(tracker.isFocused).toBe(true)
  })

  it('does not clear unread on focus-out', () => {
    const { tracker, titleTracker, sessionStore } = makeTracker()
    tracker.register(() => {})

    const callbacks = scannerCallbacks.at(-1)
    callbacks?.onFocus(false)

    expect(titleTracker.restore).not.toHaveBeenCalled()
    expect(sessionStore.clearUnread).not.toHaveBeenCalled()
    expect(tracker.isFocused).toBe(false)
  })
})
