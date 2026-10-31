const ESC = '\x1b'
const FOCUS_IN = `${ESC}[I`
const FOCUS_OUT = `${ESC}[O`
const PENDING_LIMIT = 32
const ENABLE_FOCUS_REPORTING = '\x1b[?1004h'
const DISABLE_FOCUS_REPORTING = '\x1b[?1004l'

// Aligned with pi-tui's escape timeout so bare ESC keys feel responsive.
export const DEFAULT_SEQUENCE_TIMEOUT_MS = 50

export interface FocusScannerCallbacks {
  onFocus: (focused: boolean) => void
  onActivity: () => void
}

export interface TerminalInputStream {
  on(event: 'data', listener: (chunk: string) => void): unknown
  removeListener(event: 'data', listener: (chunk: string) => void): unknown
}

export interface TerminalOutputStream {
  write(chunk: string): unknown
}

interface FocusScannerTimers {
  setTimeout: (handler: () => void, ms: number) => NodeJS.Timeout
  clearTimeout: (handle: NodeJS.Timeout) => void
}

export interface FocusScannerDeps {
  stdin?: TerminalInputStream
  stdout?: TerminalOutputStream
  timers?: FocusScannerTimers
  /** Process-level hooks; overridable so tests do not touch the real process. */
  process?: FocusScannerProcess
}

export interface FocusScannerProcess {
  on(event: 'exit', listener: () => void): unknown
  off(event: 'exit', listener: () => void): unknown
}

const defaultTimers: FocusScannerTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout,
}

function isFinalByte(byte: string): boolean {
  const code = byte.charCodeAt(0)
  return code >= 0x40 && code <= 0x7e
}

export class FocusInputScanner {
  private readonly callbacks: FocusScannerCallbacks
  private readonly stdin: TerminalInputStream
  private readonly stdout: TerminalOutputStream
  private readonly timers: FocusScannerTimers
  private readonly proc: FocusScannerProcess
  private pending = ''
  private timeoutHandle: NodeJS.Timeout | undefined
  private listening = false
  private readonly stdinDataHandler = (chunk: string) => {
    this.feed(chunk)
  }
  // Focus reporting is terminal state we enabled, so it has to be undone on
  // every exit path we can observe — session_shutdown alone is not enough when
  // the agent exits early (uncaught error, explicit process.exit()).
  private readonly exitHandler = () => {
    this.writeDisable()
  }

  constructor(
    callbacks: FocusScannerCallbacks,
    { stdin, stdout, timers, process: proc }: FocusScannerDeps = {},
  ) {
    this.callbacks = callbacks
    this.stdin = stdin ?? process.stdin
    this.stdout = stdout ?? process.stdout
    this.timers = timers ?? defaultTimers
    this.proc = proc ?? process
  }

  start(): void {
    if (this.listening) return
    this.listening = true
    this.stdout.write(ENABLE_FOCUS_REPORTING)
    this.proc.on('exit', this.exitHandler)
    this.stdin.on('data', this.stdinDataHandler)
  }

  stop(): void {
    if (this.listening) {
      this.listening = false
      this.writeDisable()
      this.proc.off('exit', this.exitHandler)
      this.stdin.removeListener('data', this.stdinDataHandler)
    }
    this.clear()
  }

  private writeDisable(): void {
    this.stdout.write(DISABLE_FOCUS_REPORTING)
  }

  feed(chunk: string): void {
    for (const byte of chunk) {
      this.feedByte(byte)
    }
  }

  clear(): void {
    this.cancelTimeout()
    this.pending = ''
  }

  private feedByte(byte: string): void {
    if (this.pending === '') {
      if (byte !== ESC) {
        this.callbacks.onActivity()
        return
      }
      this.pending = byte
      this.armTimeout()
      return
    }
    this.pending += byte
    if (this.completeEscape(this.pending)) {
      const pending = this.pending
      this.resolvePending()
      switch (pending) {
        case FOCUS_IN:
          this.callbacks.onFocus(true)
          break
        case FOCUS_OUT:
          this.callbacks.onFocus(false)
          break
        default:
          this.callbacks.onActivity()
      }
      return
    }
    if (this.pending.length > PENDING_LIMIT) {
      this.resolvePending()
      this.callbacks.onActivity()
    }
  }

  private onTimeout(): void {
    this.timeoutHandle = undefined
    if (this.pending === '') return
    // Incomplete sequence (bare ESC, "\x1b[", "\x1bO", "\x1b[1;5", ...):
    // treat as key activity and drop.
    this.resolvePending()
    this.callbacks.onActivity()
  }

  private completeEscape(pending: string): boolean {
    if (pending.startsWith(`${ESC}[`)) {
      // CSI needs the introducer plus at least one final byte (0x40-0x7e).
      return (
        pending.length >= 3 && isFinalByte(pending.charAt(pending.length - 1))
      )
    }
    if (pending.charAt(1) === 'O') {
      // SS3 needs "\x1bO" plus a final byte.
      return pending.length === 3 && isFinalByte(pending.charAt(2))
    }
    // Alt-style "ESC + byte".
    return pending.length === 2
  }

  private armTimeout(): void {
    this.timeoutHandle = this.timers.setTimeout(() => {
      this.onTimeout()
    }, DEFAULT_SEQUENCE_TIMEOUT_MS)
  }

  private cancelTimeout(): void {
    if (this.timeoutHandle === undefined) return
    this.timers.clearTimeout(this.timeoutHandle)
    this.timeoutHandle = undefined
  }

  private resolvePending(): void {
    this.cancelTimeout()
    this.pending = ''
  }
}
