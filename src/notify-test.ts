import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import type { ResolvedNotifyConfig } from './config.js'
import { notify } from './notifier.js'
import { sleep } from './shared/utils.js'
import type { TmuxTitleTracker } from './tmux-title.js'

const DEFAULT_BODY = 'This is a test notification.'

export class NotifyTest {
  private readonly pi: ExtensionAPI
  private readonly title: string
  private readonly titleTracker: TmuxTitleTracker
  private readonly config: ResolvedNotifyConfig

  constructor(
    pi: ExtensionAPI,
    title: string,
    titleTracker: TmuxTitleTracker,
    config: ResolvedNotifyConfig,
  ) {
    this.pi = pi
    this.title = title
    this.titleTracker = titleTracker
    this.config = config
  }

  register(): void {
    this.pi.registerCommand('notify-test', {
      description: 'Fire a test notification',
      handler: async (args) => {
        await sleep(3000)
        this.titleTracker.mark()
        const body = args.trim() || DEFAULT_BODY
        notify(this.title, body, this.config)
      },
    })
  }
}
