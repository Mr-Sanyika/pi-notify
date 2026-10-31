import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FocusTracker } from './focus.js'
import type { FocusScannerCallbacks } from './focus-scanner.js'
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
} {
  const titleTracker = { restore: vi.fn() }
  const unreadTracker = new UnreadTracker({
    titleTracker: titleTracker as unknown as TmuxTitleTracker,
  })
  const tracker = new FocusTracker(
    { on: vi.fn() } as unknown as ExtensionAPI,
    unreadTracker,
  )
  return { tracker, titleTracker }
}

describe('FocusTracker focus-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores title and clears unread on focus-in', () => {
    const { tracker, titleTracker } = makeTracker()
    tracker.register(() => {})

    const callbacks = scannerCallbacks.at(-1)
    callbacks?.onFocus(true)

    expect(titleTracker.restore).toHaveBeenCalledOnce()
    expect(titleTracker.restore).toHaveBeenCalledOnce()
    expect(tracker.isFocused).toBe(true)
  })

  it('does not clear unread on focus-out', () => {
    const { tracker, titleTracker } = makeTracker()
    tracker.register(() => {})

    const callbacks = scannerCallbacks.at(-1)
    callbacks?.onFocus(false)

    expect(titleTracker.restore).not.toHaveBeenCalled()
    expect(titleTracker.restore).not.toHaveBeenCalled()
    expect(tracker.isFocused).toBe(false)
  })
})
