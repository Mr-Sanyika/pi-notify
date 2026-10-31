import { execFile } from 'node:child_process'

const APP_NAME = 'pi'

/** Set once `notify-send` turns out to be missing; the session then stays quiet. */
let unavailable = false

/**
 * Fire a desktop notification through `notify-send`.
 *
 * Linux only by design: the notification daemon (mako, dunst, GNOME, KDE, …)
 * owns the rendering, so no platform detection is needed here. Best effort — a
 * notification must never affect the agent, so failures are ignored.
 */
export function notify(title: string, body: string): void {
  if (unavailable) return
  execFile('notify-send', ['-a', APP_NAME, title, body], (error) => {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      unavailable = true
    }
  })
}

/** Whether `notify-send` was found; only used to explain a silent `/notify-test`. */
export function isNotifySendAvailable(): boolean {
  return !unavailable
}
