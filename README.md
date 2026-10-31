# @raidou/pi-notify

A notification extension for the [pi](https://github.com/earendil-works/pi-coding-agent) coding agent.

`@raidou/pi-notify` fires a native desktop notification on idle, tool calls (optional, e.g. `Tool call: ask_user`), user-facing UI prompts (via pi's `ui_prompt_start`, e.g. permission approvals or `select`/`confirm`/`input` dialogs, requires pi >= 0.85.0), and custom pi events.

## Requirements

| Requirement | Why |
| --- | --- |
| `pi` >= 0.85.0 | UI prompt notifications use the `ui_prompt_start` event. |
| A desktop notifier | Linux: `notify-send` plus a running notification daemon. macOS: Notification Center. Windows and WSL2: PowerShell toast (WSL is detected and `powershell.exe` used directly). |
| tmux >= 3.3 with `set -g allow-passthrough all` | Only needed for OSC notifications to reach the outer terminal from inside tmux. |

The extension runs inside pi's own runtime (a Bun single-file binary), not plain Node. Bugs that only reproduce there are still real; report them with the pi version from `pi --version`. Known problems are tracked in the [issue tracker](https://github.com/weirongxu/pi-notify/issues).

> **This branch (`lite`): notifications without the dashboard.**
> The `/notify-dashboard` session browser is not part of this line. That drops the
> shared session registry, the tmux jump keybinding, `tsx`/`esbuild`, `lodash-es` and
> `proper-lockfile`: nothing is written to disk, nothing is added to your tmux key
> table, and there are two runtime dependencies. Notification delivery, the tmux
> window marker and the idle/tool/UI-prompt triggers are unchanged.

## Installation

```bash
pi install npm:@raidou/pi-notify
```

Or, for local development

```bash
cd path/to/pi-notify
pi install .
```

## Configuration

All options live under the `piNotify` key in `~/.pi/agent/settings.json`. Everything is optional.

```jsonc
{
  "piNotify": {
    "enabled": true, // master on/off switch (default: true)
    "notifyTools": [], // tools that trigger "Tool call" notifications (default: empty, i.e. no tool notifications)
    "notifySymbol": "🔔", // symbol appended to tmux window title (empty string to disable)
    "desktop": true, // send native desktop notifications via node-notifier / Windows toast (default: true)
    "osc777": true, // emit terminal OSC 777 notifications, title + body (default: true)
    "osc9": false, // emit terminal OSC 9 notifications, body only (default: false; enable for iTerm2/mintty, or instead of osc777)
    "finished": true, // enable/disable "Idle" notification
    "events": {
      "my:custom:event": "Custom event triggered", // custom event channel -> notification message
      "other:event": false, // set to false to disable a specific event
    },
    "finishedThrottleSecs": 0, // 0 = always notify; >0 = skip finished toasts for runs shorter than N seconds
    "onlyNotifyWhenUnfocused": true, // only notify when user has been inactive
    "unfocusedActivityThresholdSecs": 30, // seconds of inactivity before considering user "unfocused"
  },
}
```

## What triggers a notification

| Event             | Source                                                                | Default body                      |
| ----------------- | --------------------------------------------------------------------- | --------------------------------- |
| **Finished**      | `agent_settled` (pi idle, no active jobs)                             | `Idle`                            |
| **Tool calls**    | `tool_call` on tools in `notifyTools` (default: none)                 | `Tool call: <toolName>`           |
| **UI prompts**    | `ui_prompt_start` (requires pi >= 0.85.0)                             | `Waiting: <kind>[ — <title>]` |
| **Custom events** | Custom pi event channels configured in `events`                       | Customizable                      |
| **External API**  | `pi.events.emit('pi-notify:notify', 'message')` from other extensions | The emitted message               |

### tmux window marker

On tmux, a notification appends `notifySymbol` (default `🔔`) to the window title and removes it again when you focus that pane, so an idle window that wants attention is visible in the status bar. Nothing is written to disk for this; the marker is the window title itself.

### Job tracking for background tasks

Extensions running background tasks can prevent spurious "Idle" notifications by emitting job lifecycle events. Notifications on `agent_settled` are suppressed while jobs are active. Custom event notifications are soft dependencies: if a package that broadcasts a specific event is not installed, that notification is skipped.

```typescript
import { JOB_START_EVENT, JOB_END_EVENT } from '@raidou/pi-notify'

function startBackgroundJob(jobId: string): void {
  pi.events.emit(JOB_START_EVENT, { id: jobId })
}

function endBackgroundJob(jobId: string): void {
  pi.events.emit(JOB_END_EVENT, { id: jobId })
}
```

Events are automatically cleaned up on `session_shutdown`.

## Commands


### `/notify-test`

Run `/notify-test` inside pi to fire a test notification.
Pass a string argument (e.g., `/notify-test hello`) to override the body.

## Platform support

`@raidou/pi-notify` prefers `node-notifier` (macOS Notification Center, Linux `notify-send`, native Windows toaster).

**WSL2 note:** `node-notifier` reports `process.platform === "linux"` and would route to `notify-send`, which is usually not installed under WSL and fails silently. `@raidou/pi-notify` detects WSL and raises a Windows toast via `powershell.exe` directly, so notifications reach the Windows Action Center out of the box.

### Focus reporting

While a TUI session runs, the extension enables terminal focus reporting (`DECSET 1004`) so it can tell "user is looking at this pane" from "user switched away", and disables it again from `session_shutdown` and from a `process.on('exit')` hook. A `SIGKILL` cannot be intercepted: after `kill -9`, the terminal keeps sending focus events until it is reset (or closed), which some shells echo as stray `^[[I` / `^[[O`. Known limitation: fullscreen/screen-mode switches can turn focus reporting off for the rest of the session, in which case the extension falls back to inactivity timing (`unfocusedActivityThresholdSecs`).

### Terminal notifications (OSC)

OSC 777 carries title and body (rxvt, kitty, Ghostty), OSC 9 carries the body only (iTerm2, mintty, kitty, Ghostty). Only one of them is on by default: emitting both makes every notification show up twice in terminals that implement both. Enable `osc9` instead of `osc777` when your terminal does not understand OSC 777.

Terminal notifications also work over SSH. Inside tmux (>= 3.3), add the following to `~/.tmux.conf`:

```tmux
set -g allow-passthrough all
```
