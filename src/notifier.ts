import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'

import type { ResolvedNotifyConfig } from './config.js'
import { sendOscNotifications } from './osc.js'

/**
 * WSL reports `process.platform === "linux"` but the user's desktop is Windows.
 * node-notifier would route to `notify-send` (not installed) and silently fail,
 * so we bypass it and call `powershell.exe` directly to raise a Windows toast.
 */
const isWSL = detectWSL()

function detectWSL(): boolean {
  if (process.platform !== 'linux') return false
  if (process.env.WSL_DISTRO_NAME ?? process.env.WT_SESSION) return true
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
  } catch {
    return false
  }
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''").replace(/\r?\n/g, ' ')
}

function windowsToast(title: string, body: string): void {
  const app = escapePowerShell(title)
  const text = escapePowerShell(body)
  // `.Item(0)` (not the `[0]` indexer) avoids a PowerShell 5.1 enumeration
  // quirk that throws "Collection was modified" on the live XmlNodeList.
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    `$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText01)`,
    `[void] $t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode('${text}'))`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${app}').Show([Windows.UI.Notifications.ToastNotification]::new($t))`,
  ].join('; ')
  const exe = process.platform === 'win32' ? 'powershell' : 'powershell.exe'
  execFile(exe, ['-NoProfile', '-NonInteractive', '-Command', script], () => {})
}

async function desktopNotify(title: string, body: string): Promise<void> {
  if (isWSL || process.platform === 'win32') {
    windowsToast(title, body)
    return
  }
  const notifier = (await import('node-notifier')).default
  await new Promise<void>((resolve) => {
    notifier.notify({ title, message: body, wait: false }, () => {
      resolve()
    })
  })
}

export function notify(
  title: string,
  body: string,
  config: Pick<ResolvedNotifyConfig, 'desktop' | 'osc777' | 'osc9'>,
): void {
  if (config.desktop) void desktopNotify(title, body).catch(() => {})
  sendOscNotifications(title, body, config)
}
