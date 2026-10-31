const ESC = '\x1b'
const FOCUS_IN = `${ESC}[I`
const ENABLE_FOCUS_REPORTING = '\x1b[?1004h'
const DISABLE_FOCUS_REPORTING = '\x1b[?1004l'

export interface FocusScannerCallbacks {
  /** The terminal reports that this pane/window gained focus. */
  onFocusIn: () => void
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
 * Watches stdin for terminal focus reports (DECSET 1004).
 *
 * Terminals answer a focus change with `ESC[I` / `ESC[O`; only focus-in is
 * needed — it clears the tmux window marker. A chunk boundary can split those
 * bytes anywhere, so up to two trailing bytes are held back until the next
 * chunk. Nothing is ever re-emitted or swallowed: the stream is only inspected.
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
    let index = 0

    while (index < data.length) {
      if (data.startsWith(FOCUS_IN, index)) {
        this.callbacks.onFocusIn()
        index += FOCUS_IN.length
      } else if (
        index >= data.length - 2 &&
        FOCUS_IN.startsWith(data.slice(index))
      ) {
        // Might be the start of a focus report split across chunks.
        break
      } else {
        index++
      }
    }

    this.pending = data.slice(index)
  }

  clear(): void {
    this.pending = ''
  }

  private writeDisable(): void {
    this.stdout.write(DISABLE_FOCUS_REPORTING)
  }
}
