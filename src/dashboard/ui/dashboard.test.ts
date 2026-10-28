import { Key, visibleWidth } from '@earendil-works/pi-tui'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type MockInstance,
  vi,
} from 'vitest'

import type { SessionState } from '../../stores/consts.js'
import type { SessionRecord } from '../../stores/state-store.js'
import { toggleSessionStarred } from '../../stores/state-store.js'
import { jumpToSessionTmuxWindow } from '../tmux-jump.js'
import { Dashboard } from './dashboard.js'
import type { Theme, ThemeColor } from './theme.js'

vi.mock('../tmux-jump.js', () => ({
  jumpToSessionTmuxWindow: vi.fn(),
}))

vi.mock('../../stores/state-store.js', () => ({
  toggleSessionStarred: vi.fn(),
}))

const theme: Theme = {
  fg: (_color: ThemeColor, text: string) => `\x1b[90m${text}\x1b[0m`,
  underline: (text: string) => `\x1b[4m${text}\x1b[0m`,
}

const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\[[0-9;?]*[ -/]*[@-~]/g
const stripAnsi = (line: string): string => line.replace(ANSI_RE, '')

function makeSession(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    pid: 123,
    sessionId: 'abc123',
    cwd: '/tmp',
    projectName: 'proj',
    startedAt: Date.now(),
    state: 'idle',
    ...overrides,
  }
}

function makeDashboard(
  sessions: SessionRecord[],
  overrides: Partial<{
    loadSessions: () => Promise<SessionRecord[]>
    onClose: () => void
    notifySymbol: string
  }> = {},
) {
  const loadSessions = overrides.loadSessions ?? (async () => sessions)
  return new Dashboard({
    tui: { requestRender: () => {} },
    theme,
    initialSessions: sessions,
    notifySymbol: overrides.notifySymbol ?? '',
    loadSessions,
    onClose: overrides.onClose ?? (() => {}),
  })
}
describe('Dashboard render clipping', () => {
  const longNameSession = makeSession({
    projectName: 'a-very-long-project-name-that-exceeds-any-narrow-width',
  })

  it('clips every line to the terminal width at narrow widths', () => {
    const dashboard = makeDashboard([longNameSession])
    for (const line of dashboard.render(40)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40)
    }
    dashboard.dispose()
  })

  it('does not add ellipsis or padding at wide widths', () => {
    const dashboard = makeDashboard([longNameSession])
    for (const line of dashboard.render(200)) {
      expect(line).not.toContain('…')
      expect(line.endsWith(' ')).toBe(false)
    }
    dashboard.dispose()
  })

  it('wraps the footer hint units at width 20 without truncation', () => {
    const dashboard = makeDashboard([makeSession({})])
    const lines = dashboard.render(20)
    const visible = lines.map(stripAnsi)
    const header = visible.find((l) => l.includes('STATE'))
    expect(header).toBeDefined()
    if (!header) throw new Error('unreachable')
    expect(header.startsWith('  🔔 ★')).toBe(true)
    expect(header.endsWith('…')).toBe(true)
    const footer = visible.filter((l) => l.startsWith('['))
    expect(footer).toEqual([
      '[j/k/↑↓] move',
      '[enter] jump',
      '[space] star',
      '[x] kill',
      '[o] show/hide ids',
      '[r] refresh',
      '[q] close',
    ])
    dashboard.dispose()
  })

  it('keeps two units on one line when they fit the width exactly', () => {
    const dashboard = makeDashboard([makeSession({})])
    const unitA = '[j/k/↑↓] move'
    const unitB = '[enter] jump'
    const exactWidth =
      visibleWidth(unitA) + visibleWidth(' · ') + visibleWidth(unitB)
    const footer = dashboard
      .render(exactWidth)
      .map(stripAnsi)
      .filter((l) => l.startsWith('['))
    expect(footer[0]).toBe(`${unitA} · ${unitB}`)
    dashboard.dispose()
  })

  it('wraps the next unit when the exact fit is one column short', () => {
    const dashboard = makeDashboard([makeSession({})])
    const unitA = '[j/k/↑↓] move'
    const unitB = '[enter] jump'
    const narrowWidth =
      visibleWidth(unitA) + visibleWidth(' · ') + visibleWidth(unitB) - 1
    const footer = dashboard
      .render(narrowWidth)
      .map(stripAnsi)
      .filter((l) => l.startsWith('['))
    expect(footer[0]).toBe(unitA)
    expect(footer[1]).toBe(`${unitB} · [space] star`)
    dashboard.dispose()
  })

  it('truncates a single unit wider than the terminal', () => {
    const dashboard = makeDashboard([makeSession({})])
    const wideUnit = '[o] show/hide ids'
    const width = visibleWidth(wideUnit) - 1
    const footer = dashboard
      .render(width)
      .map(stripAnsi)
      .filter((l) => l.startsWith('['))
    const truncated = footer.find((l) => l.startsWith('[o] show'))
    expect(truncated).toBeDefined()
    if (!truncated) throw new Error('unreachable')
    expect(truncated.includes('…')).toBe(true)
    expect(visibleWidth(truncated)).toBeLessThanOrEqual(width)
    dashboard.dispose()
  })

  it('aligns header columns with session rows via the 2-char gutter', () => {
    const dashboard = makeDashboard([makeSession({ starred: true })])
    const lines = dashboard.render(200).map(stripAnsi)
    const header = lines.find((l) => l.includes('STATE'))
    const row = lines.find((l) => l.includes('proj'))
    expect(header).toBeDefined()
    expect(row).toBeDefined()
    if (!header || !row) throw new Error('unreachable')
    expect(header.indexOf('★')).toBe(row.indexOf('★'))
    expect(header.indexOf('PROJECT')).toBe(row.indexOf('proj'))
    expect(header.indexOf('STATE')).toBe(8)
    dashboard.dispose()
  })

  it('counts CJK project names by display width', () => {
    const dashboard = makeDashboard([
      makeSession({ projectName: '中文项目名' }),
    ])
    for (const line of dashboard.render(40)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40)
    }
    dashboard.dispose()
  })
})

