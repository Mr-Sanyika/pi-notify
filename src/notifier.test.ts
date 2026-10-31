import { execFile } from 'node:child_process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

const execFileMock = vi.mocked(execFile)

async function loadNotifier() {
  vi.resetModules()
  return await import('./notifier.js')
}

type ExecCallback = (error: NodeJS.ErrnoException | null) => void

function failWith(code: string): void {
  execFileMock.mockImplementation(((
    _file: string,
    _args: readonly string[],
    callback: ExecCallback,
  ) => {
    callback(Object.assign(new Error(code), { code }))
    return undefined
  }) as never)
}

describe('notify', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    execFileMock.mockImplementation((() => undefined) as never)
  })

  it('sends title and body through notify-send', async () => {
    const { notify } = await loadNotifier()

    notify('pi — repo', 'Idle')

    expect(execFileMock).toHaveBeenCalledWith(
      'notify-send',
      ['-a', 'pi', 'pi — repo', 'Idle'],
      expect.any(Function),
    )
  })

  it('passes multi-line bodies as a single argument', async () => {
    const { notify } = await loadNotifier()

    notify('title', 'line one\nline two')

    expect(execFileMock.mock.calls[0]?.[1]).toEqual([
      '-a',
      'pi',
      'title',
      'line one\nline two',
    ])
  })

  it('stays silent for the rest of the session when notify-send is missing', async () => {
    const { isNotifySendAvailable, notify } = await loadNotifier()
    failWith('ENOENT')

    notify('pi', 'first')
    await vi.waitFor(() => {
      expect(isNotifySendAvailable()).toBe(false)
    })
    notify('pi', 'second')

    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('keeps trying after an unrelated failure', async () => {
    const { isNotifySendAvailable, notify } = await loadNotifier()
    failWith('EACCES')

    notify('pi', 'first')
    await vi.waitFor(() => {
      expect(isNotifySendAvailable()).toBe(true)
    })
    notify('pi', 'second')

    expect(execFileMock).toHaveBeenCalledTimes(2)
  })
})
