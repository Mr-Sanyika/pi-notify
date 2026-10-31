const ESC = '\x1b'
const FOCUS_IN = `${ESC}[I`
const FOCUS_OUT = `${ESC}[O`
const ENABLE_FOCUS_REPORTING = '\x1b[?1004h'
const DISABLE_FOCUS_REPORTING = '\x1b[?1004l'

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

export interface FocusScannerDeps {
  stdin?: TerminalInputStream
  stdout?: TerminalOutputStream
  /** Process-level hooks; overridable so tests do not touch the real process. */
  process?: FocusScannerProcess
}

export interface FocusScannerProcess {
  on(event: 'exit', listener: () => void): unknown
  off(event: 'exit', listener: () => void): unknown
}

/**
 * Watches stdin for terminal focus reporting (DECSET 1004).
 *
 * Terminals answer focus changes with `ESC[I` / `ESC[O`. A chunk boundary can
 * split those three bytes anywhere, so up to two trailing bytes are held back
 * until the next chunk; everything else is reported as activity. Only the
 * `ESC[I`/`ESC[O` shape is recognised — parameterised variants such as
 * `ESC[3I` (cursor forward tab) stay activity, which is what they are.
 */
export class FocusInputScanner {
  private readonly callbacks: FocusScannerCallbacks
  private readonly stdin: TerminalInputStream
  private readonly stdout: TerminalOutputStream
  private readonly proc: FocusScannerProcess
  private pending = ''
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
    { stdin, stdout, process: proc }: FocusScannerDeps = {},
  ) {
    this.callbacks = callbacks
    this.stdin = stdin ?? process.stdin
    this.stdout = stdout ?? process.stdout
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

  feed(chunk: string): void {
    const data = this.pending + chunk
    this.pending = ''
    let activity = false
    let index = 0

    while (index < data.length) {
      if (data.startsWith(FOCUS_IN, index)) {
        this.flushActivity(activity)
        activity = false
        this.callbacks.onFocus(true)
        index += FOCUS_IN.length
      } else if (data.startsWith(FOCUS_OUT, index)) {
        this.flushActivity(activity)
        activity = false
        this.callbacks.onFocus(false)
        index += FOCUS_OUT.length
      } else if (index >= data.length - 2 && isFocusPrefix(data.slice(index))) {
        // Might be the start of a focus sequence split across chunks.
        break
      } else {
        activity = true
        index++
      }
    }

    this.pending = data.slice(index)
    this.flushActivity(activity)
  }

  clear(): void {
    this.pending = ''
  }

  private flushActivity(activity: boolean): void {
    if (activity) this.callbacks.onActivity()
  }

  private writeDisable(): void {
    this.stdout.write(DISABLE_FOCUS_REPORTING)
  }
}

function isFocusPrefix(candidate: string): boolean {
  return FOCUS_IN.startsWith(candidate) || FOCUS_OUT.startsWith(candidate)
}
