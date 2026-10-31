import { describe, expect, it, vi } from 'vitest'

import { FocusInputScanner } from './focus-scanner.js'

interface Event {
  type: 'focus' | 'activity'
  focused?: boolean
}

function makeScanner() {
  const events: Event[] = []
  const scanner = new FocusInputScanner({
    onActivity: () => events.push({ type: 'activity' }),
    onFocus: (focused) => events.push({ type: 'focus', focused }),
  })
  return { events, scanner }
}

describe('FocusInputScanner', () => {
  it('reports focus gained for a focus-in sequence', () => {
    const { events, scanner } = makeScanner()

    scanner.feed('\x1b[I')

    expect(events).toEqual([{ type: 'focus', focused: true }])
  })

  it('reports focus lost for a focus-out sequence', () => {
    const { events, scanner } = makeScanner()

    scanner.feed('\x1b[O')

    expect(events).toEqual([{ type: 'focus', focused: false }])
  })

  it('assembles sequences split across chunks', () => {
    const { events, scanner } = makeScanner()

    scanner.feed('\x1b')
    scanner.feed('[')
    scanner.feed('I')
    scanner.feed('\x1b[O')

    expect(events).toEqual([
      { type: 'focus', focused: true },
      { type: 'focus', focused: false },
    ])
  })

  it('reports activity around sequences merged into one chunk', () => {
    const { events, scanner } = makeScanner()

    scanner.feed('a\x1b[Ib\x1b[Oc')

    expect(events).toEqual([
      { type: 'activity' },
      { type: 'focus', focused: true },
      { type: 'activity' },
      { type: 'focus', focused: false },
      { type: 'activity' },
    ])
  })

  it('treats arrow keys and cursor-tab as activity', () => {
    const { events, scanner } = makeScanner()

    scanner.feed('\x1bOA\x1b[3I')

    expect(events).toEqual([{ type: 'activity' }])

    scanner.feed('')
  })

  it('holds back an incomplete prefix until the next chunk', () => {
    const { events, scanner } = makeScanner()

    scanner.feed('x\x1b[')
    expect(events).toEqual([{ type: 'activity' }])

    scanner.feed('O')
    expect(events).toEqual([
      { type: 'activity' },
      { type: 'focus', focused: false },
    ])
  })

  it('reports a lone escape as activity without holding it forever', () => {
    const { events, scanner } = makeScanner()

    scanner.feed('\x1b')
    expect(events).toEqual([])

    scanner.feed('j')
    expect(events).toEqual([{ type: 'activity' }])
  })

  it('enables focus reporting on start and restores it on stop', () => {
    const stdin = { on: vi.fn(), removeListener: vi.fn() }
    const stdout = { write: vi.fn() }
    const proc = { on: vi.fn(), off: vi.fn() }
    const wired = new FocusInputScanner(
      { onActivity: () => {}, onFocus: () => {} },
      { stdin, stdout, process: proc },
    )

    wired.start()
    wired.start()
    expect(stdout.write).toHaveBeenCalledWith('\x1b[?1004h')
    expect(stdin.on).toHaveBeenCalledTimes(1)
    expect(proc.on).toHaveBeenCalledTimes(1)

    wired.stop()
    expect(stdout.write).toHaveBeenLastCalledWith('\x1b[?1004l')
    expect(stdin.removeListener).toHaveBeenCalledTimes(1)
    expect(proc.off).toHaveBeenCalledTimes(1)
  })

  it('disables focus reporting from the process exit hook', () => {
    const stdout = { write: vi.fn() }
    let exitHandler: (() => void) | undefined
    const proc = {
      on: vi.fn((_event: 'exit', listener: () => void) => {
        exitHandler = listener
      }),
      off: vi.fn(),
    }
    const wired = new FocusInputScanner(
      { onActivity: () => {}, onFocus: () => {} },
      {
        stdin: { on: vi.fn(), removeListener: vi.fn() },
        stdout,
        process: proc,
      },
    )

    wired.start()
    stdout.write.mockClear()
    exitHandler?.()

    expect(stdout.write).toHaveBeenCalledWith('\x1b[?1004l')
  })
})
