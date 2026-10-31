import type {
  ExtensionAPI,
  UIPromptKind,
} from '@earendil-works/pi-coding-agent'

import type { ResolvedNotifyConfig } from './config.js'
import type { JobTracker } from './jobs.js'
import { Registrar } from './shared/registrar.js'
import type { NotifyAction } from './shared/types.js'

export const PI_NOTIFY_EVENT = 'pi-notify:notify'

const IDLE_TIMEOUT_MS = 10000

const PROMPT_KIND_LABELS: Record<UIPromptKind, string> = {
  select: 'Select',
  confirm: 'Confirm',
  input: 'Input',
  editor: 'Editor',
  custom: 'Prompt',
}

function promptMessage(kind: UIPromptKind, title?: string): string {
  const label = PROMPT_KIND_LABELS[kind]
  if (!title) return `Waiting: ${label}`
  return `Waiting: ${label} — ${title}`
}

export class StateTracker extends Registrar {
  private readonly jobTracker: JobTracker
  private readonly config: ResolvedNotifyConfig
  private idleTimer: NodeJS.Timeout | null = null
  private running = false
  private uiPromptDepth = 0
  private notify: NotifyAction = () => {}

  constructor(
    pi: ExtensionAPI,
    jobTracker: JobTracker,
    config: ResolvedNotifyConfig,
  ) {
    super(pi)
    this.jobTracker = jobTracker
    this.config = config
  }

  private startIdleTimer(): void {
    if (this.jobTracker.hasActiveJobs) return
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      const wasRunning = this.running
      this.running = false
      if (wasRunning && this.config.finished) {
        this.notify('Idle')
      }
    }, IDLE_TIMEOUT_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private markRunning(): void {
    if (this.running) return
    this.running = true
  }

  private setupPiEvents() {
    for (const [channel, message] of Object.entries(this.config.events)) {
      if (typeof message !== 'string' || message === '') continue
      const unsubscribe = this.pi.events.on(channel, () => {
        this.notify(message)
        this.running = false
      })
      this.unsubscribes.push(unsubscribe)
    }

    const customEventUnsub = this.pi.events.on(PI_NOTIFY_EVENT, (payload) => {
      if (typeof payload !== 'string' || payload === '') return
      this.notify(payload)
      this.running = false
    })
    this.unsubscribes.push(customEventUnsub)
  }

  private setupUiPrompt() {
    this.pi.on('ui_prompt_start', (event) => {
      this.clearIdleTimer()
      this.uiPromptDepth++
      this.notify(promptMessage(event.kind, event.title))
      this.running = false
    })

    this.pi.on('ui_prompt_end', () => {
      if (this.uiPromptDepth > 0) this.uiPromptDepth--
      if (this.uiPromptDepth > 0) return
      // A prompt is transient: only a settled, job-free session goes idle.
      if (!this.running && !this.jobTracker.hasActiveJobs) {
        this.startIdleTimer()
      }
    })
  }

  private setupToolCall() {
    this.pi.on('tool_call', (event) => {
      if (this.config.notifyTools.has(event.toolName)) {
        this.notify(`Tool call: ${event.toolName}`)
        this.running = false
      }
      this.clearIdleTimer()
    })
  }

  protected override setup(notify: NotifyAction): void {
    this.notify = notify

    this.setupPiEvents()
    this.setupUiPrompt()
    this.setupToolCall()

    this.pi.on('turn_start', () => {
      this.markRunning()
      this.clearIdleTimer()
    })

    this.pi.on('message_start', () => {
      this.markRunning()
      this.clearIdleTimer()
    })

    this.pi.on('agent_settled', () => {
      this.startIdleTimer()
    })

    this.unsubscribes.push(
      this.jobTracker.onStart(() => {
        this.markRunning()
        this.clearIdleTimer()
      }),
      this.jobTracker.onEnd(() => {
        this.startIdleTimer()
      }),
    )
  }

  override stop(): void {
    super.stop()
    this.running = false
    this.uiPromptDepth = 0
    this.clearIdleTimer()
  }
}
