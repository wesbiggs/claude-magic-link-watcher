# claude-magic-link-watcher

Watches a Proton Mail inbox (via [proton-mail-bridge-client](https://github.com/googlarz/proton-mail-bridge-client))
for "Your secure link to Claude.ai is here" emails and automatically opens the
magic sign-in link in the default browser.

## How it works

1. Loads Proton Bridge IMAP credentials at runtime from an existing
   `proton-mail-bridge-client` MCP config (e.g. Claude Desktop's
   `claude_desktop_config.json`), rather than storing them in this script.
2. Waits for Proton Bridge's IMAP connection to be ready, retrying
   indefinitely — handles both a slow start at login and Bridge restarts
   later in the day.
3. Primes a "seen" list from mail already in the inbox so existing messages
   aren't replayed on startup.
4. Streams new-mail events via `proton-mail-bridge-client notify` (IMAP
   IDLE — no polling). On each event, checks the newest messages for a
   subject match, extracts the magic link from the body, and `open`s it.
5. Tracks opened email IDs on disk so a link is never opened twice, and
   reconnects automatically if the notify stream ends.

## Requirements

- [Proton Mail Bridge](https://proton.me/mail/bridge) running locally
- [`proton-mail-bridge-client`](https://github.com/googlarz/proton-mail-bridge-client)
  installed and configured (its `env` block supplies `PROTONMAIL_*` credentials)
- `node`, `jq`

## Configuration

The script reads these from the environment, each falling back to a default
for this machine's layout — override them if yours differs:

| Variable | Default |
| --- | --- |
| `NODE_BIN` | `/opt/homebrew/bin/node` |
| `CLI_JS` | path to `proton-mail-bridge-client`'s `dist/cli.js` |
| `CONFIG_JSON` | path to the MCP config containing Proton Bridge credentials |
| `STATE_DIR` | `~/.claude-magic-link-watcher` |
| `SUBJECT_PREFIX` | `Your secure link to Claude.ai is here` |
| `FOLDER` | `INBOX` |

## Install

```bash
cp claude-magic-link-watcher ~/.local/bin/
chmod +x ~/.local/bin/claude-magic-link-watcher
```

To run it as a background service on macOS via `launchd`, edit the paths and
label in `launchd/gs.wbig.claude-magic-link-watcher.plist` (the `gs.wbig`
label prefix is mine — swap in your own reverse-DNS scheme) then:

```bash
cp launchd/gs.wbig.claude-magic-link-watcher.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/gs.wbig.claude-magic-link-watcher.plist
```

Logs go to `~/Library/Logs/claude-magic-link-watcher/{stdout,stderr}.log`
(paths set in the plist).

## Security note

This automatically completes a sign-in flow with no confirmation step —
anyone able to trigger that email into the watched inbox gets a live login
on the machine running this script. It's meant for a personal inbox on a
trusted machine.