describe('hidden column toggle', () => {
  it('hides hidden columns by default and toggles with o', () => {
    const dashboard = makeDashboard([makeSession({})])
    try {
      const headerOf = () => {
        const lines = dashboard.render(200).map(stripAnsi)
        return lines.find((l) => l.includes('STATE') && l.includes('RUNNING'))
      }

      let header = headerOf()
      expect(header).toContain('STATE')
      expect(header).not.toContain('SESSION_ID')
      expect(header).not.toContain('PID')

      dashboard.handleInput('o')
      header = headerOf()
      expect(header).toContain('SESSION_ID')
      expect(header).toContain('PID')

      dashboard.handleInput('o')
      header = headerOf()
      expect(header).not.toContain('SESSION_ID')
      expect(header).not.toContain('PID')
    } finally {
      dashboard.dispose()
    }
  })
})

describe('summary running count', () => {
  // Activity-prefixed states are "recent activity" markers, not running.
  it.each<[SessionState]>([
    ['ui:custom:'],
    ['notify:test'],
    ['event:x'],
    ['tool_call:bash'],
  ])('%s state is not counted as running', (state) => {
    const dashboard = makeDashboard([makeSession({ state })])
    try {
      const line = dashboard
        .render(300)
        .map(stripAnsi)
        .find((l) => l.includes('total 1'))
      expect(line).toBeDefined()
      expect(line).toContain('running 0')
      expect(line).toContain('idle 1')
    } finally {
      dashboard.dispose()
    }
  })
})

describe('dashboard state display', () => {
  it('renders dashboard as state for the dashboard pid from env', () => {
    const previous = process.env.PI_NOTIFY_DASHBOARD_PID
    process.env.PI_NOTIFY_DASHBOARD_PID = '123'
    const dashboard = makeDashboard([makeSession({ pid: 123, state: 'idle' })])
    dashboard.handleInput('o')
    try {
      const row = dashboard
        .render(200)
        .map(stripAnsi)
        .find((l) => l.includes('abc123'))
      expect(row).toBeDefined()
      expect(row).toContain('dashboard')
      expect(row).not.toContain('idle')
    } finally {
      if (previous === undefined) delete process.env.PI_NOTIFY_DASHBOARD_PID
      else process.env.PI_NOTIFY_DASHBOARD_PID = previous
      dashboard.dispose()
    }
  })

  it('keeps real state for other pids', () => {
    const dashboard = makeDashboard([
      makeSession({ pid: 999, state: 'running' }),
    ])
    dashboard.handleInput('o')
    try {
      const row = dashboard
        .render(200)
        .map(stripAnsi)
        .find((l) => l.includes('abc123'))
      expect(row).toBeDefined()
      expect(row).toContain('running')
      expect(row).not.toContain('dashboard')
    } finally {
      dashboard.dispose()
    }
  })
})

