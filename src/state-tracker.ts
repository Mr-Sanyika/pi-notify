import type {
  ExtensionAPI,
  UIPromptKind,
} from '@earendil-works/pi-coding-agent'

import type { ResolvedNotifyConfig } from './config.js'
import { Registrar } from './shared/registrar.js'
import type { NotifyAction } from './shared/types.js'

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
  private readonly config: ResolvedNotifyConfig
  private idleTimer: NodeJS.Timeout | null = null
  private running = false
  private uiPromptDepth = 0
  private notify: NotifyAction = () => {}

  constructor(pi: ExtensionAPI, config: ResolvedNotifyConfig) {
    super(pi)
    this.config = config
  }

  private startIdleTimer(): void {
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
      // A prompt is transient: only a settled session goes idle.
      if (!this.running) this.startIdleTimer()
    })
  }

  private setupToolCall() {
    // A tool call is activity: keep the session from going idle mid-run.
    this.pi.on('tool_call', () => {
      this.clearIdleTimer()
    })
  }

  protected override setup(notify: NotifyAction): void {
    this.notify = notify

    this.setupUiPrompt()
    this.setupToolCall()

    this.pi.on('agent_start', () => {
      this.markRunning()
      this.clearIdleTimer()
    })

    this.pi.on('agent_settled', () => {
      this.startIdleTimer()
    })
  }

  override stop(): void {
    super.stop()
    this.running = false
    this.uiPromptDepth = 0
    this.clearIdleTimer()
  }
}
