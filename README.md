# pi-notify (lite)

A Linux notification extension for the [pi](https://github.com/earendil-works/pi-coding-agent)
coding agent. Forked from [`@raidou/pi-notify`](https://github.com/weirongxu/pi-notify).

It fires a desktop notification in two situations:

- the agent has finished and the session is quiet for a few seconds (`Idle`)
- pi is blocked on you: a permission approval, a `select`/`confirm`/`input` dialog
  (`Waiting: Select — Apply changes?`)

Nothing else. No dashboard, no session registry, no state file, no tmux keybindings,
no terminal escape sequences, no runtime dependencies.

## Requirements

| Requirement | Why |
| --- | --- |
| `pi` >= 0.85.0 | The waiting notices use pi's `ui_prompt_start` event. |
| `notify-send` (libnotify) | The only delivery mechanism. Any daemon implementing the freedesktop notification spec renders the toasts (mako, dunst, GNOME, KDE, …). |
| tmux (optional) | Only for the 🔔 window marker. |

A missing `notify-send` is not an error: delivery is disabled for the session and
`/notify-test` reports it.

The extension runs inside pi's own runtime (a Bun single-file binary), not plain Node.

## Installation

```bash
git clone https://github.com/Mr-Sanyika/pi-notify.git
cd pi-notify && git checkout lite
pi install .
```

Or symlink it into the agent dir, which avoids re-installing after every pull:

```bash
ln -s /path/to/pi-notify ~/.pi/agent/extensions/pi-notify
```

## Configuration

All options live under the `piNotify` key in `~/.pi/agent/settings.json`, and all are optional.
A malformed `settings.json` falls back to the defaults instead of breaking the agent.

```jsonc
{
  "piNotify": {
    "enabled": true, // master on/off switch (default: true)
    "finished": true, // send "Idle" when a run finishes (default: true)
    "onlyNotifyWhenUnfocused": true, // suppress notifications while you are looking (default: true)
    "unfocusedActivityThresholdSecs": 30, // inactivity fallback when the terminal reports no focus (default: 30)
    "idleDelaySecs": 10, // quiet time after a run before "Idle" fires, 0-3600 (default: 10)
    "notifySymbol": "🔔", // tmux window marker, empty string disables it (default: "🔔")
  },
}
```

## What triggers a notification

| Event | Source | Body |
| --- | --- | --- |
| **Finished** | `agent_settled`, then `idleDelaySecs` without further activity | `Idle` |
| **Waiting** | `ui_prompt_start` (permission, `select`, `confirm`, `input`, editor, custom) | `Waiting: <kind>[ — <title>]` |

"Finished" needs a run that actually did something: settling a session that never had
activity stays quiet, and `finished: false` disables it entirely.

## Focus handling

To avoid toasting you while you are already looking at the pane, the extension enables
terminal focus reporting (`DECSET 1004`) for the duration of a TUI session and reads the
`ESC[I` / `ESC[O` reports terminals send. It is turned off again on `session_shutdown` and
from a `process.on('exit')` hook.

Known limits: `kill -9` cannot be intercepted, so the terminal keeps sending focus reports
until it is reset (some shells then echo stray `^[[I` / `^[[O`); and a fullscreen switch can
disable focus reporting for the rest of the session. In both cases the extension falls back
to `unfocusedActivityThresholdSecs` of inactivity.

## tmux window marker

On tmux, an unread notification appends `notifySymbol` (default `🔔`) to the window title and
removes it when you focus that pane, so a background window that needs attention is visible
in the status bar. This is the only reason the extension shells out to tmux, and every tmux
call is best effort.

## Commands

`/notify-test [body]` fires a test notification, so you can confirm the daemon and the
window marker work without waiting for a run to finish.
