import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Component } from '@earendil-works/pi-tui'

import { Registrar } from '../shared/registrar.js'

const EMPTY_COMPONENT: Component = {
  render: () => [],
  invalidate: () => {},
}

function resolveCliPath(): string {
  return fileURLToPath(new URL('./cli.ts', import.meta.url))
}

/**
 * `process.execPath` is the Pi binary itself, which is a Bun single-file
 * executable with an embedded entrypoint: spawning it with the tsx CLI path
 * as argv[1] simply starts Pi again. Resolve a real JavaScript runtime
 * instead, preferring the bundled `tsx` shim and falling back to `node`/`bun`.
 */
export function resolveRunner():
  { command: string; args: string[] } | undefined {
  const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'))
  const cliPath = resolveCliPath()
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)

  for (const dir of pathDirs) {
    for (const name of ['node', 'bun']) {
      const candidate = join(dir, name)
      if (existsSync(candidate) && basename(candidate) === name) {
        return { command: candidate, args: [tsxCli, cliPath] }
      }
    }
  }
  return undefined
}

function spawnDashboard(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const runner = resolveRunner()
    if (runner === undefined) {
      resolve('No node or bun runtime found on PATH for the dashboard TUI')
      return
    }
    let spawnError: unknown
    const child = spawn(runner.command, runner.args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        PI_NOTIFY_DASHBOARD_PID: String(process.pid),
      },
    })
    // 'error' is always followed by 'close'; resolve only on 'close'.
    child.on('error', (err) => {
      spawnError = err
    })
    child.on('close', () => {
      resolve(
        spawnError === undefined
          ? undefined
          : `Failed to spawn dashboard: ${
              spawnError instanceof Error ? spawnError.message : 'unknown error'
            }`,
      )
    })
  })
}

export class DashboardCommand extends Registrar {
  protected override setup(): void {
    this.pi.registerCommand('notify-dashboard', {
      description: 'Show all pi sessions notify dashboard',
      handler: async (_args, ctx) => {
        if (!ctx.hasUI || ctx.mode !== 'tui') {
          ctx.ui.notify('Dashboard requires the pi TUI mode', 'warning')
          return undefined
        }
        await ctx.ui.custom<unknown>((tui, _theme, _keybindings, done) => {
          tui.stop()
          void spawnDashboard().then((error) => {
            tui.start()
            tui.requestRender(true)
            done(undefined)
            if (error !== undefined) {
              ctx.ui.notify(error, 'error')
            }
          })
          return EMPTY_COMPONENT
        })

        return undefined
      },
    })
  }
}
