import type { Component } from '@earendil-works/pi-tui'

import type { SessionRecord } from '../../stores/state-store.js'
import { toggleSessionStarred } from '../../stores/state-store.js'
import { jumpToSessionTmuxWindow } from '../tmux-jump.js'
import { Confirm } from './confirm.js'
import { SessionTable } from './session-table.js'
import type { Theme } from './theme.js'

export interface DashboardProps {
  tui: { requestRender: () => void }
  theme: Theme
  initialSessions: SessionRecord[]
  notifySymbol: string
  loadSessions: () => Promise<SessionRecord[]>
  onClose: () => void
  onDispose?: () => void
}

interface KillConfirm {
  sessionId: string
  dialog: Confirm
}

export class Dashboard implements Component {
  private readonly theme: Theme
  private readonly loadSessions: DashboardProps['loadSessions']
  private readonly onDispose: DashboardProps['onDispose']
  private readonly table: SessionTable
  private sessions: SessionRecord[]
  private disposed = false
  private confirmKill: KillConfirm | null = null

  constructor({
    tui,
    theme,
    initialSessions,
    notifySymbol,
    loadSessions,
    onClose,
    onDispose,
  }: DashboardProps) {
    this.theme = theme
    this.loadSessions = loadSessions
    this.onDispose = onDispose
    this.sessions = [...initialSessions]
    this.table = new SessionTable({
      tui,
      theme,
      initialSessions,
      notifySymbol,
      onRefresh: () => {
        this.refresh()
      },
      onToggleStar: (session) => {
        this.toggleStar(session)
      },
      onKillRequest: (session) => {
        this.requestKill(session)
      },
      onJump: (session) => {
        jumpToSessionTmuxWindow(session.pid)
      },
      onClose,
    })
  }

  private toggleStar(session: SessionRecord): void {
    void toggleSessionStarred(session.pid).then(() => {
      this.refresh()
    })
  }

  private requestKill(session: SessionRecord): void {
    if (session.pid === process.pid) return
    this.confirmKill = {
      sessionId: session.sessionId,
      dialog: new Confirm({
        theme: this.theme,
        message: `Kill "${session.projectName}" (pid ${session.pid})?`,
        onConfirm: () => {
          this.killBySessionId(session.sessionId)
        },
        onCancel: () => {
          this.confirmKill = null
          this.table.tick()
        },
      }),
    }
    this.table.tick()
  }

  private killBySessionId(sessionId: string): void {
    const session = this.sessions.find((s) => s.sessionId === sessionId)
    if (!session) {
      this.confirmKill = null
      this.table.tick()
      return
    }
    try {
      process.kill(session.pid, 'SIGTERM')
    } catch {
      // ignore ESRCH etc.
    }
    this.confirmKill = null
    this.refresh()
  }

  tick(): void {
    if (this.disposed) return
    this.table.tick()
  }

  refresh(): void {
    if (this.disposed) return
    this.loadSessions()
      .then((newSessions) => {
        if (this.disposed) return
        this.sessions = [...newSessions]
        this.table.setSessions(newSessions)
        const pending = this.confirmKill
        if (
          pending &&
          !this.sessions.some((s) => s.sessionId === pending.sessionId)
        ) {
          this.confirmKill = null
        }
      })
      .catch(() => {})
  }

  render(width: number): string[] {
    const footerLines =
      this.confirmKill !== null
        ? this.confirmKill.dialog.render(width)
        : this.table.hintLines(width)
    return [...this.table.render(width), '', ...footerLines]
  }

  handleInput(data: string): void {
    const confirm = this.confirmKill
    if (confirm) {
      confirm.dialog.handleInput(data)
      return
    }
    this.table.handleInput(data)
  }

  invalidate(): void {
    this.table.invalidate()
  }

  dispose(): void {
    this.disposed = true
    this.onDispose?.()
  }
}
