import { realpathSync } from 'node:fs'
import { basename } from 'node:path'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { Registrar } from '../shared/registrar.js'
import type { StateTracker } from '../state-tracker.js'
import { ACTIVITY_EVENT_PREFIXES, type SessionState } from './consts.js'
import { updateRecord } from './state-store.js'

export class SessionStore extends Registrar {
  private readonly stateTracker: StateTracker
  private sessionId: string | undefined = undefined
  private meta: { pid: number; cwd: string; projectName: string } | undefined =
    undefined
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(pi: ExtensionAPI, stateTracker: StateTracker) {
    super(pi)
    this.stateTracker = stateTracker
  }

  /**
   * Queue a state write behind the previous one and keep the queue usable
   * after a failure. Writes are already serialized by the lock file; this also
   * gives callers (and tests) a handle to wait on.
   */
  private queueWrite(write: () => Promise<void>): void {
    this.writeQueue = this.writeQueue.then(write, write)
  }

  /** Resolves once every queued state write has settled. */
  async flush(): Promise<void> {
    await this.writeQueue
  }

  /**
   * State tracking is best effort: a failed write (lock contention, unwritable
   * agent dir, ...) must not take the agent down, so failures are swallowed
   * here and never escape into an event listener.
   */
  private async saveSession(nextState: SessionState): Promise<void> {
    this.queueWrite(async () => {
      try {
        await this.writeSession(nextState)
      } catch {
        // Dashboard state is non-critical.
      }
    })
  }

  private async writeSession(nextState: SessionState): Promise<void> {
    if (this.sessionId === undefined || this.meta === undefined) return

    const now = Date.now()
    const meta = this.meta
    const sessionId = this.sessionId

    await updateRecord(meta.pid, (existing) => {
      const isRunning = nextState === 'running'

      return {
        pid: meta.pid,
        sessionId,
        cwd: meta.cwd,
        projectName: meta.projectName,
        startedAt: existing?.startedAt ?? now,
        starred: existing?.starred,
        unread: existing?.unread,
        state: nextState,
        startedRunningAt: isRunning ? now : undefined,
      }
    })
  }

  protected override setup(): void {
    this.pi.on('session_start', (_event, ctx) => {
      let normalizedCwd = ctx.cwd
      try {
        normalizedCwd = realpathSync(ctx.cwd)
      } catch {
        // Ignore realpath failures; fall back to ctx.cwd.
      }
      const meta = {
        pid: process.pid,
        cwd: normalizedCwd,
        projectName: basename(normalizedCwd),
      }
      const sessionId = ctx.sessionManager.getSessionId()
      this.sessionId = sessionId
      this.meta = meta
      void this.saveSession('idle')
    })

    this.unsubscribes.push(
      this.stateTracker.events.on('running', async () => {
        await this.saveSession('running')
      }),
      this.stateTracker.events.on('idle', async () => {
        await this.saveSession('idle')
      }),
      ...ACTIVITY_EVENT_PREFIXES.map(([event, prefix]) =>
        this.stateTracker.events.on(event, async ({ data }) => {
          await this.saveSession(`${prefix}${data}`)
        }),
      ),
    )
  }

  async markUnread(): Promise<void> {
    await this.setUnread(true)
  }

  async clearUnread(): Promise<void> {
    await this.setUnread(undefined)
  }

  private async setUnread(unread: boolean | undefined): Promise<void> {
    if (this.meta === undefined) return

    await updateRecord(this.meta.pid, (existing) =>
      existing === undefined ? undefined : { ...existing, unread },
    )
  }
}
