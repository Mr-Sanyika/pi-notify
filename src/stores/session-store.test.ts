import { rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type * as constsModule from './consts.js'

vi.mock('./consts.js', async (importOriginal) => {
  const { mkdtempSync } = await import('node:fs')
  const path = await import('node:path')
  const { tmpdir } = await import('node:os')

  const stateDir = mkdtempSync(path.join(tmpdir(), 'pi-notify-test-'))
  return {
    ...(await importOriginal<typeof constsModule>()),
    STATE_FILE: path.join(stateDir, 'state.json'),
    STATE_TMP_FILE: path.join(stateDir, 'state.json.tmp'),
  }
})

import type { ResolvedNotifyConfig } from '../config.js'
import type { JobTracker } from '../jobs.js'
import { StateTracker } from '../state-tracker.js'
import { STATE_FILE } from './consts.js'
import { SessionStore } from './session-store.js'
import type { DashboardState } from './state-store.js'
import { readState } from './state-store.js'

function writeState(state: DashboardState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

/**
 * Wait until no state write is in flight.
 *
 * Writes are fire-and-forget (lock → read → write tmp → rename), so a fixed
 * sleep races with the writer under load. Poll instead: the state is settled
 * once no lock file exists and `state.json` has not been rewritten for a few
 * consecutive polls. Every rewrite restarts the window, so a write that
 * completes between two samples is still observed.
 */
function makeStore(pi: FakePi, stateTracker: FakeStateTracker): SessionStore {
  const store = new SessionStore(
    pi as unknown as ExtensionAPI,
    stateTracker as unknown as StateTracker,
  )
  store.register(() => {})
  activeStore = store
  return store
}

let activeStore: SessionStore | undefined

/**
 * Wait for every state write queued so far to settle.
 *
 * The write path is fire-and-forget, so a fixed sleep races with the writer
 * under load. `flush()` drains the store's write queue instead.
 */
async function settle(): Promise<void> {
  const store = activeStore
  if (store === undefined) return
  // Emittery dispatches listeners asynchronously, so let queued emits run
  // before and after draining the store's write queue.
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await store.flush()
  }
}

type EventsListener = (payload: unknown) => void

interface FakeStateTracker {
  events: {
    on(event: string, listener: EventsListener): () => void
    emit(event: string, data?: unknown): void
  }
}

interface FakeSessionManager {
  getSessionId(): string
}

interface FakePiContext {
  cwd: string
  sessionManager: FakeSessionManager
}

interface FakePi {
  listeners: Map<string, Set<(...args: unknown[]) => void>>
  eventListeners: Map<string, Set<EventsListener>>
  on(event: string, listener: (...args: unknown[]) => void): void
  events: { on(event: string, listener: EventsListener): () => void }
  emit(event: string, ...args: unknown[]): void
  emitEvent(event: string, payload: unknown): void
  emitSessionStart(ctx: FakePiContext): void
}

function makeFakePi(): FakePi {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const eventListeners = new Map<string, Set<EventsListener>>()
  const pi: FakePi = {
    listeners,
    eventListeners,
    on(event, listener) {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(listener)
    },
    events: {
      on(event, listener) {
        let set = eventListeners.get(event)
        if (!set) {
          set = new Set()
          eventListeners.set(event, set)
        }
        set.add(listener)
        return () => {
          set.delete(listener)
        }
      },
    },
    emit(event, ...args) {
      const set = listeners.get(event)
      if (!set) return
      for (const listener of [...set]) listener(...args)
    },
    emitEvent(event, payload) {
      const set = eventListeners.get(event)
      if (!set) return
      for (const listener of [...set]) listener(payload)
    },
    emitSessionStart(ctx) {
      const set = listeners.get('session_start')
      if (!set) return
      for (const listener of [...set]) listener(undefined, ctx)
    },
  }
  return pi
}

function makeFakeStateTracker(): FakeStateTracker {
  const listeners = new Map<string, Set<EventsListener>>()
  return {
    events: {
      on(event, listener) {
        let set = listeners.get(event)
        if (!set) {
          set = new Set()
          listeners.set(event, set)
        }
        set.add(listener)
        return () => {
          set.delete(listener)
        }
      },
      emit(event, data?: unknown) {
        const set = listeners.get(event)
        if (!set) return
        for (const listener of [...set]) listener({ data })
      },
    },
  }
}

const SESSION_ID = 'test-session-123'
const META = {
  cwd: '/test/project',
  projectName: 'test-project',
}

function emitSessionStart(pi: FakePi): void {
  pi.emitSessionStart({
    cwd: META.cwd,
    sessionManager: { getSessionId: () => SESSION_ID },
  })
}

function makeRealTracker(
  pi: FakePi,
  notifyTools: string[],
  events: Record<string, string> = {},
): StateTracker {
  const jobTracker = {
    hasActiveJobs: false,
    onStart: () => () => {},
    onEnd: () => () => {},
  } as unknown as JobTracker
  const tracker = new StateTracker(pi as unknown as ExtensionAPI, jobTracker, {
    notifyTools: new Set(notifyTools),
    events,
  } as unknown as ResolvedNotifyConfig)
  tracker.register(() => {})
  return tracker
}

afterAll(() => {
  rmSync(dirname(STATE_FILE), { recursive: true, force: true })
})

describe('SessionStore', () => {
  const testLockFile = `${STATE_FILE}.lock`

  beforeEach(async () => {
    try {
      unlinkSync(testLockFile)
    } catch {
      // ignore
    }
    writeState({ version: 2, sessions: {} })
  })

  afterEach(() => {
    try {
      unlinkSync(testLockFile)
    } catch {
      // ignore
    }
  })

  it('handles session_start and running/idle events without errors', () => {
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    const store = makeStore(pi, stateTracker)

    expect(() => {
      emitSessionStart(pi)
      stateTracker.events.emit('running')
      stateTracker.events.emit('idle')
      store.stop()
    }).not.toThrow()
  })

  it('keeps running when the state lock is held', async () => {
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    makeStore(pi, stateTracker)

    emitSessionStart(pi)
    await settle()

    // Hold a fresh lock for longer than the retry budget: the write must fail
    // softly instead of rejecting out of the event listener.
    writeFileSync(testLockFile, 'held', 'utf8')
    stateTracker.events.emit('running')
    await settle()
    unlinkSync(testLockFile)

    const [record] = Object.values(readState().sessions)
    expect(record?.state).toBe('idle')
  })

  it('ignores events before session_start', () => {
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    makeStore(pi, stateTracker)

    stateTracker.events.emit('running')
    stateTracker.events.emit('idle')

    expect(readState().sessions).toEqual({})
  })

  it('writes running and idle states to state.json', async () => {
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    makeStore(pi, stateTracker)

    emitSessionStart(pi)
    await settle()

    stateTracker.events.emit('running')
    await settle()

    let record = readState().sessions[String(process.pid)]
    expect(record?.state).toBe('running')

    stateTracker.events.emit('idle')
    await settle()

    record = readState().sessions[String(process.pid)]
    expect(record?.state).toBe('idle')
  })

  it('clears startedRunningAt on idle transition', async () => {
    const now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    makeStore(pi, stateTracker)

    emitSessionStart(pi)
    await settle()

    stateTracker.events.emit('running')
    await settle()

    nowSpy.mockReturnValue(now + 5000)
    stateTracker.events.emit('idle')
    await settle()

    const record = readState().sessions[String(process.pid)]
    expect(record?.startedRunningAt).toBeUndefined()
    nowSpy.mockRestore()
  })

  it('updates state immediately on event emission', async () => {
    const pi = makeFakePi()
    const tracker = makeRealTracker(pi, ['bash'], {
      'permissions:ui_prompt': 'msg',
    })
    const store = new SessionStore(pi as unknown as ExtensionAPI, tracker)
    store.register(() => {})
    activeStore = store

    emitSessionStart(pi)
    await settle()

    pi.emitEvent('permissions:ui_prompt', {})
    await settle()

    const record = readState().sessions[String(process.pid)]
    expect(record?.state).toBe('event:permissions:ui_prompt')
  })

  it('updates state immediately on ui_prompt emission', async () => {
    const pi = makeFakePi()
    const tracker = makeRealTracker(pi, [])
    const store = new SessionStore(pi as unknown as ExtensionAPI, tracker)
    store.register(() => {})
    activeStore = store

    emitSessionStart(pi)
    await settle()

    pi.emit('ui_prompt_start', {
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'confirm',
      title: 'Pick one',
    })

    await settle()

    const record = readState().sessions[String(process.pid)]
    expect(record?.state).toBe('ui:confirm:Pick one')
  })

  it('stores ui state for custom prompts without a title', async () => {
    const pi = makeFakePi()
    const tracker = makeRealTracker(pi, [])
    const store = new SessionStore(pi as unknown as ExtensionAPI, tracker)
    store.register(() => {})
    activeStore = store

    emitSessionStart(pi)
    await settle()

    pi.emit('ui_prompt_start', {
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'custom',
    })

    await settle()

    const record = readState().sessions[String(process.pid)]
    expect(record?.state).toBe('ui:custom:')
  })

  it('does not update state on tool emission outside notifyTools', async () => {
    const pi = makeFakePi()
    const tracker = makeRealTracker(pi, ['read'])
    const store = new SessionStore(pi as unknown as ExtensionAPI, tracker)
    store.register(() => {})
    activeStore = store

    emitSessionStart(pi)
    await settle()

    expect(readState().sessions[String(process.pid)]?.state).toBe('idle')

    pi.emit('tool_call', {
      type: 'tool_call',
      toolCallId: 't1',
      toolName: 'grep',
    })
    await settle()

    const record = readState().sessions[String(process.pid)]
    expect(record?.state).toBe('idle')
  })

  it('ignores tool and event emissions before session_start', async () => {
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    makeStore(pi, stateTracker)

    stateTracker.events.emit('tool', 'grep')
    stateTracker.events.emit('event', 'permissions:ui_prompt')
    await settle()

    expect(readState().sessions).toEqual({})
  })

  it('preserves starred across state updates', async () => {
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    makeStore(pi, stateTracker)

    emitSessionStart(pi)
    await settle()

    const record = readState().sessions[String(process.pid)]
    expect(record).toBeDefined()
    if (record === undefined) return
    writeState({
      version: 2,
      sessions: {
        ...readState().sessions,
        [String(process.pid)]: { ...record, starred: true },
      },
    })

    stateTracker.events.emit('running')
    await settle()

    stateTracker.events.emit('idle')
    await settle()

    expect(readState().sessions[String(process.pid)]?.starred).toBe(true)
  })
})

describe('SessionStore unread', () => {
  const testLockFile = `${STATE_FILE}.lock`

  beforeEach(async () => {
    try {
      unlinkSync(testLockFile)
    } catch {
      // ignore
    }
    writeState({ version: 2, sessions: {} })
  })

  afterEach(() => {
    try {
      unlinkSync(testLockFile)
    } catch {
      // ignore
    }
  })

  function makeStartedStore(): {
    pi: FakePi
    stateTracker: FakeStateTracker
    store: SessionStore
  } {
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    const store = makeStore(pi, stateTracker)
    emitSessionStart(pi)
    return { pi, stateTracker, store }
  }

  async function wait(): Promise<void> {
    await settle()
  }

  it('marks unread and keeps other fields', async () => {
    const { store } = makeStartedStore()
    await wait()

    await store.markUnread()

    const record = readState().sessions[String(process.pid)]
    expect(record?.unread).toBe(true)
    expect(record?.sessionId).toBe(SESSION_ID)
    expect(record?.state).toBe('idle')
  })

  it('clears unread without touching other fields', async () => {
    const { store } = makeStartedStore()
    await wait()
    await store.markUnread()

    await store.clearUnread()
    await wait()

    const record = readState().sessions[String(process.pid)]
    expect(record?.unread).toBeUndefined()
    expect(record?.sessionId).toBe(SESSION_ID)
  })

  it('preserves unread across state updates', async () => {
    const { stateTracker, store } = makeStartedStore()
    await wait()
    await store.markUnread()

    stateTracker.events.emit('running')
    await wait()
    stateTracker.events.emit('idle')
    await wait()

    const record = readState().sessions[String(process.pid)]
    expect(record?.unread).toBe(true)
    expect(record?.state).toBe('idle')
  })

  it('skips unknown session records without creating orphans', async () => {
    const pi = makeFakePi()
    const stateTracker = makeFakeStateTracker()
    const store = makeStore(pi, stateTracker)

    await store.markUnread()
    await store.clearUnread()

    expect(readState().sessions).toEqual({})
  })
})
