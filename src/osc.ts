const ESC = '\x1b'
const BEL = '\x07'

/**
 * Build raw (unwrapped) OSC notification sequences for the enabled codes.
 * - OSC 777: `ESC ] 777 ; notify ; <title> ; <body> BEL` (title + body)
 * - OSC 9:   `ESC ] 9 ; <body> BEL` (body only, e.g. iTerm2 / mintty)
 *
 * Emission order is fixed 777 before 9: web-term dedups by body within 1s,
 * so the 777 toast (with title) must arrive first.
 */
export function oscNotifySequences(
  title: string,
  body: string,
  { osc777, osc9 }: { osc777: boolean; osc9: boolean },
): string[] {
  // Strip bytes that would break or forge the OSC envelope; flatten newlines
  // like escapePowerShell does.
  const sanitize = (value: string): string =>
    value
      .replaceAll(BEL, '')
      .replaceAll(ESC, '')
      .replaceAll('\r\n', ' ')
      .replaceAll('\n', ' ')
      .replaceAll('\r', ' ')
  // Title must not contain ';' — OSC 777 parsers split on ';' and a raw
  // semicolon would shift the rest of the title into the body. The body is
  // join-safe (parsers rejoin the remaining parts), so it keeps ';'.
  const sanitizeTitle = (value: string): string =>
    sanitize(value).replaceAll(';', '')
  const safeTitle = sanitizeTitle(title)
  const safeBody = sanitize(body)
  const sequences: string[] = []
  if (osc777) sequences.push(`${ESC}]777;notify;${safeTitle};${safeBody}${BEL}`)
  if (osc9) sequences.push(`${ESC}]9;${safeBody}${BEL}`)
  return sequences
}

/**
 * Wrap a raw sequence in a tmux DCS passthrough so tmux forwards it to the
 * outer terminal instead of consuming it:
 * `ESC P tmux ; <sequence with every ESC doubled> ESC \`.
 *
 * Rules: only the ESC (0x1b) byte is doubled (BEL is passed through as-is),
 * and the wrapper must be terminated with ST (`ESC \`), not BEL.
 * Requires tmux >= 3.3 with `set -g allow-passthrough all` in ~/.tmux.conf.
 */
export function wrapTmuxPassthrough(sequence: string): string {
  const inner = sequence.replaceAll(ESC, `${ESC}${ESC}`)
  return `${ESC}Ptmux;${inner}${ESC}\\`
}

/**
 * Emit the enabled OSC notification sequences to the terminal.
 * Skipped when stdout is not a TTY (e.g. piped output). Inside tmux, raw OSC
 * from a pane is consumed by tmux itself, so sequences are wrapped in the
 * DCS passthrough (see wrapTmuxPassthrough).
 */
export function sendOscNotifications(
  title: string,
  body: string,
  { osc777, osc9 }: { osc777: boolean; osc9: boolean },
): void {
  if (!process.stdout.isTTY) return
  const sequences = oscNotifySequences(title, body, { osc777, osc9 }).map(
    (sequence) =>
      process.env.TMUX !== undefined ? wrapTmuxPassthrough(sequence) : sequence,
  )
  if (sequences.length > 0) process.stdout.write(sequences.join(''))
}
