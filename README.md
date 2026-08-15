# claude-magic-link-watcher

Watches a Proton Mail inbox directly over IMAP for "Your secure link to
Claude.ai is here" emails and automatically opens the magic sign-in link in
the default browser.

Talks to [Proton Bridge](https://proton.me/mail/bridge)'s local IMAP endpoint
directly via [`imapflow`](https://imapflow.com/) — no dependency on
[`proton-mail-bridge-client`](https://github.com/googlarz/proton-mail-bridge-client)'s
CLI. Holding one persistent connection with real IMAP IDLE means detection
is near-instant, instead of paying a fresh-process-and-reconnect cost (~4s)
for every lookup.

## How it works

1. Loads Proton Bridge IMAP credentials at runtime from an existing
   `proton-mail-bridge-client` MCP config (e.g. Claude Desktop's
   `claude_desktop_config.json`), rather than storing them in this script —
   it only needs the connection details, not the CLI itself.
2. Connects and opens one persistent IMAP session, retrying indefinitely if
   Bridge isn't up yet — handles both a slow start at login and Bridge
   restarts later in the day.
3. Primes a "seen" list from mail already in the inbox so existing messages
   aren't replayed on startup or reconnect.
4. `imapflow` automatically enters IMAP IDLE after a short period of
   inactivity and emits an event the moment the server pushes new mail. On
   each event, the newly-arrived message(s) are checked for a subject match
   **and** a sender address ending in `@mail.anthropic.com` (subject lines
   are trivially spoofable; the sender check is the actual gate — see
   *Security note* below), the magic link is extracted from the body, and
   `open`ed — optionally after a confirmation dialog (see
   `CONFIRM_BEFORE_OPEN` below).
5. Tracks opened emails on disk by `Message-ID` (stable across reconnects,
   unlike IMAP UIDs) so a link is never opened twice, and reconnects
   automatically if the IMAP connection drops.

## Requirements

- [Proton Mail Bridge](https://proton.me/mail/bridge) running locally
- An existing `proton-mail-bridge-client` MCP config with Proton Bridge's
  IMAP host/port/credentials (only read for connection details — the CLI
  itself isn't invoked)
- `node` (18+)

## Configuration

The script reads these from the environment, each falling back to a default
for this machine's layout — override them if yours differs:

| Variable | Default |
| --- | --- |
| `CONFIG_JSON` | path to the MCP config containing Proton Bridge credentials |
| `STATE_DIR` | `~/.claude-magic-link-watcher` |
| `SUBJECT_PREFIX` | `Your secure link to Claude.ai is here` |
| `SENDER_SUFFIX` | `@mail.anthropic.com` |
| `FOLDER` | `INBOX` |
| `CONFIRM_BEFORE_OPEN` | `false` — set to `true` to require clicking "Open" in a dialog before the link opens |
| `CONFIRM_TIMEOUT_SECONDS` | `60` — how long the dialog waits; times out to *not* opening |

## Install

```bash
npm install
```

Then either run it directly (`./claude-magic-link-watcher`), or symlink it
onto your `PATH` so `node_modules` still resolves via the script's real path:

```bash
ln -s "$(pwd)/claude-magic-link-watcher" ~/.local/bin/claude-magic-link-watcher
```

To run it as a background service on macOS via `launchd`, edit the paths and
label in `launchd/gs.wbig.claude-magic-link-watcher.plist` (the `gs.wbig`
label prefix is mine — swap in your own reverse-DNS scheme) — note the
`PATH` set in `EnvironmentVariables` needs to include wherever `node` lives
(e.g. `/opt/homebrew/bin`), since launchd's default `PATH` is minimal and
won't resolve the script's `#!/usr/bin/env node` shebang otherwise. Then:

```bash
cp launchd/gs.wbig.claude-magic-link-watcher.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/gs.wbig.claude-magic-link-watcher.plist
```

Logs go to `~/Library/Logs/claude-magic-link-watcher/{stdout,stderr}.log`
(paths set in the plist).

## Security note

By default this automatically completes a sign-in flow with no confirmation
step — anyone able to get such an email delivered into the watched inbox
gets a live login on the machine running this script. The sender check
(`SENDER_SUFFIX`) is the real gate here: `mail.anthropic.com` publishes a
strict DMARC policy (`p=reject`), so a forged sender should be rejected by
the mail provider before it ever reaches this script. Set
`CONFIRM_BEFORE_OPEN=true` for an extra manual approval step (a native
dialog, defaulting to *not* opening if ignored or left to time out). It's
meant for a personal inbox on a trusted machine either way.
