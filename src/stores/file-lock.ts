import {
  closeSync,
  openSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'

/**
 * Minimal advisory lock for the shared dashboard state file.
 *
 * `proper-lockfile` cannot be used here: its mtime-precision probe caches a
 * non-configurable symbol property on `fs` and re-reads it on the next lock,
 * which throws inside Bun (the runtime Pi ships):
 *
 *   TypeError: Proxy handler's 'get' result of a non-configurable and
 *   non-writable property should be the same value as the target's property
 *
 * Because that throw happens in an async callback (not in the promise chain),
 * `.catch()` on the caller does not help and the whole Pi process exits.
 *
 * This implementation is the classic `O_EXCL` lock file: create it
 * exclusively, treat a lock older than `staleMs` as abandoned, and always
 * unlink it on release. Failure to lock is reported to the caller, which
 * degrades to "state not updated" instead of taking down the agent.
 */

export interface LockOptions {
  /** Age in ms after which an existing lock file is considered abandoned. */
  staleMs?: number
  /** Total time to keep retrying before giving up. */
  retryMs?: number
  /** Delay between attempts. */
  retryIntervalMs?: number
}

const DEFAULT_STALE_MS = 30000
const DEFAULT_RETRY_MS = 1000
const DEFAULT_RETRY_INTERVAL_MS = 50

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function tryCreate(lockPath: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(lockPath, 'wx')
    writeSync(fd, String(process.pid))
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function breakIfStale(lockPath: string, staleMs: number): void {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs <= staleMs) return
    // `state.json.lock` was a directory with the previous lock library; make
    // sure a leftover directory from an older version cannot wedge the lock.
    rmSync(lockPath, { recursive: true, force: true })
  } catch {
    // Another process released or broke the lock first; retry normally.
  }
}

/**
 * Acquire the lock, returning a release function.
 * Throws if the lock cannot be acquired within the retry budget.
 */
export async function acquireLock(
  lockPath: string,
  options: LockOptions = {},
): Promise<() => void> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS
  const deadline = Date.now() + retryMs

  for (;;) {
    if (tryCreate(lockPath)) {
      let released = false
      return () => {
        if (released) return
        released = true
        try {
          unlinkSync(lockPath)
        } catch {
          // Best effort: a missing lock file is already released.
        }
      }
    }
    breakIfStale(lockPath, staleMs)
    if (Date.now() >= deadline) {
      throw new Error(`Timed out acquiring lock ${lockPath}`)
    }
    await sleep(retryIntervalMs)
  }
}
