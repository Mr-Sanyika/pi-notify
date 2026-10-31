import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedNotifyConfig } from './config.js'
import { StateTracker } from './state-tracker.js'

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

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const BASE_CONFIG: ResolvedNotifyConfig = {
  enabled: true,
  finished: true,
  onlyNotifyWhenUnfocused: true,
  unfocusedActivityThresholdMs: 0,
  notifySymbol: '',
}

function makeTracker(
  pi: FakePi,
  config: ResolvedNotifyConfig = BASE_CONFIG,
): {
  tracker: StateTracker
  bodies: string[]
} {
  const bodies: string[] = []
  const tracker = new StateTracker(pi as unknown as ExtensionAPI, config)
  tracker.register((body) => bodies.push(body))
  return { tracker, bodies }
}

describe('StateTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
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

    pi.emit('agent_start')
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

  it('only notifies Idle after the last nested prompt closes', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('agent_start')
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

  it('notifies Idle on idle when there was activity', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('agent_start')
    pi.emit('agent_settled')
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

    pi.emit('agent_start')
    pi.emit('agent_settled')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual([])
  })

  it('resets the idle timer on activity', async () => {
    const pi = makeFakePi()
    const { bodies } = makeTracker(pi)

    pi.emit('agent_start')
    pi.emit('agent_settled')
    vi.advanceTimersByTime(9000)
    pi.emit('tool_call', {
      type: 'tool_call',
      toolCallId: 't2',
      toolName: 'bash',
    })
    vi.advanceTimersByTime(9000)

    await flush()

    // The tool call cleared the pending timer, so 18s after settling is quiet.
    expect(bodies).toEqual([])

    pi.emit('agent_settled')
    vi.advanceTimersByTime(10000)

    await flush()

    expect(bodies).toEqual(['Idle'])
  })
})
