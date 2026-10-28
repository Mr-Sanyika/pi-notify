import { execFileSync } from 'node:child_process'
import { readlinkSync } from 'node:fs'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import type { ResolvedNotifyConfig } from './config.js'
import { Registrar } from './shared/registrar.js'
import type { NotifyAction } from './shared/types.js'

const WINDOW_ID_FORMAT = '#{window_id}'
const WINDOW_NAME_FORMAT = '#{window_name}'
const LIST_FORMAT = '#{pane_tty}\t#{window_id}'
const NEWLINE = '\n'
const TAB = '\t'

export class TmuxTitleTracker extends Registrar {
  private readonly config: ResolvedNotifyConfig
  private windowId: string | undefined
  private originalTitle: string | undefined
  private autoRename: boolean | undefined
  private modified = false

  constructor(pi: ExtensionAPI, config: ResolvedNotifyConfig) {
    super(pi)
    this.config = config
  }

  private get enabled(): boolean {
    return this.config.notifySymbol.length > 0
  }

  protected override setup(notify: NotifyAction): void {
    void notify
    this.pi.on('session_start', (_event, ctx) => {
      if (ctx.mode !== 'tui' || !this.enabled) return
      this.restore()
      const id = this.queryCurrentWindowId()
      if (id === undefined) return
      this.windowId = id
      this.originalTitle = this.queryWindowName(id)
      this.autoRename = this.queryAutomaticRename(id)
    })
  }

  mark(): void {
    if (
      !this.enabled ||
      this.modified ||
      this.windowId === undefined ||
      this.originalTitle === undefined
    )
      return
    this.renameWindow(
      this.windowId,
      `${this.originalTitle}${this.config.notifySymbol}`,
    )
    this.modified = true
  }

  restore(): void {
    if (
      !this.enabled ||
      !this.modified ||
      this.windowId === undefined ||
      this.originalTitle === undefined
    )
      return
    this.renameWindow(this.windowId, this.originalTitle)
    if (this.autoRename === undefined) {
      this.unsetAutomaticRename(this.windowId)
    } else {
      this.setAutomaticRename(this.windowId, this.autoRename)
    }
    this.modified = false
  }

  override stop(): void {
    super.stop()
    this.restore()
    this.windowId = undefined
    this.originalTitle = undefined
    this.autoRename = undefined
    this.modified = false
  }

  private queryCurrentWindowId(): string | undefined {
    if (process.env.TMUX === undefined) return undefined
    const tty = this.ourTty()
    if (tty !== undefined) {
      const id = this.findWindowByTty(tty)
      if (id !== undefined) return id
    }
    return this.queryActiveWindowId()
  }

  private queryWindowName(windowId: string): string | undefined {
    try {
      const name = execFileSync(
        'tmux',
        ['display-message', '-t', windowId, '-p', WINDOW_NAME_FORMAT],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      )
      return name.trim() || undefined
    } catch {
      return undefined
    }
  }

  private renameWindow(windowId: string, name: string): void {
    try {
      execFileSync('tmux', ['rename-window', '-t', windowId, name], {
        stdio: 'ignore',
      })
    } catch {
      // best-effort; the window title is non-critical
    }
  }

  private ourTty(): string | undefined {
    for (const fd of ['0', '1', '2']) {
      try {
        const target = readlinkSync(`/proc/self/fd/${fd}`)
        if (target.startsWith('/dev/')) return target
      } catch {
        // fd is not a tty, or platform without /proc/self/fd
      }
    }
    return undefined
  }

  private findWindowByTty(tty: string): string | undefined {
    try {
      const out = execFileSync(
        'tmux',
        ['list-panes', '-a', '-F', LIST_FORMAT],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      )
      for (const line of out.split(NEWLINE)) {
        const [paneTty, windowId] = line.split(TAB)
        if (paneTty === tty) return windowId
      }
      return undefined
    } catch {
      return undefined
    }
  }

  private queryActiveWindowId(): string | undefined {
    try {
      const id = execFileSync(
        'tmux',
        ['display-message', '-p', WINDOW_ID_FORMAT],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      )
      return id.trim() || undefined
    } catch {
      return undefined
    }
  }

  private queryAutomaticRename(windowId: string): boolean | undefined {
    try {
      const value = execFileSync(
        'tmux',
        ['show-window-options', '-t', windowId, '-v', 'automatic-rename'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      )
      const trimmed = value.trim()
      // Empty output means no window-local override exists; the window
      // inherits the global option. Restore by unsetting, not by forcing
      // a value, so it keeps inheriting whatever the global is.
      if (trimmed === '') return undefined
      return trimmed === 'on'
    } catch {
      return undefined
    }
  }

  private setAutomaticRename(windowId: string, enabled: boolean): void {
    try {
      execFileSync(
        'tmux',
        [
          'set-window-option',
          '-t',
          windowId,
          'automatic-rename',
          enabled ? 'on' : 'off',
        ],
        {
          stdio: 'ignore',
        },
      )
    } catch {
      // best-effort; the window title is non-critical
    }
  }

  private unsetAutomaticRename(windowId: string): void {
    try {
      execFileSync(
        'tmux',
        ['set-window-option', '-t', windowId, '-u', 'automatic-rename'],
        {
          stdio: 'ignore',
        },
      )
    } catch {
      // best-effort; the window title is non-critical
    }
  }
}
