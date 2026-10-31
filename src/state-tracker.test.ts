import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedNotifyConfig } from './config.js'
import type { JobTracker } from './jobs.js'
import { PI_NOTIFY_EVENT, StateTracker } from './state-tracker.js'

type EventsListener = (payload?: unknown) => void

interface FakePi {
  listeners: Map<string, Set<(payload?: unknown) => void>>
  eventListeners: Map<string, Set<EventsListener>>
  on(event: string, listener: (payload?: unknown) => void): void
  events: { on(event: string, listener: EventsListener): () => void }
  emit(event: string, payload?: unknown): void
  emitEvent(event: string, payload?: unknown): void
}

function makeFakePi(): FakePi {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>()
  const eventListeners = new Map<string, Set<EventsListener>>()
  return {
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
    emit(event, payload) {
      const set = listeners.get(event)
      if (!set) return
      for (const listener of [...set]) listener(payload)
    },
    emitEvent(event, payload) {
      const set = eventListeners.get(event)
      if (!set) return
      for (const listener of [...set]) listener(payload)
    },
  }
}

type FakeJobTracker = {
  hasActiveJobs: boolean
  onStart: (listener: () => void) => () => void
  onEnd: (listener: () => void) => () => void
  startListener?: () => void
  endListener?: () => void
}

function makeFakeJobTracker(): FakeJobTracker {
  const instance: FakeJobTracker = {
    hasActiveJobs: false,
    onStart: (listener: () => void) => {
      instance.startListener = listener
      return () => {}
    },
    onEnd: (listener: () => void) => {
      instance.endListener = listener
      return () => {}
    },
    startListener: undefined as (() => void) | undefined,
    endListener: undefined as (() => void) | undefined,
  }
  return instance
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const BASE_CONFIG: ResolvedNotifyConfig = {
  enabled: true,
  notifyTools: new Set(['bash', 'read']),
  events: {
    'my:custom:event': 'msg',
    'disabled:channel': false,
  },
  finished: true,
  onlyNotifyWhenUnfocused: true,
  unfocusedActivityThresholdMs: 0,
  notifySymbol: '',
} as unknown as ResolvedNotifyConfig

function makeTracker(
  pi: FakePi,
  config: ResolvedNotifyConfig = BASE_CONFIG,
): {
  tracker: StateTracker
  bodies: string[]
  jobs: FakeJobTracker
} {
  const bodies: string[] = []
  const jobs = makeFakeJobTracker()
  const tracker = new StateTracker(
    pi as unknown as ExtensionAPI,
    jobs as unknown as JobTracker,
    config,
  )
  tracker.register((body) => bodies.push(body))
  return { tracker, bodies, jobs }
}

describe('StateTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('notifies with the configured message when a custom event fires', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emitEvent('my:custom:event', {})

    expect(bodies).toEqual(['msg'])
  })

  it('does not notify for events disabled with false', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emitEvent('disabled:channel', {})

    expect(bodies).toEqual([])
  })

  it('does not notify for events disabled with an empty string', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi, {
      ...BASE_CONFIG,
      events: { 'my:custom:event': '' },
    })

    pi.emitEvent('my:custom:event', {})

    expect(bodies).toEqual([])
  })

  it('notifies from the custom channel', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emitEvent(PI_NOTIFY_EVENT, 'custom payload')

    expect(bodies).toEqual(['custom payload'])
  })

  it('notifies on ui_prompt_start with kind and title', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('ui_prompt_start', {
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'confirm',
      title: 'Apply changes?',
    })

    expect(bodies).toEqual(['Waiting: Confirm — Apply changes?'])
  })

  it('notifies on ui_prompt_start without a title', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('ui_prompt_start', {
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'select',
    })

    expect(bodies).toEqual(['Waiting: Select'])
  })

  it('does not notify Idle while a ui prompt is open', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('turn_start')
    pi.emit('agent_settled')
    pi.emit('ui_prompt_start', {
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'custom',
    })
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual(['Waiting: Prompt'])

    pi.emit('ui_prompt_end')
    vi.advanceTimersByTime(10000)

    await flush()

    // Opening the prompt already reset `running`, so no "Idle" follows.
    expect(bodies).toEqual(['Waiting: Prompt'])
  })

  it('stays quiet after the prompt closes while jobs are active', async () => {
    const pi = makeFakePi()
    const { bodies, jobs } = makeTracker(pi)

    jobs.hasActiveJobs = true
    jobs.startListener?.()
    pi.emit('ui_prompt_start', {
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'custom',
    })
    pi.emit('ui_prompt_end')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual(['Waiting: Prompt'])
  })

  it('only notifies Idle after the last nested prompt closes', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('turn_start')
    pi.emit('ui_prompt_start', {
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'custom',
    })
    pi.emit('ui_prompt_start', {
      type: 'ui_prompt_start',
      reason: 'ui_prompt',
      kind: 'select',
      title: 'Pick one',
    })
    pi.emit('ui_prompt_end')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual(['Waiting: Prompt', 'Waiting: Select — Pick one'])

    pi.emit('ui_prompt_end')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual(['Waiting: Prompt', 'Waiting: Select — Pick one'])
  })

  it('notifies for tools in notifyTools', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('tool_call', {
      type: 'tool_call',
      toolCallId: 't1',
      toolName: 'read',
    })

    expect(bodies).toEqual(['Tool call: read'])
  })

  it('does not notify for tools not in notifyTools', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('tool_call', {
      type: 'tool_call',
      toolCallId: 't1',
      toolName: 'grep',
    })

    expect(bodies).toEqual([])
  })

  it('does not notify when notifyTools is empty', () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi, {
      ...BASE_CONFIG,
      notifyTools: new Set([]),
    })

    pi.emit('tool_call', {
      type: 'tool_call',
      toolCallId: 't1',
      toolName: 'bash',
    })

    expect(bodies).toEqual([])
  })

  it('notifies Idle on idle when there was activity', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('turn_start')
    pi.emit('agent_settled')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual(['Idle'])
  })

  it('notifies Idle after background job activity without a turn', async () => {
    const pi = makeFakePi()
    const { bodies, jobs } = makeTracker(pi)

    jobs.startListener?.()
    jobs.endListener?.()
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual(['Idle'])
  })

  it('does not notify Idle on idle without activity', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('agent_settled')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual([])
  })

  it('does not notify Idle when finished is disabled', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi, {
      ...BASE_CONFIG,
      finished: false,
    })

    pi.emit('turn_start')
    pi.emit('agent_settled')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual([])
  })

  it('resets the idle timer on activity', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('turn_start')
    pi.emit('agent_settled')
    vi.advanceTimersByTime(9000)
    pi.emit('tool_call', {
      type: 'tool_call',
      toolCallId: 't2',
      toolName: 'bash',
    })
    vi.advanceTimersByTime(9000)

    await flush()

    // The notifying tool call cleared the pending timer and reset `running`.
    expect(bodies).toEqual(['Tool call: bash'])

    pi.emit('agent_settled')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual(['Tool call: bash'])
  })
})