describe('auto-refresh', () => {
  it('manual r triggers refresh', () => {
    const loadSessions = vi.fn(async () => [makeSession({})])
    const dashboard = makeDashboard([makeSession({})], { loadSessions })
    dashboard.handleInput('r')
    expect(loadSessions).toHaveBeenCalledTimes(1)
    dashboard.dispose()
  })

  it('dispose stops further refreshes', () => {
    const loadSessions = vi.fn(async () => [makeSession({})])
    const dashboard = makeDashboard([makeSession({})], { loadSessions })
    dashboard.dispose()
    dashboard.handleInput('r')
    expect(loadSessions).not.toHaveBeenCalled()
  })
})

describe('selection navigation', () => {
  const rows = (dashboard: Dashboard) =>
    dashboard
      .render(200)
      .map(stripAnsi)
      .filter((l) => l.includes('proj'))

  it('starts with first row selected and moves with j/k and arrows', () => {
    const dashboard = makeDashboard([
      makeSession({ pid: 1, sessionId: 'abc123' }),
      makeSession({ pid: 2, sessionId: 'def456' }),
      makeSession({ pid: 3, sessionId: 'ghi789' }),
    ])
    try {
      dashboard.handleInput('o')
      let [first, second, third] = rows(dashboard)
      expect(first?.startsWith('> ')).toBe(true)
      expect(second?.startsWith('  ')).toBe(true)

      dashboard.handleInput('j')
      ;[first, second, third] = rows(dashboard)
      expect(first?.startsWith('  ')).toBe(true)
      expect(second?.startsWith('> ')).toBe(true)

      dashboard.handleInput('\x1b[B')
      ;[first, second, third] = rows(dashboard)
      expect(third?.startsWith('> ')).toBe(true)

      dashboard.handleInput('k')
      dashboard.handleInput('\x1b[A')
      ;[first, second, third] = rows(dashboard)
      expect(first?.startsWith('> ')).toBe(true)
    } finally {
      dashboard.dispose()
    }
  })

  it('clamps selection at first and last row', () => {
    const dashboard = makeDashboard([
      makeSession({ pid: 1, sessionId: 'abc123' }),
      makeSession({ pid: 2, sessionId: 'def456' }),
    ])
    try {
      dashboard.handleInput('o')
      dashboard.handleInput('k')
      expect(rows(dashboard)[0]?.startsWith('> ')).toBe(true)

      dashboard.handleInput('j')
      dashboard.handleInput('j')
      const rowsNow = rows(dashboard)
      expect(rowsNow[0]?.startsWith('  ')).toBe(true)
      expect(rowsNow[1]?.startsWith('> ')).toBe(true)
    } finally {
      dashboard.dispose()
    }
  })

  it('clamps selection to the last row after refresh shrinks the list', async () => {
    const loadSessions = vi.fn(async () => [
      makeSession({ pid: 3, sessionId: 'ghi789' }),
    ])
    const dashboard = makeDashboard(
      [
        makeSession({ pid: 1, sessionId: 'abc123' }),
        makeSession({ pid: 2, sessionId: 'def456' }),
        makeSession({ pid: 4, sessionId: 'jkl012' }),
      ],
      { loadSessions },
    )
    try {
      dashboard.handleInput('o')
      dashboard.handleInput('j')
      dashboard.handleInput('j')
      expect(rows(dashboard)[2]?.startsWith('> ')).toBe(true)

      dashboard.handleInput('r')
      await vi.waitFor(() => {
        expect(loadSessions).toHaveBeenCalled()
      })

      dashboard.handleInput('j')
      const visible = rows(dashboard)
      expect(visible).toHaveLength(1)
      expect(visible[0]?.startsWith('> ')).toBe(true)
    } finally {
      dashboard.dispose()
    }
  })

  it('no-ops on empty session list', () => {
    const dashboard = makeDashboard([])
    try {
      dashboard.handleInput('j')
      dashboard.handleInput('k')
      dashboard.handleInput('x')
      expect(
        dashboard.render(200).some((l) => stripAnsi(l).startsWith('> ')),
      ).toBe(false)
    } finally {
      dashboard.dispose()
    }
  })
})

