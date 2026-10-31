import { describe, expect, it, vi } from 'vitest'

import { FocusInputScanner } from './focus-scanner.js'

function makeScanner() {
  const focusIns = vi.fn()
  const scanner = new FocusInputScanner({ onFocusIn: focusIns })
  return { focusIns, scanner }
}

describe('FocusInputScanner', () => {
  it('reports focus-in for a complete sequence', () => {
    const { focusIns, scanner } = makeScanner()

    scanner.feed('\x1b[I')

    expect(focusIns).toHaveBeenCalledOnce()
  })

  it('assembles a sequence split across chunks', () => {
    const { focusIns, scanner } = makeScanner()

    scanner.feed('\x1b')
    scanner.feed('[')
    expect(focusIns).not.toHaveBeenCalled()

    scanner.feed('I')
    expect(focusIns).toHaveBeenCalledOnce()
  })

  it('ignores focus-out and other keys', () => {
    const { focusIns, scanner } = makeScanner()

    scanner.feed('\x1b[Oabc\x1bOA\x1b[3I')

    expect(focusIns).not.toHaveBeenCalled()
  })

  it('finds a focus-in inside a larger chunk', () => {
    const { focusIns, scanner } = makeScanner()

    scanner.feed('ab\x1b[Icd\x1b[I')

    expect(focusIns).toHaveBeenCalledTimes(2)
  })

  it('enables focus reporting on start and restores it on stop', () => {
    const stdin = { on: vi.fn(), removeListener: vi.fn() }
    const stdout = { write: vi.fn() }
    const proc = { on: vi.fn(), off: vi.fn() }
    const wired = new FocusInputScanner(
      { onFocusIn: () => {} },
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
      { onFocusIn: () => {} },
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
