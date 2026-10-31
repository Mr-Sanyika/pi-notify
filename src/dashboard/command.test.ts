import { basename } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveRunner } from './command.js'

describe('resolveRunner', () => {
  it('resolves a node or bun runtime from PATH, never the pi binary', () => {
    const runner = resolveRunner()
    // Not every machine has node/bun on PATH; the command reports that instead.
    if (runner === undefined) return

    // `process.execPath` is the pi binary, whose entrypoint is embedded: passing
    // the tsx CLI to it starts a second pi instead of the dashboard.
    expect(['node', 'bun']).toContain(basename(runner.command))
    expect(runner.args[0]).toMatch(/tsx[/\\]dist[/\\]cli\.mjs$/)
    expect(runner.args[1]).toMatch(/dashboard[/\\]cli\.ts$/)
  })

  it('returns undefined when no JavaScript runtime is on PATH', () => {
    const originalPath = process.env.PATH
    process.env.PATH = '/nonexistent-path-for-pi-notify-tests'
    try {
      expect(resolveRunner()).toBeUndefined()
    } finally {
      process.env.PATH = originalPath
    }
  })
})
