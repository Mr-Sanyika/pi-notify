import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

// `false` disables the event
const NotifyEventsSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Literal(false)]),
)
type NotifyEventsConfig = Static<typeof NotifyEventsSchema>

const NotifyConfigSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  notifyTools: Type.Optional(Type.Array(Type.String())),
  events: Type.Optional(NotifyEventsSchema),
  finished: Type.Optional(Type.Boolean()),
  onlyNotifyWhenUnfocused: Type.Optional(Type.Boolean()),
  unfocusedActivityThresholdSecs: Type.Optional(Type.Number()),
  notifySymbol: Type.Optional(Type.String()),
  desktop: Type.Optional(Type.Boolean()),
  osc777: Type.Optional(Type.Boolean()),
  osc9: Type.Optional(Type.Boolean()),
  dashboardTmuxKey: Type.Optional(Type.String()),
  dashboardTmuxKeyNeedsPrefix: Type.Optional(Type.Boolean()),
})
type NotifyConfig = Static<typeof NotifyConfigSchema>

export interface ResolvedNotifyConfig {
  readonly enabled: boolean
  readonly notifyTools: ReadonlySet<string>
  readonly events: NotifyEventsConfig
  readonly finished: boolean
  readonly onlyNotifyWhenUnfocused: boolean
  readonly unfocusedActivityThresholdMs: number
  readonly notifySymbol: string
  readonly desktop: boolean
  readonly osc777: boolean
  readonly osc9: boolean
  readonly dashboardTmuxKey: string
  readonly dashboardTmuxKeyNeedsPrefix: boolean
}

const DEFAULT_NOTIFY_SYMBOL = '🔔'
export const DEFAULT_DASHBOARD_TMUX_KEY = 'alt+d'

const SETTINGS_PATH = join(getAgentDir(), 'settings.json')

type RawSettings = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ParsedConfigResult =
  | { readonly status: 'malformed' }
  | {
      readonly status: 'valid'
      readonly settings: RawSettings
      readonly piNotify: NotifyConfig
    }

function readRawConfig(): ParsedConfigResult {
  if (!existsSync(SETTINGS_PATH)) {
    return { status: 'valid', settings: {}, piNotify: {} }
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
    return { status: 'valid', settings: {}, piNotify: {} }
  }
  return {
    status: 'valid',
    settings: parsed,
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
    notifyTools: new Set(cfg.notifyTools ?? []),
    events: cfg.events ?? {},
    finished: cfg.finished ?? true,
    onlyNotifyWhenUnfocused: cfg.onlyNotifyWhenUnfocused ?? true,
    unfocusedActivityThresholdMs: Math.max(
      0,
      (cfg.unfocusedActivityThresholdSecs ?? 30) * 1000,
    ),
    notifySymbol: cfg.notifySymbol ?? DEFAULT_NOTIFY_SYMBOL,
    desktop: cfg.desktop ?? true,
    osc777: cfg.osc777 ?? true,
    osc9: cfg.osc9 ?? true,
    dashboardTmuxKey: cfg.dashboardTmuxKey ?? DEFAULT_DASHBOARD_TMUX_KEY,
    dashboardTmuxKeyNeedsPrefix: cfg.dashboardTmuxKeyNeedsPrefix ?? false,
  }
}
