import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import type { ResolvedNotifyConfig } from './config.js'
import { notify } from './notifier.js'
import { sleep } from './shared/utils.js'
import type { UnreadTracker } from './unread-tracker.js'

const DEFAULT_BODY = 'This is a test notification.'

export class NotifyTest {
  private readonly pi: ExtensionAPI
  private readonly title: string
  private readonly config: ResolvedNotifyConfig
  private readonly unreadTracker: UnreadTracker

  constructor(
    pi: ExtensionAPI,
    title: string,
    config: ResolvedNotifyConfig,
    unreadTracker: UnreadTracker,
  ) {
    this.pi = pi
    this.title = title
    this.config = config
    this.unreadTracker = unreadTracker
  }

  register(): void {
    this.pi.registerCommand('notify-test', {
      description: 'Fire a test notification',
      handler: async (args) => {
        await sleep(3000)
        this.unreadTracker.markUnread()
        const body = args.trim() || DEFAULT_BODY
        notify(this.title, body, this.config)
      },
    })
  }
}
