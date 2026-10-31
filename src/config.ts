import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

const NotifyConfigSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  finished: Type.Optional(Type.Boolean()),
  onlyNotifyWhenUnfocused: Type.Optional(Type.Boolean()),
  unfocusedActivityThresholdSecs: Type.Optional(Type.Number()),
  idleDelaySecs: Type.Optional(Type.Number()),
  notifySymbol: Type.Optional(Type.String()),
})
type NotifyConfig = Static<typeof NotifyConfigSchema>

export interface ResolvedNotifyConfig {
  readonly enabled: boolean
  readonly finished: boolean
  readonly onlyNotifyWhenUnfocused: boolean
  readonly unfocusedActivityThresholdMs: number
  readonly idleDelayMs: number
  readonly notifySymbol: string
}

const DEFAULT_NOTIFY_SYMBOL = '🔔'
const DEFAULT_IDLE_DELAY_SECS = 10
/** Upper bound keeps a typo like `idleDelaySecs: 1e9` from silencing the toast. */
const MAX_IDLE_DELAY_SECS = 3600

function clampIdleDelayMs(secs: number | undefined): number {
  if (secs === undefined) return DEFAULT_IDLE_DELAY_SECS * 1000
  const bounded = Math.min(Math.max(secs, 0), MAX_IDLE_DELAY_SECS)
  return Math.round(bounded * 1000)
}

const SETTINGS_PATH = join(getAgentDir(), 'settings.json')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ParsedConfigResult =
  | { readonly status: 'malformed' }
  | { readonly status: 'valid'; readonly piNotify: NotifyConfig }

function readRawConfig(): ParsedConfigResult {
  if (!existsSync(SETTINGS_PATH)) {
    return { status: 'valid', piNotify: {} }
  }
  let content: string
  try {
    content = readFileSync(SETTINGS_PATH, 'utf8')
  } catch {
    return { status: 'malformed' }
  }
  return parseConfig(content)
}

export function parseConfig(content: string): ParsedConfigResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { status: 'malformed' }
  }
  if (!isRecord(parsed)) {
    return { status: 'valid', piNotify: {} }
  }
  return {
    status: 'valid',
    piNotify: Value.Check(NotifyConfigSchema, parsed.piNotify)
      ? parsed.piNotify
      : {},
  }
}

export function loadConfig(): ResolvedNotifyConfig {
  const result = readRawConfig()
  // Malformed settings.json must not break the agent; fall back to defaults.
  const cfg: NotifyConfig = result.status === 'valid' ? result.piNotify : {}
  return {
    enabled: cfg.enabled ?? true,
    finished: cfg.finished ?? true,
    onlyNotifyWhenUnfocused: cfg.onlyNotifyWhenUnfocused ?? true,
    unfocusedActivityThresholdMs: Math.max(
      0,
      (cfg.unfocusedActivityThresholdSecs ?? 30) * 1000,
    ),
    idleDelayMs: clampIdleDelayMs(cfg.idleDelaySecs),
    notifySymbol: cfg.notifySymbol ?? DEFAULT_NOTIFY_SYMBOL,
  }
}
