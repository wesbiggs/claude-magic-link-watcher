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
   subject match **and** a sender address ending in `@mail.anthropic.com`
   (subject lines are trivially spoofable; the sender check is the actual
   gate), extracts the magic link from the body, and `open`s it — optionally
   after a confirmation dialog (see `CONFIRM_BEFORE_OPEN` below).
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
| `SENDER_SUFFIX` | `@mail.anthropic.com` |
| `FOLDER` | `INBOX` |
| `CONFIRM_BEFORE_OPEN` | `false` — set to `true` to require clicking "Open" in a dialog before the link opens |
| `CONFIRM_TIMEOUT_SECONDS` | `60` — how long the dialog waits; times out to *not* opening |

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

By default this automatically completes a sign-in flow with no confirmation
step — anyone able to get such an email delivered into the watched inbox
gets a live login on the machine running this script. The sender check
(`SENDER_SUFFIX`) is the real gate here: `mail.anthropic.com` publishes a
strict DMARC policy (`p=reject`), so a forged sender should be rejected by
the mail provider before it ever reaches this script. Set
`CONFIRM_BEFORE_OPEN=true` for an extra manual approval step (a native
dialog, defaulting to *not* opening if ignored or left to time out). It's
meant for a personal inbox on a trusted machine either way.
