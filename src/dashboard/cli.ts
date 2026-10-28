import process from 'node:process'

import {
  matchesKey,
  ProcessTerminal,
  TuiAltScreen,
} from '@earendil-works/pi-tui'

import { loadConfig } from '../config.js'
import { readSessions, type SessionRecord } from '../stores/state-store.js'
import { watchStore } from '../stores/watch-store.js'
import {
  markDashboardTmuxPane,
  registerDashboardTmuxBinding,
  unmarkDashboardTmuxPane,
} from './tmux-binding.js'
import { Dashboard } from './ui/dashboard.js'
import { createTheme } from './ui/theme.js'

const inTmux = process.env.TMUX !== undefined

interface DashboardHandle {
  stop(): Promise<void>
}

function runDashboard(
  initialSessions: SessionRecord[],
  notifySymbol: string,
): Promise<DashboardHandle> {
  return new Promise((resolve) => {
    const terminal = new ProcessTerminal()
    const tui = new TuiAltScreen(terminal)
    const theme = createTheme()

    const dashboard = new Dashboard({
      tui: {
        requestRender: () => {
          tui.requestRender()
        },
      },
      theme,
      initialSessions,
      notifySymbol,
      loadSessions: () => readSessions(),
      onClose: finish,
    })

    let stopWatching: (() => void) | undefined
    let tickTimer: NodeJS.Timeout | undefined
    let stopped = false

    function teardown(): void {
      if (tickTimer !== undefined) clearInterval(tickTimer)
      stopWatching?.()
      dashboard.dispose()
      tui.stop()
    }

    const handle: DashboardHandle = {
      stop: async () => {
        if (stopped) return
        stopped = true
        teardown()
        await terminal.drainInput()
      },
    }

    function finish(): void {
      resolve(handle)
    }

    try {
      tui.setLayoutRoot(dashboard)
      tui.start()
      tui.setFocus(dashboard)

      stopWatching = watchStore(() => {
        dashboard.refresh()
      })
      tickTimer = setInterval(() => {
        dashboard.tick()
      }, 1000)
      tickTimer.unref()

      // Ctrl+C in raw mode arrives as regular input, not SIGINT.
      tui.addInputListener((data) => {
        if (matchesKey(data, 'ctrl+c')) {
          finish()
          return { consume: true }
        }
        return undefined
      })

      process.on('SIGINT', finish)
      process.on('SIGTERM', finish)
    } catch (err) {
      teardown()
      void terminal.drainInput()
      throw err
    }
  })
}

async function main(): Promise<void> {
  const cfg = loadConfig()
  if (inTmux) {
    markDashboardTmuxPane()
    registerDashboardTmuxBinding(
      cfg.dashboardTmuxKey,
      cfg.dashboardTmuxKeyNeedsPrefix,
    )
  }

  const initialSessions = await readSessions()

  let exitCode = 0
  try {
    const dashboard = await runDashboard(initialSessions, cfg.notifySymbol)
    await dashboard.stop()
  } catch (err) {
    console.error(err)
    exitCode = 1
  } finally {
    if (inTmux) unmarkDashboardTmuxPane()
  }
  process.exit(exitCode)
}

void main()
