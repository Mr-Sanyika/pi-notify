import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

import { omit, orderBy, partition } from 'lodash-es'
import lockfile from 'proper-lockfile'

import {
  isSessionState,
  type SessionState,
  STATE_FILE,
  STATE_TMP_FILE,
} from './consts.js'

const ESRCH = 'ESRCH'
const EPERM = 'EPERM'

export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false
  if (pid === process.pid) return true

  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = errCode(err)
    if (code === EPERM) return true
    if (code === ESRCH) return false
    return false
  }
}

function errCode(err: unknown): string | undefined {
  if (!(err instanceof Error) || !('code' in err)) return undefined
  const { code } = err
  return typeof code === 'string' ? code : undefined
}

export async function readSessions(): Promise<SessionRecord[]> {
  const state = readState()
  const sessions = Object.values(state.sessions).filter(
    (session): session is SessionRecord => session !== undefined,
  )
  const [alive, dead] = partition(sessions, (session) =>
    isProcessAlive(session.pid),
  )

  await removePidRecords(dead.map((session) => session.pid))

  return orderBy(alive, [(session) => session.starred === true], ['desc'])
}

export async function toggleSessionStarred(
  pid: number,
): Promise<boolean | undefined> {
  const record = await updateRecord(pid, (existing) =>
    existing === undefined
      ? undefined
      : { ...existing, starred: existing.starred !== true },
  )
  return record?.starred
}

export interface SessionRecord {
  pid: number
  sessionId: string
  cwd: string
  projectName: string
  startedAt: number
  state: SessionState
  startedRunningAt?: number
  starred?: boolean
  unread?: boolean
}

export interface DashboardState {
  version: 2
  sessions: Record<string, SessionRecord | undefined>
}

const LOCK_RETRY_INTERVAL_MS = 50
const LOCK_MAX_RETRIES = 20

export function ensureStateDir(): void {
  const dir = dirname(STATE_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function parseSessionRecord(value: unknown): SessionRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (
    typeof record.pid !== 'number' ||
    typeof record.sessionId !== 'string' ||
    typeof record.cwd !== 'string' ||
    typeof record.projectName !== 'string' ||
    typeof record.startedAt !== 'number' ||
    !isSessionState(record.state)
  ) {
    return undefined
  }
  return {
    pid: record.pid,
    sessionId: record.sessionId,
    cwd: record.cwd,
    projectName: record.projectName,
    startedAt: record.startedAt,
    state: record.state,
    startedRunningAt:
      typeof record.startedRunningAt === 'number'
        ? record.startedRunningAt
        : undefined,
    starred: typeof record.starred === 'boolean' ? record.starred : undefined,
    unread: record.unread === true ? true : undefined,
  }
}

function parseState(data: string): DashboardState | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const raw = parsed as Record<string, unknown>
  if (typeof raw.sessions !== 'object' || raw.sessions === null)
    return undefined

  const sessions: Record<string, SessionRecord | undefined> = {}
  for (const [key, value] of Object.entries(raw.sessions)) {
    sessions[key] = parseSessionRecord(value)
  }
  // Records from older versions lack optional fields; they parse as-is.
  return { version: 2, sessions }
}

export function readState(): DashboardState {
  if (!existsSync(STATE_FILE)) {
    return { version: 2, sessions: {} }
  }

  try {
    const state = parseState(readFileSync(STATE_FILE, 'utf8'))
    return state ?? { version: 2, sessions: {} }
  } catch {
    return { version: 2, sessions: {} }
  }
}

async function withState(
  apply: (state: DashboardState) => DashboardState | undefined,
): Promise<DashboardState | undefined> {
  ensureStateDir()
  const release = await lockfile.lock(STATE_FILE, {
    realpath: false,
    stale: 30000,
    retries: {
      minTimeout: LOCK_RETRY_INTERVAL_MS,
      maxTimeout: LOCK_RETRY_INTERVAL_MS,
      retries: LOCK_MAX_RETRIES,
    },
  })

  try {
    const newState = apply(readState())
    if (newState === undefined) return undefined
    writeFileSync(STATE_TMP_FILE, JSON.stringify(newState, null, 2), 'utf8')
    renameSync(STATE_TMP_FILE, STATE_FILE)
    return newState
  } finally {
    await release()
  }
}

export async function removePidRecords(pids: number[]): Promise<void> {
  if (pids.length === 0) return

  await withState((state) => {
    const sessions: typeof state.sessions = omit(
      state.sessions,
      pids.map(String),
    )
    return { ...state, sessions }
  })
}

export async function updateRecord(
  pid: number,
  update: (existing: SessionRecord | undefined) => SessionRecord | undefined,
): Promise<SessionRecord | undefined> {
  const id = String(pid)
  const state = await withState((current) => {
    const record = update(current.sessions[id])
    if (record === undefined) return undefined
    return {
      ...current,
      sessions: { ...current.sessions, [id]: record },
    }
  })
  return state?.sessions[id]
}
