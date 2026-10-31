import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { acquireLock } from './file-lock.js'

let dir: string
let lockPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-notify-lock-'))
  lockPath = join(dir, 'state.json.lock')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('acquireLock', () => {
  it('creates and removes the lock file', async () => {
    const release = await acquireLock(lockPath, { retryMs: 200 })
    release()
    const second = await acquireLock(lockPath, { retryMs: 200 })
    second()
  })

  it('reports failure instead of hanging when the lock stays held', async () => {
    const release = await acquireLock(lockPath, { retryMs: 200 })
    try {
      await expect(
        acquireLock(lockPath, { retryMs: 150, retryIntervalMs: 10 }),
      ).rejects.toThrow(/Timed out acquiring lock/)
    } finally {
      release()
    }
  })

  it('breaks a lock older than staleMs', async () => {
    writeFileSync(lockPath, 'someone-else')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockPath, old, old)

    const release = await acquireLock(lockPath, {
      staleMs: 1000,
      retryMs: 100,
    })
    release()
  })

  it('breaks a stale lock that is a leftover directory', async () => {
    mkdirSync(lockPath)
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockPath, old, old)

    const release = await acquireLock(lockPath, {
      staleMs: 1000,
      retryMs: 100,
    })
    release()
  })
})
