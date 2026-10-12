import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { notify } from './notifier.js'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))

vi.mock('node-notifier', () => ({ default: { notify: mocks.notify } }))

const ESC = '\x1b'
const BEL = '\x07'

const OSC_SEQUENCES = `${ESC}]777;notify;t;b${BEL}${ESC}]9;b${BEL}`
const OSC_SEQUENCES_TMUX =
  `${ESC}Ptmux;${ESC}${ESC}]777;notify;t;b${BEL}${ESC}\\` +
  `${ESC}Ptmux;${ESC}${ESC}]9;b${BEL}${ESC}\\`

function nativeCallCount(): number {
  return mocks.execFile.mock.calls.length + mocks.notify.mock.calls.length
}

// Stub stdout as a TTY and capture writes.
function stubTtyStdout(isTTY: boolean): { writes: string[]; restore(): void } {
  const writes: string[] = []
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  Object.defineProperty(process.stdout, 'isTTY', {
    value: isTTY,
    configurable: true,
  })
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string,
  ) => {
    writes.push(chunk)
    return true
  }) as never)
  return {
    writes,
    restore() {
      write.mockRestore()
      if (ttyDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor)
      }
    },
  }
}

describe('notify desktop channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execFile.mockImplementation(() => {})
    mocks.notify.mockImplementation((_options, callback) => callback())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('has no side effects when the desktop channel is disabled', () => {
    notify('t', 'b', { desktop: false, osc777: false, osc9: false })
    expect(nativeCallCount()).toBe(0)
  })

  it('sends the native notification when the desktop channel is enabled', async () => {
    notify('t', 'b', { desktop: true, osc777: false, osc9: false })
    await vi.waitFor(() => {
      expect(nativeCallCount()).toBe(1)
    })
    if (mocks.notify.mock.calls.length === 0) {
      expect(mocks.execFile.mock.calls[0]?.[0]).toMatch(/^powershell(\.exe)?$/)
    }
  })
})

describe('notify OSC channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('writes nothing when stdout is not a TTY', () => {
    vi.stubEnv('TMUX', undefined)
    const tty = stubTtyStdout(false)
    try {
      notify('t', 'b', { desktop: false, osc777: true, osc9: true })
      expect(tty.writes).toEqual([])
    } finally {
      tty.restore()
    }
  })

  it('writes unwrapped sequences on a TTY outside tmux', () => {
    vi.stubEnv('TMUX', undefined)
    const tty = stubTtyStdout(true)
    try {
      notify('t', 'b', { desktop: false, osc777: true, osc9: true })
      expect(tty.writes).toEqual([OSC_SEQUENCES])
    } finally {
      tty.restore()
    }
  })

  it('wraps sequences in tmux passthrough when TMUX is set', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-0/default,42,0')
    const tty = stubTtyStdout(true)
    try {
      notify('t', 'b', { desktop: false, osc777: true, osc9: true })
      expect(tty.writes).toEqual([OSC_SEQUENCES_TMUX])
    } finally {
      tty.restore()
    }
  })

  it('writes nothing when both OSC flags are off', () => {
    vi.stubEnv('TMUX', undefined)
    const tty = stubTtyStdout(true)
    try {
      notify('t', 'b', { desktop: false, osc777: false, osc9: false })
      expect(tty.writes).toEqual([])
    } finally {
      tty.restore()
    }
  })

  it('dispatches OSC and desktop independently', async () => {
    vi.stubEnv('TMUX', undefined)
    const tty = stubTtyStdout(true)
    try {
      notify('t', 'b', { desktop: true, osc777: true, osc9: true })
      expect(tty.writes).toEqual([OSC_SEQUENCES])
      await vi.waitFor(() => {
        expect(nativeCallCount()).toBe(1)
      })
    } finally {
      tty.restore()
    }
  })
})
