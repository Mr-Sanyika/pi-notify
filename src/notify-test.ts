import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { isNotifySendAvailable, notify } from './notifier.js'
import type { UnreadTracker } from './unread-tracker.js'

const DEFAULT_BODY = 'This is a test notification.'

export class NotifyTest {
  private readonly pi: ExtensionAPI
  private readonly title: string
  private readonly unreadTracker: UnreadTracker

  constructor(pi: ExtensionAPI, title: string, unreadTracker: UnreadTracker) {
    this.pi = pi
    this.title = title
    this.unreadTracker = unreadTracker
  }

  register(): void {
    this.pi.registerCommand('notify-test', {
      description: 'Fire a test notification',
      handler: async (args, ctx) => {
        if (!isNotifySendAvailable()) {
          ctx.ui.notify(
            'notify-send was not found on PATH; install libnotify and a notification daemon',
            'error',
          )
          return
        }
        this.unreadTracker.markUnread()
        notify(this.title, args.trim() || DEFAULT_BODY)
      },
    })
  }
}
