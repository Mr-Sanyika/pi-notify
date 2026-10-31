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

/** Run a tmux command and return its trimmed stdout, or undefined on failure. */
function tmuxQuery(args: readonly string[]): string | undefined {
  try {
    const out = execFileSync('tmux', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() || undefined
  } catch {
    return undefined
  }
}

/** Run a tmux command for its effect; the window title is never critical. */
function tmuxRun(args: readonly string[]): void {
  try {
    execFileSync('tmux', args, { stdio: 'ignore' })
  } catch {
    // best-effort
  }
}

/**
 * Appends `notifySymbol` to the tmux window title while a notification is
 * unread, so a background window that wants attention is visible in the status
 * bar. Purely cosmetic: every tmux call is best effort.
 */
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
      // A previous pi may have left its marker behind.
      this.restore()
      const id = this.queryCurrentWindowId()
      if (id === undefined) return
      this.windowId = id
      this.originalTitle = tmuxQuery([
        'display-message',
        '-t',
        id,
        '-p',
        WINDOW_NAME_FORMAT,
      ])
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
    tmuxRun([
      'rename-window',
      '-t',
      this.windowId,
      `${this.originalTitle}${this.config.notifySymbol}`,
    ])
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
    tmuxRun(['rename-window', '-t', this.windowId, this.originalTitle])
    // Renaming pins the window name, so put automatic-rename back the way it
    // was — unset when the window inherited the global value.
    tmuxRun(
      this.autoRename === undefined
        ? ['set-window-option', '-t', this.windowId, '-u', 'automatic-rename']
        : [
            'set-window-option',
            '-t',
            this.windowId,
            'automatic-rename',
            this.autoRename ? 'on' : 'off',
          ],
    )
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
    // Fall back to the active window when this process is not attached to a tty
    // we can resolve (e.g. a piped run inside an active pane).
    return tmuxQuery(['display-message', '-p', WINDOW_ID_FORMAT])
  }

  private ourTty(): string | undefined {
    for (const fd of ['0', '1', '2']) {
      try {
        const target = readlinkSync(`/proc/self/fd/${fd}`)
        if (target.startsWith('/dev/')) return target
      } catch {
        // fd is not a tty
      }
    }
    return undefined
  }

  private findWindowByTty(tty: string): string | undefined {
    const out = tmuxQuery(['list-panes', '-a', '-F', LIST_FORMAT])
    if (out === undefined) return undefined
    for (const line of out.split(NEWLINE)) {
      const [paneTty, windowId] = line.split(TAB)
      if (paneTty === tty) return windowId
    }
    return undefined
  }

  private queryAutomaticRename(windowId: string): boolean | undefined {
    // Empty output means the window inherits the global option.
    const value = tmuxQuery([
      'show-window-options',
      '-t',
      windowId,
      '-v',
      'automatic-rename',
    ])
    if (value === undefined) return undefined
    return value === 'on'
  }
}
