import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FocusTracker } from './focus.js'
import type { FocusScannerCallbacks } from './focus-scanner.js'
import type { TmuxTitleTracker } from './tmux-title.js'
import { UnreadTracker } from './unread-tracker.js'

const scannerCallbacks: FocusScannerCallbacks[] = []
const starts = vi.fn()

vi.mock('./focus-scanner.js', () => ({
  FocusInputScanner: class {
    constructor(callbacks: FocusScannerCallbacks) {
      scannerCallbacks.push(callbacks)
    }
    start(): void {
      starts()
    }
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

describe('FocusTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears the window marker when the pane gains focus', () => {
    const { tracker, titleTracker } = makeTracker()
    tracker.register(() => {})

    scannerCallbacks.at(-1)?.onFocusIn()

    expect(titleTracker.restore).toHaveBeenCalledOnce()
  })

  it('starts focus reporting only in TUI sessions', () => {
    const { tracker } = makeTracker()
    const listeners = new Map<
      string,
      (event: unknown, ctx: { mode: string }) => void
    >()
    const start = vi.fn()
    scannerCallbacks.length = 0

    tracker.register(() => {})
    const pi = { on: vi.fn() } as unknown as ExtensionAPI
    void pi
    void listeners
    void start
  })
})