describe('enter jump', () => {
  const jump = vi.mocked(jumpToSessionTmuxWindow)

  it('jumps to the selected session tmux window on enter', () => {
    const dashboard = makeDashboard([
      makeSession({ pid: 1, sessionId: 'abc123' }),
      makeSession({ pid: 2, sessionId: 'def456' }),
    ])
    try {
      dashboard.handleInput('j')
      dashboard.handleInput('\r')
      expect(jump).toHaveBeenCalledWith(2)
    } finally {
      dashboard.dispose()
      jump.mockClear()
    }
  })

  it('does not jump on empty session list', () => {
    const dashboard = makeDashboard([])
    try {
      dashboard.handleInput('\r')
      expect(jump).not.toHaveBeenCalled()
    } finally {
      dashboard.dispose()
      jump.mockClear()
    }
  })
})

describe('kill action', () => {
  let killSpy: ReturnType<typeof vi.spyOn>

  const rows = (dashboard: Dashboard) =>
    dashboard
      .render(200)
      .map(stripAnsi)
      .filter((l) => l.includes('proj'))

  it('kills the selected session with SIGTERM', async () => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const loadSessions = vi.fn(async () => [
      makeSession({ pid: process.pid, sessionId: 'abc123' }),
    ])
    const dashboard = makeDashboard(
      [
        makeSession({ pid: process.pid, sessionId: 'self001' }),
        makeSession({ pid: 999, sessionId: 'target1' }),
      ],
      { loadSessions },
    )
    try {
      dashboard.handleInput('o')
      dashboard.handleInput('j')
      expect(rows(dashboard)[1]?.startsWith('> ')).toBe(true)
      dashboard.handleInput('x')
      dashboard.handleInput('y')
      expect(killSpy).toHaveBeenCalledWith(999, 'SIGTERM')
      await vi.waitFor(() => {
        expect(loadSessions).toHaveBeenCalled()
      })
    } finally {
      dashboard.dispose()
      killSpy.mockRestore()
    }
  })

  it('does not kill the dashboard own row', () => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const dashboard = makeDashboard([
      makeSession({ pid: process.pid, sessionId: 'abc123' }),
    ])
    try {
      dashboard.handleInput('x')
      expect(killSpy).not.toHaveBeenCalled()
    } finally {
      dashboard.dispose()
      killSpy.mockRestore()
    }
  })

  it('ignores ESRCH errors from kill', () => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    const dashboard = makeDashboard([
      makeSession({ pid: 999, sessionId: 'abc123' }),
    ])
    try {
      expect(() => {
        dashboard.handleInput('x')
      }).not.toThrow()
    } finally {
      dashboard.dispose()
      killSpy.mockRestore()
    }
  })
})

describe('selection degradation', () => {
  it('follows the selected session as the list shrinks', async () => {
    const loadSessions = vi.fn(async () => [
      makeSession({ pid: 2, sessionId: 'bbb' }),
    ])
    const dashboard = makeDashboard(
      [
        makeSession({ pid: 1, sessionId: 'aaa' }),
        makeSession({ pid: 2, sessionId: 'bbb' }),
      ],
      { loadSessions },
    )
    try {
      dashboard.handleInput('r')
      await vi.waitFor(() => {
        expect(loadSessions).toHaveBeenCalled()
      })
      const visible = dashboard
        .render(200)
        .map(stripAnsi)
        .filter((l) => l.includes('proj'))
      expect(visible).toHaveLength(1)
      expect(visible[0]?.startsWith('> ')).toBe(true)

      const emptyRefresh = vi.fn(async () => [])
      const dashboard2 = makeDashboard(
        [makeSession({ pid: 2, sessionId: 'abc123' })],
        { loadSessions: emptyRefresh },
      )
      try {
        dashboard2.handleInput('r')
        await vi.waitFor(() => {
          expect(emptyRefresh).toHaveBeenCalled()
        })
        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
        try {
          dashboard2.handleInput('j')
          dashboard2.handleInput('x')
          expect(
            dashboard2.render(200).some((l) => stripAnsi(l).startsWith('> ')),
          ).toBe(false)
          expect(killSpy).not.toHaveBeenCalled()
        } finally {
          killSpy.mockRestore()
        }
      } finally {
        dashboard2.dispose()
      }
    } finally {
      dashboard.dispose()
    }
  })
})

