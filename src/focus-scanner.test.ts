import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FocusScannerDeps } from './focus-scanner.js'
import {
  DEFAULT_SEQUENCE_TIMEOUT_MS,
  FocusInputScanner,
} from './focus-scanner.js'

interface Event {
  type: 'focus' | 'activity'
  focused?: boolean
}

function makeScanner(deps: FocusScannerDeps = {}) {
  const events: Event[] = []
  const scanner = new FocusInputScanner(
    {
      onActivity: () => events.push({ type: 'activity' }),
      onFocus: (focused) => events.push({ type: 'focus', focused }),
    },
    deps,
  )
  return { events, scanner }
}

describe('FocusInputScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports focus gained for a complete focus-in sequence', () => {
    const { events, scanner } = makeScanner()
    scanner.feed('\x1b[I')
    expect(events).toEqual([{ type: 'focus', focused: true }])
  })

  it('reports focus lost for a complete focus-out sequence', () => {
    const { events, scanner } = makeScanner()
    scanner.feed('\x1b[O')
    expect(events).toEqual([{ type: 'focus', focused: false }])
  })

  it('assembles sequences split across chunks', () => {
    const { events, scanner } = makeScanner()
    scanner.feed('\x1b')
    expect(events).toEqual([])
    scanner.feed('[I')
    expect(events).toEqual([{ type: 'focus', focused: true }])
  })

  it('reports activity around sequences merged into one chunk', () => {
    const { events, scanner } = makeScanner()
    scanner.feed('abc\x1b[Odef')
    expect(events).toEqual([
      { type: 'activity' },
      { type: 'activity' },
      { type: 'activity' },
      { type: 'focus', focused: false },
      { type: 'activity' },
      { type: 'activity' },
      { type: 'activity' },
    ])
  })

  it('treats SS3 arrow keys as activity', () => {
    const { events, scanner } = makeScanner()
    scanner.feed('\x1bOA')
    expect(events).toEqual([{ type: 'activity' }])
  })

  it('treats a bare SS3 introducer as activity after timeout', () => {
    const { events, scanner } = makeScanner()
    scanner.feed('\x1bO')
    vi.advanceTimersByTime(DEFAULT_SEQUENCE_TIMEOUT_MS)
    expect(events).toEqual([{ type: 'activity' }])
  })

  it('reports activity when a pending sequence times out', () => {
    const { events, scanner } = makeScanner()
    scanner.feed('\x1b[')
    vi.advanceTimersByTime(DEFAULT_SEQUENCE_TIMEOUT_MS)
    expect(events).toEqual([{ type: 'activity' }])
  })

  it('clears and reports activity on pending overflow', () => {
    const { events, scanner } = makeScanner()
    scanner.feed(`\x1b[${'x'.repeat(40)}`)
    expect(events.every((event) => event.type === 'activity')).toBe(true)
    expect(events.length).toBeGreaterThan(0)
    scanner.feed('\x1b[I')
    expect(events.at(-1)).toEqual({ type: 'focus', focused: true })
  })

  it('wires stdin/stdout through start/stop', () => {
    const writes: string[] = []
    const listeners: Array<(chunk: string) => void> = []
    const { events, scanner } = makeScanner({
      stdout: { write: (chunk: string) => writes.push(chunk) },
      stdin: {
        on: (_event: 'data', listener: (chunk: string) => void) => {
          listeners.push(listener)
        },
        removeListener: (_event: 'data', listener: (chunk: string) => void) => {
          const index = listeners.indexOf(listener)
          if (index !== -1) listeners.splice(index, 1)
        },
      },
    })

    scanner.start()
    scanner.start()
    expect(writes).toEqual(['\x1b[?1004h'])
    expect(listeners.length).toBe(1)

    listeners[0]?.('\x1b[I')
    expect(events).toEqual([{ type: 'focus', focused: true }])

    scanner.stop()
    scanner.stop()
    expect(writes).toEqual(['\x1b[?1004h', '\x1b[?1004l'])
    expect(listeners.length).toBe(0)

    scanner.feed('x')
    expect(events).toEqual([
      { type: 'focus', focused: true },
      { type: 'activity' },
    ])
  })

  it('disables focus reporting from the process exit hook', () => {
    const writes: string[] = []
    const exitListeners: Array<() => void> = []
    const proc = {
      on: (_event: 'exit', listener: () => void) => {
        exitListeners.push(listener)
      },
      off: (_event: 'exit', listener: () => void) => {
        const index = exitListeners.indexOf(listener)
        if (index !== -1) exitListeners.splice(index, 1)
      },
    }
    const { scanner } = makeScanner({
      stdout: { write: (chunk: string) => writes.push(chunk) },
      stdin: {
        on: () => {},
        removeListener: () => {},
      },
      process: proc,
    })

    scanner.start()
    expect(exitListeners.length).toBe(1)
    // Simulate the agent dying without a `session_shutdown`.
    exitListeners[0]?.()
    expect(writes).toEqual(['\x1b[?1004h', '\x1b[?1004l'])

    writes.length = 0
    scanner.stop()
    expect(exitListeners.length).toBe(0)
    expect(writes).toEqual(['\x1b[?1004l'])
  })

  it('clears pending state idempotently', () => {
    const { events, scanner } = makeScanner()
    scanner.feed('\x1b[')
    scanner.clear()
    scanner.clear()
    vi.advanceTimersByTime(100)
    expect(events).toEqual([])
    scanner.feed('\x1b[I')
    expect(events).toEqual([{ type: 'focus', focused: true }])
  })
})
