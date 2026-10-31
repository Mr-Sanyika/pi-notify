# @raidou/pi-notify

A notification extension for the [pi](https://github.com/earendil-works/pi-coding-agent) coding agent.

`@raidou/pi-notify` fires a native desktop notification on idle, tool calls (optional, e.g. `Tool call: ask_user`), user-facing UI prompts (via pi's `ui_prompt_start`, e.g. permission approvals or `select`/`confirm`/`input` dialogs, requires pi >= 0.85.0), and custom pi events.

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
    "osc9": true, // emit terminal OSC 9 notifications, body only (default: true)
    "dashboardTmuxKey": "alt+d", // tmux jump key offered by default for the dashboard window (triggered directly; enable dashboardTmuxKeyNeedsPrefix for prefix + key)
    "dashboardTmuxKeyNeedsPrefix": false, // require the tmux prefix before the dashboard key (default: false, i.e. no prefix needed)
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

### `/notify-dashboard`

Open a full-screen dashboard listing all pi sessions with summary counts (total, running, idle).

Inside tmux, it registers a live keybinding (default `alt+d`, configurable via `dashboardTmuxKey`) that jumps to the dashboard pane from any pane — trigger with `alt+d` (set `dashboardTmuxKeyNeedsPrefix: true` to require `prefix + alt+d`).

The binding lives in your tmux key table, so it is removed when the dashboard exits and it never overwrites a key that is already bound: if `alt+d` is taken, that session simply offers no jump key. Prefer `dashboardTmuxKeyNeedsPrefix: true` (or a key that pi itself does not use) when the default would shadow a terminal keybinding.


### `/notify-test`

Run `/notify-test` inside pi to fire a test notification.
Pass a string argument (e.g., `/notify-test hello`) to override the body.

## Platform support

`@raidou/pi-notify` prefers `node-notifier` (macOS Notification Center, Linux `notify-send`, native Windows toaster).

**WSL2 note:** `node-notifier` reports `process.platform === "linux"` and would route to `notify-send`, which is usually not installed under WSL and fails silently. `@raidou/pi-notify` detects WSL and raises a Windows toast via `powershell.exe` directly, so notifications reach the Windows Action Center out of the box.

### Focus reporting

While a TUI session runs, the extension enables terminal focus reporting (`DECSET 1004`) so it can tell "user is looking at this pane" from "user switched away", and disables it again from `session_shutdown` and from a `process.on('exit')` hook. A `SIGKILL` cannot be intercepted: after `kill -9`, the terminal keeps sending focus events until it is reset (or closed), which some shells echo as stray `^[[I` / `^[[O`. Known limitation: fullscreen/screen-mode switches can turn focus reporting off for the rest of the session, in which case the extension falls back to inactivity timing (`unfocusedActivityThresholdSecs`).

### Terminal notifications (OSC)

Terminal notifications also work over SSH. Inside tmux (>= 3.3), add the following to `~/.tmux.conf`:

```tmux
set -g allow-passthrough all
```
