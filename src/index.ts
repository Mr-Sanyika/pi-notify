import { basename } from 'node:path'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { loadConfig } from './config.js'
import { FocusTracker } from './focus.js'
import { notify } from './notifier.js'
import { NotifyTest } from './notify-test.js'
import type { Registerable } from './shared/types.js'
import { StateTracker } from './state-tracker.js'
import { SessionState } from './states.js'
import { TmuxTitleTracker } from './tmux-title.js'
import { UnreadTracker } from './unread-tracker.js'

export default function piNotifyExtension(pi: ExtensionAPI): void {
  const config = loadConfig()
  const dirName = basename(process.cwd())
  const title = `pi — ${dirName}`

  const tmuxTitleTracker = new TmuxTitleTracker(pi, config)
  const stateTracker = new StateTracker(pi, config)
  const unreadTracker = new UnreadTracker({ titleTracker: tmuxTitleTracker })
  const focusTracker = new FocusTracker(pi, unreadTracker)
  const notifyTest = new NotifyTest(pi, title, unreadTracker)
  const sessionState = new SessionState(pi)

  function notifyReal(body: string): void {
    if (!config.enabled || !sessionState.hasUI) return
    unreadTracker.markUnread()
    notify(title, body)
  }

  const registrables: Registerable[] = [
    tmuxTitleTracker,
    focusTracker,
    stateTracker,
    notifyTest,
  ]
  for (const r of registrables) r.register(notifyReal)
}
