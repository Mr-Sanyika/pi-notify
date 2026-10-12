import { basename } from 'node:path'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { loadConfig } from './config.js'
import { DashboardCommand } from './dashboard/command.js'
import { FocusTracker } from './focus.js'
import { JobTracker } from './jobs.js'
import { notify } from './notifier.js'
import { NotifyTest } from './notify-test.js'
import type { Registerable } from './shared/types.js'
import { StateTracker } from './state-tracker.js'
import { SessionState } from './states.js'
import { SessionStore } from './stores/session-store.js'
import { TmuxTitleTracker } from './tmux-title.js'

export { JOB_END_EVENT, JOB_START_EVENT } from './jobs.js'
export { PI_NOTIFY_EVENT } from './state-tracker.js'

export default function piNotifyExtension(pi: ExtensionAPI): void {
  const config = loadConfig()
  const dirName = basename(process.cwd())
  const title = `pi — ${dirName}`

  const tmuxTitleTracker = new TmuxTitleTracker(pi, config)
  const focusTracker = new FocusTracker(pi, tmuxTitleTracker, config)
  const jobTracker = new JobTracker(pi)
  const stateTracker = new StateTracker(pi, jobTracker, config)
  const notifyTest = new NotifyTest(pi, title, tmuxTitleTracker, config)
  const sessionState = new SessionState(pi)
  const sessionStore = new SessionStore(pi, stateTracker)
  const dashboardCommand = new DashboardCommand(pi)

  function notifyReal(body: string): void {
    if (!config.enabled || !sessionState.hasUI) return
    if (config.onlyNotifyWhenUnfocused) {
      // Prefer the real focus state; fall back to inactivity timing for
      // terminals that lack focus reporting.
      const recentlyActive =
        Date.now() - focusTracker.lastActivityAt <=
        config.unfocusedActivityThresholdMs
      if (focusTracker.isFocused ?? recentlyActive) return
    }
    tmuxTitleTracker.mark()
    notify(title, body, config)
  }

  const registrables: Registerable[] = [
    tmuxTitleTracker,
    focusTracker,
    jobTracker,
    stateTracker,
    sessionStore,
    notifyTest,
    dashboardCommand,
  ]
  for (const r of registrables) r.register(notifyReal)
}