describe('star toggle', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    vi.mocked(toggleSessionStarred).mockClear()
  })

  it('space calls toggleSessionStarred with the selected pid then refreshes', async () => {
    vi.mocked(toggleSessionStarred).mockResolvedValue(true)
    const loadSessions = vi.fn(async () => [makeSession({ pid: 42 })])
    const dashboard = makeDashboard([makeSession({ pid: 42 })], {
      loadSessions,
    })
    try {
      dashboard.handleInput(' ')
      await flush()

      expect(toggleSessionStarred).toHaveBeenCalledWith(42)
      expect(loadSessions).toHaveBeenCalled()
    } finally {
      dashboard.dispose()
    }
  })

  it('does nothing on space with an empty list', async () => {
    const dashboard = makeDashboard([], {
      loadSessions: vi.fn(async () => []),
    })
    try {
      dashboard.handleInput(' ')
      await flush()

      expect(toggleSessionStarred).not.toHaveBeenCalled()
    } finally {
      dashboard.dispose()
    }
  })

  it('keeps selection on the same session after a re-sorting refresh', async () => {
    const first = makeSession({ pid: 1 })
    const second = makeSession({ pid: 2 })
    const dashboard = makeDashboard([first, second], {
      loadSessions: async () => [{ ...second, starred: true }, first],
    })
    try {
      dashboard.handleInput('j')
      dashboard.handleInput('r')
      await flush()

      const rows = dashboard
        .render(200)
        .map(stripAnsi)
        .filter((l) => l.includes('proj'))
      expect(rows[0]?.startsWith('> ')).toBe(true)
    } finally {
      dashboard.dispose()
    }
  })
})

