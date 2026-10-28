import type { Component } from '@earendil-works/pi-tui'
import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import { clamp } from 'lodash-es'

import type { SessionRecord } from '../../stores/state-store.js'
import {
  COLUMN_SEPARATOR,
  resolveColumns,
  type ResolvedColumn,
} from './columns.js'
import { wrapUnits } from './footer.js'
import type { Theme } from './theme.js'

const HINT_KEYS: [string, string][] = [
  ['j/k/↑↓', 'move'],
  ['enter', 'jump'],
  ['space', 'star'],
  ['x', 'kill'],
  ['o', 'show/hide ids'],
  ['r', 'refresh'],
  ['q', 'close'],
]

export interface SessionTableProps {
  tui: { requestRender: () => void }
  theme: Theme
  initialSessions: SessionRecord[]
  notifySymbol: string
  onRefresh: () => void
  onToggleStar: (session: SessionRecord) => void
  onKillRequest: (session: SessionRecord) => void
  onJump: (session: SessionRecord) => void
  onClose: () => void
}

export class SessionTable implements Component {
  private readonly tui: SessionTableProps['tui']
  private readonly theme: Theme
  private readonly onRefresh: SessionTableProps['onRefresh']
  private readonly onToggleStar: SessionTableProps['onToggleStar']
  private readonly onKillRequest: SessionTableProps['onKillRequest']
  private readonly onJump: SessionTableProps['onJump']
  private readonly onClose: SessionTableProps['onClose']
  private readonly notifySymbol: string
  private sessions: SessionRecord[]
  private selectedIndex = 0
  private showHidden = false
  private cachedWidth: number | null = null
  private cachedLines: string[] = []

  hintLines(width: number): string[] {
    const units = HINT_KEYS.map(
      ([key, desc]) =>
        `${this.theme.fg('syntaxKeyword', `[${key}]`)} ${this.theme.fg('success', desc)}`,
    )
    return wrapUnits(this.theme, width, units)
  }

  constructor({
    tui,
    theme,
    initialSessions,
    onRefresh,
    onToggleStar,
    onKillRequest,
    onJump,
    onClose,
    notifySymbol,
  }: SessionTableProps) {
    this.tui = tui
    this.theme = theme
    this.onRefresh = onRefresh
    this.onToggleStar = onToggleStar
    this.onKillRequest = onKillRequest
    this.onJump = onJump
    this.onClose = onClose
    this.notifySymbol = notifySymbol
    this.sessions = [...initialSessions]
  }

  private forceRender(): void {
    this.cachedWidth = null
    this.tui.requestRender()
  }

  private clampSelection(): void {
    if (this.sessions.length === 0) return
    this.selectedIndex = clamp(this.selectedIndex, 0, this.sessions.length - 1)
  }

  private moveSelection(delta: 1 | -1): void {
    if (this.sessions.length === 0) return
    this.selectedIndex += delta
    this.clampSelection()
    this.forceRender()
  }

  private selectedSession(): SessionRecord | undefined {
    return this.sessions[this.selectedIndex]
  }

  setSessions(sessions: SessionRecord[]): void {
    const selected = this.sessions[this.selectedIndex]
    this.sessions = [...sessions]
    if (selected) {
      const index = this.sessions.findIndex((s) => s.pid === selected.pid)
      if (index >= 0) this.selectedIndex = index
    }
    this.clampSelection()
    this.forceRender()
  }

  private headerLine(columns: ResolvedColumn[]): string {
    return columns
      .map(({ col, width }) => col.name.padEnd(width))
      .join(COLUMN_SEPARATOR)
  }

  private summaryLine(width: number): string {
    const total = this.sessions.length
    const running = this.sessions.filter((s) => s.state === 'running').length
    const idle = total - running
    const sep = this.theme.fg('dim', ' · ')
    return truncateToWidth(
      [
        `total ${this.theme.fg('text', String(total))}`,
        `running ${this.theme.fg('success', String(running))}`,
        `idle ${this.theme.fg('muted', String(idle))}`,
      ].join(sep),
      width,
      '…',
    )
  }

  render(width: number): string[] {
    if (this.cachedWidth === width) {
      return this.cachedLines
    }
    const tableWidth = width - 2
    const columns = resolveColumns(
      tableWidth,
      this.showHidden,
      this.notifySymbol,
    )
    const lines = [
      this.summaryLine(width),
      '',
      this.theme.fg('borderAccent', `  ${this.headerLine(columns)}`),
      this.theme.fg('borderAccent', `  ${'─'.repeat(Math.max(1, tableWidth))}`),
      ...this.sessions.map((session, index) => {
        const row = columns
          .map(({ col, width }) => col.render(session, this.theme, width))
          .join(COLUMN_SEPARATOR)
        const selected = index === this.selectedIndex
        const gutter = selected ? '> ' : '  '
        const styledRow = selected ? this.theme.underline(row) : row
        return gutter + styledRow
      }),
    ]
    this.cachedLines = lines.map((line) => truncateToWidth(line, width, '…'))
    this.cachedWidth = width
    return this.cachedLines
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'j') || matchesKey(data, Key.down)) {
      this.moveSelection(1)
      return
    }

    if (matchesKey(data, 'k') || matchesKey(data, Key.up)) {
      this.moveSelection(-1)
      return
    }

    if (matchesKey(data, Key.space)) {
      const session = this.selectedSession()
      if (session) this.onToggleStar(session)
      return
    }

    if (matchesKey(data, 'x')) {
      const session = this.selectedSession()
      if (session) this.onKillRequest(session)
      return
    }

    if (matchesKey(data, 'r')) {
      this.onRefresh()
      return
    }

    if (matchesKey(data, Key.enter)) {
      const session = this.selectedSession()
      if (session) this.onJump(session)
      return
    }

    if (matchesKey(data, 'q')) {
      this.onClose()
      return
    }

    if (matchesKey(data, 'o')) {
      this.showHidden = !this.showHidden
      this.forceRender()
    }
  }

  tick(): void {
    this.forceRender()
  }

  invalidate(): void {
    this.cachedWidth = null
  }
}
