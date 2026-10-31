import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadConfig, parseConfig } from './config.js'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '{}'),
}))

const ALL_DEFAULTS = {
  enabled: true,
  notifyTools: new Set(),
  events: {},
  finished: true,
  onlyNotifyWhenUnfocused: true,
  unfocusedActivityThresholdMs: 30000,
  notifySymbol: '🔔',
  desktop: true,
  osc777: true,
  osc9: false,
}

describe('parseConfig', () => {
  it('returns malformed for invalid JSON', () => {
    expect(parseConfig('{not json')).toEqual({ status: 'malformed' })
  })

  it('returns empty settings and piNotify for non-record JSON', () => {
    for (const content of ['[1,2]', '42', 'null', '"str"']) {
      expect(parseConfig(content)).toEqual({
        status: 'valid',
        settings: {},
        piNotify: {},
      })
    }
  })

  it('returns empty piNotify when record has no piNotify', () => {
    expect(parseConfig('{"foo": 1}')).toEqual({
      status: 'valid',
      settings: { foo: 1 },
      piNotify: {},
    })
  })

  it('parses piNotify fields', () => {
    const content = JSON.stringify({
      piNotify: {
        enabled: false,
        notifyTools: ['a', 'b'],
        events: { session: 'all', finished: false },
        finished: false,
        onlyNotifyWhenUnfocused: false,
        unfocusedActivityThresholdSecs: 5,
        notifySymbol: '!',
        desktop: false,
        osc777: false,
        osc9: true,
      },
    })
    expect(parseConfig(content)).toEqual({
      status: 'valid',
      settings: JSON.parse(content),
      piNotify: JSON.parse(content).piNotify,
    })
  })

  it('falls back to empty piNotify when piNotify is not an object', () => {
    expect(parseConfig('{"piNotify": "x"}')).toEqual({
      status: 'valid',
      settings: { piNotify: 'x' },
      piNotify: {},
    })
  })

  it('respects explicit osc777/osc9 options', async () => {
    const { readFileSync } = await import('node:fs')
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ piNotify: { osc777: false, osc9: true } }),
    )
    const config = loadConfig()
    expect(config.osc777).toBe(false)
    expect(config.osc9).toBe(true)
  })

  it('falls back to empty piNotify on invalid field types', () => {
    const content = JSON.stringify({
      piNotify: {
        enabled: 'yes',
        events: 'all',
        unfocusedActivityThresholdSecs: 'x',
      },
    })
    expect(parseConfig(content)).toEqual({
      status: 'valid',
      settings: JSON.parse(content),
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

  it('respects explicit desktop false', async () => {
    const { readFileSync } = await import('node:fs')
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ piNotify: { desktop: false } }),
    )
    const config = loadConfig()
    expect(config.desktop).toBe(false)
  })

  it('returns all defaults and reads nothing when settings file is missing', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    vi.mocked(existsSync).mockReturnValue(false)
    const config = loadConfig()
    expect(readFileSync).not.toHaveBeenCalled()
    expect(config).toEqual(ALL_DEFAULTS)
  })
})