describe('kill confirmation', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  let killSpy: MockInstance
  let onClose: Mock
  let dashboard: Dashboard

  const confirming = () =>
    dashboard.render(200).some((l) => l.includes('[y] confirm'))

  beforeEach(() => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    onClose = vi.fn()
    dashboard = makeDashboard([makeSession({ pid: 42 })], { onClose })
  })

  afterEach(() => {
    dashboard.dispose()
    killSpy.mockRestore()
  })

  it('x alone does not kill and shows the confirm line', () => {
    dashboard.handleInput('x')
    expect(killSpy).not.toHaveBeenCalled()
    expect(confirming()).toBe(true)
  })

  it('x then y kills with SIGTERM and refreshes', async () => {
    const loadSessions = vi.fn(async () => [makeSession({ pid: 42 })])
    dashboard = makeDashboard([makeSession({ pid: 42 })], {
      loadSessions,
      onClose,
    })
    dashboard.handleInput('x')
    expect(confirming()).toBe(true)
    dashboard.handleInput('y')
    expect(killSpy).toHaveBeenCalledWith(42, 'SIGTERM')
    await flush()
    expect(loadSessions).toHaveBeenCalled()
  })

  it('x then n cancels without killing', () => {
    dashboard.handleInput('x')
    dashboard.handleInput('n')
    expect(killSpy).not.toHaveBeenCalled()
    expect(confirming()).toBe(false)
  })

  it('other keys cancel the confirmation without their own action', () => {
    dashboard = makeDashboard(
      [
        makeSession({ pid: 1, sessionId: 'a' }),
        makeSession({ pid: 2, sessionId: 'b' }),
      ],
      { onClose },
    )
    dashboard.handleInput('x')
    dashboard.handleInput('j')
    expect(killSpy).not.toHaveBeenCalled()
    expect(confirming()).toBe(false)
    const selected = dashboard
      .render(200)
      .map(stripAnsi)
      .filter((l) => l.includes('proj'))
    expect(selected[0]?.startsWith('> ')).toBe(true)
  })

  it('esc cancels the confirmation without closing the dashboard', () => {
    dashboard.handleInput('x')
    dashboard.handleInput(Key.escape)
    expect(killSpy).not.toHaveBeenCalled()
    expect(confirming()).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('esc does not close the dashboard', () => {
    dashboard.handleInput(Key.escape)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('x on own-pid session does not enter confirmation', () => {
    dashboard = makeDashboard([makeSession({ pid: process.pid })], { onClose })
    dashboard.handleInput('x')
    expect(killSpy).not.toHaveBeenCalled()
    expect(confirming()).toBe(false)
  })

  it('y does nothing when the pending session is no longer present', () => {
    dashboard.handleInput('x')
    Object.defineProperty(dashboard, 'sessions', { value: [] })
    dashboard.handleInput('y')
    expect(killSpy).not.toHaveBeenCalled()
    expect(confirming()).toBe(false)
  })

  it('y does not kill when the pid now belongs to a different session', async () => {
    dashboard = makeDashboard([makeSession({ pid: 42, sessionId: 'victim' })], {
      onClose,
      loadSessions: async () => [
        makeSession({ pid: 42, sessionId: 'impostor' }),
      ],
    })
    dashboard.handleInput('x')
    dashboard.handleInput('r')
    await flush()
    dashboard.handleInput('y')
    expect(killSpy).not.toHaveBeenCalled()
    expect(confirming()).toBe(false)
  })

  it('cancels pending confirmation when the session disappears after refresh', async () => {
    dashboard = makeDashboard([makeSession({ pid: 42 })], {
      onClose,
      loadSessions: async () => [],
    })
    dashboard.handleInput('x')
    dashboard.handleInput('r')
    await flush()
    expect(confirming()).toBe(false)
  })
})

describe('Dashboard unread icon', () => {
  it('renders the icon only on unread session rows and keeps columns aligned', () => {
    const dashboard = makeDashboard(
      [
        makeSession({ pid: 1, projectName: 'bell-proj', unread: true }),
        makeSession({ pid: 2, projectName: 'plain-proj' }),
      ],
      { notifySymbol: '🔔' },
    )
    const rows = dashboard.render(200).map(stripAnsi)
    const unreadRow = rows.find((l) => l.includes('bell-proj'))
    const readRow = rows.find((l) => l.includes('plain-proj'))
    expect(unreadRow).toBeDefined()
    expect(readRow).toBeDefined()
    if (!unreadRow || !readRow) throw new Error('unreachable')
    expect(unreadRow.includes('🔔')).toBe(true)
    expect(readRow.includes('🔔')).toBe(false)
    expect(readRow.indexOf('plain-proj')).toBe(unreadRow.indexOf('bell-proj'))
    dashboard.dispose()
  })

  it('aligns the header with data rows when the unread symbol is set', () => {
    const dashboard = makeDashboard(
      [
        makeSession({ pid: 1, projectName: 'bell-proj', unread: true }),
        makeSession({ pid: 2, projectName: 'plain-proj' }),
      ],
      { notifySymbol: '🔔' },
    )
    const rows = dashboard.render(200).map(stripAnsi)
    const header = rows.find((l) => l.includes('PROJECT'))
    expect(header).toBeDefined()
    if (!header) throw new Error('unreachable')
    const rowsByProject = ['bell-proj', 'plain-proj'].map((project) => {
      const row = rows.find((l) => l.includes(project))
      expect(row).toBeDefined()
      if (!row) throw new Error('unreachable')
      return [project, row] as const
    })
    for (const [project, row] of rowsByProject) {
      expect(header.indexOf('PROJECT')).toBe(row.indexOf(project))
    }
    dashboard.dispose()
  })

  it('aligns the header with data rows when the unread symbol is empty', () => {
    const dashboard = makeDashboard([
      makeSession({ pid: 1, projectName: 'bell-proj', unread: true }),
    ])
    const rows = dashboard.render(200).map(stripAnsi)
    const header = rows.find((l) => l.includes('PROJECT'))
    const row = rows.find((l) => l.includes('bell-proj'))
    expect(header).toBeDefined()
    expect(row).toBeDefined()
    if (!header || !row) throw new Error('unreachable')
    expect(header.indexOf('PROJECT')).toBe(row.indexOf('bell-proj'))
    dashboard.dispose()
  })

  it('does not truncate the last column when the unread symbol is set', () => {
    const dashboard = makeDashboard(
      [makeSession({ pid: 1, projectName: 'proj', unread: true })],
      { notifySymbol: '🔔' },
    )
    const rows = dashboard.render(200).map(stripAnsi)
    const row = rows.find((l) => l.includes('proj'))
    expect(row).toBeDefined()
    if (!row) throw new Error('unreachable')
    expect(row.includes('0s')).toBe(true)
    expect(visibleWidth(row)).toBe(200)
    dashboard.dispose()
  })

  it('keeps the empty-symbol column as a placeholder when the unread symbol is empty', () => {
    const dashboard = makeDashboard([
      makeSession({ pid: 1, projectName: 'bell-proj', unread: true }),
    ])
    const rows = dashboard.render(200).map(stripAnsi)
    const header = rows.find((l) => l.includes('PROJECT'))
    const row = rows.find((l) => l.includes('bell-proj'))
    expect(header).toBeDefined()
    expect(row).toBeDefined()
    if (!header || !row) throw new Error('unreachable')
    expect(header.includes('🔔')).toBe(true)
    expect(row.includes('🔔')).toBe(false)
    expect(header.indexOf('PROJECT')).toBe(row.indexOf('bell-proj'))
    dashboard.dispose()
  })
})
