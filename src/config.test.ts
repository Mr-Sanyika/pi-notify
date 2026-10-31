import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadConfig, parseConfig } from './config.js'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '{}'),
}))

const ALL_DEFAULTS = {
  enabled: true,
  finished: true,
  onlyNotifyWhenUnfocused: true,
  unfocusedActivityThresholdMs: 30000,
  idleDelayMs: 10000,
  notifySymbol: '🔔',
}

describe('parseConfig', () => {
  it('returns malformed for invalid JSON', () => {
    expect(parseConfig('{not json')).toEqual({ status: 'malformed' })
  })

  it('returns empty settings and piNotify for non-record JSON', () => {
    for (const content of ['[1,2]', '42', 'null', '"str"']) {
      expect(parseConfig(content)).toEqual({
        status: 'valid',
        piNotify: {},
      })
    }
  })

  it('returns empty piNotify when record has no piNotify', () => {
    expect(parseConfig('{"foo": 1}')).toEqual({
      status: 'valid',
      piNotify: {},
    })
  })

  it('accepts an idle delay', () => {
    expect(
      parseConfig(JSON.stringify({ piNotify: { idleDelaySecs: 45 } })),
    ).toEqual({
      status: 'valid',
      piNotify: { idleDelaySecs: 45 },
    })
  })

  it('parses piNotify fields', () => {
    const content = JSON.stringify({
      piNotify: {
        enabled: false,
        finished: false,
        onlyNotifyWhenUnfocused: false,
        unfocusedActivityThresholdSecs: 5,
        idleDelaySecs: 45,
        notifySymbol: '!',
      },
    })
    expect(parseConfig(content)).toEqual({
      status: 'valid',
      piNotify: JSON.parse(content).piNotify,
    })
  })

  it('falls back to empty piNotify when piNotify is not an object', () => {
    expect(parseConfig('{"piNotify": "x"}')).toEqual({
      status: 'valid',
      piNotify: {},
    })
  })

  it('falls back to empty piNotify on invalid field types', () => {
    const content = JSON.stringify({
      piNotify: {
        enabled: 'yes',
        unfocusedActivityThresholdSecs: 'x',
      },
    })
    expect(parseConfig(content)).toEqual({
      status: 'valid',
      piNotify: {},
    })
  })
})

describe('loadConfig', () => {
  beforeEach(async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    vi.mocked(existsSync).mockClear().mockReturnValue(true)
    vi.mocked(readFileSync).mockClear().mockReturnValue('{}')
  })

  it('returns all defaults for empty settings', () => {
    expect(loadConfig()).toEqual(ALL_DEFAULTS)
  })

  it('uses idleDelaySecs as milliseconds', async () => {
    const { readFileSync } = await import('node:fs')
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ piNotify: { idleDelaySecs: 45 } }),
    )

    expect(loadConfig().idleDelayMs).toBe(45000)
  })

  it('clamps idleDelaySecs to a sane range', async () => {
    const { readFileSync } = await import('node:fs')
    const delayFor = (secs: number): number => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ piNotify: { idleDelaySecs: secs } }),
      )
      return loadConfig().idleDelayMs
    }

    expect(delayFor(-5)).toBe(0)
    expect(delayFor(1e9)).toBe(3600000)
  })

  it('returns all defaults and reads nothing when settings file is missing', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    vi.mocked(existsSync).mockReturnValue(false)
    const config = loadConfig()
    expect(readFileSync).not.toHaveBeenCalled()
    expect(config).toEqual(ALL_DEFAULTS)
  })
})
