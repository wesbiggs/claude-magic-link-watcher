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
| `OPEN_DELAY_SECONDS` | `0` — wait this long after a match before opening the link |

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

## Known behavior: first open always needs "Try Again"

Opening the link consistently shows a "we were unable to verify you with
this link" / "could not log you in" error on the *first* attempt, every
time, which then succeeds immediately on clicking "Try Again" — no action
needed beyond that one click.

**This is not specific to this script or to automation.** Confirmed by
manually clicking the link straight out of the email, watcher not running:
identical behavior. Whatever's going on happens the same way for a plain
human click, so it isn't `open()` vs. a "real" click, timing, or anything
this script does — it's inherent to Claude.ai's magic-link flow itself.

Investigated and ruled out as automation-specific causes:
- **Timing** — an artificial delay before opening (`OPEN_DELAY_SECONDS`,
  tested up to 30s) made no difference.
- **A missed OS-level app-handoff dialog** — the `client=desktop_app` link
  variant looked like it might trigger a native "Open in Claude?"
  confirmation (Claude Desktop registers a `claude://` URL scheme) that
  automation could silently miss. Watched for it directly on a real
  failure: no such dialog appears.
- **The `open()` call vs. a genuine click** — manually clicking the link
  produces the identical fail-then-succeed pattern.

Leading suspect: Cloudflare, which sits in front of the token-exchange
endpoint (confirmed by inspecting the actual network requests on a real
link — the page loads Cloudflare's bot-challenge platform and passes a
fingerprint/challenge check before the exchange call succeeds; a bare HTTP
request to that endpoint gets blocked outright with `cf-mitigated:
challenge`). Given the failure is 100% reproducible on the first try and
100% fixed by an immediate retry — for a human click just as much as for
automation — the likely mechanism is that the first request's response
sets a Cloudflare clearance cookie (e.g. `__cf_bm`) without itself passing,
and the retry succeeds because it now carries that cookie. That would make
this a property of any cold browser session's first visit to the endpoint,
not anything specific to how the link gets opened. Not proven, but the
most evidence-backed explanation found — and either way, it's on Anthropic
and/or Cloudflare's side, not something to chase further here.

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
