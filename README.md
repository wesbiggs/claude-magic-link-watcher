# claude-magic-link-watcher

Watches an IMAP inbox via [`imapflow`](https://imapflow.com/) for
"Your secure link to Claude.ai is here" emails and automatically opens
the magic sign-in link in the default browser.

Works out of the box with [Proton Mail Bridge](https://proton.me/mail/bridge)'s
local IMAP endpoint — can share config with
[`proton-mail-bridge-client`](https://github.com/googlarz/proton-mail-bridge-client) but does not use its CLI. Holding one persistent connection with real IMAP IDLE means
detection is near-instant, instead of paying a
fresh-process-and-reconnect cost (~4s) for every lookup.

## How it works

1. Loads IMAP credentials at runtime from `IMAP_*` environment variables (or
   a `.env` file), or, failing that, from an existing `proton-mail-bridge-client`
   MCP config (e.g. Claude Desktop's `claude_desktop_config.json`) — rather
   than storing them in this script. The MCP config path only needs the
   connection details, not the CLI itself.
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

- IMAP credentials, supplied either as `IMAP_*` environment variables/`.env`,
  or via an existing `proton-mail-bridge-client` MCP config with Proton
  Bridge's IMAP host/port/credentials (only read for connection details —
  the CLI itself isn't invoked) — see *Credentials* below
- `node` (18+)

## Configuration

The script reads these from the environment, each falling back to a default —
override them if yours differs:

| Variable | Default |
| --- | --- |
| `ENV_FILE` | `.env` next to the script (its real path, resolved through the `PATH` symlink) |
| `CONFIG_JSON` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| `STATE_DIR` | `~/.claude-magic-link-watcher` |
| `SUBJECT_PREFIX` | `Your secure link to Claude.ai is here` |
| `SENDER_SUFFIX` | `@mail.anthropic.com` |
| `FOLDER` | `INBOX` |
| `CONFIRM_BEFORE_OPEN` | `false` — set to `true` to require clicking "Open" in a dialog before the link opens |
| `CONFIRM_TIMEOUT_SECONDS` | `60` — how long the dialog waits; times out to *not* opening |
| `OPEN_DELAY_SECONDS` | `0` — wait this long after a match before opening the link |
| `IDLE_THRESHOLD_SECONDS` | `0` (disabled) — skip opening if the keyboard/mouse have been idle at least this long |
| `MAGIC_LINK_REGEXP` | `https://claude\.ai/magic-link\?[^\s\]\)"'<>]+` — pattern used to extract the link from the email body (no delimiters/flags, passed to `new RegExp()`) |

### Credentials: `.env` or `CONFIG_JSON`

There are two ways to supply IMAP credentials, checked in this order:

1. **`IMAP_HOST` / `IMAP_USERNAME` / `IMAP_PASSWORD`** (plus optional
   `IMAP_PORT`, default `993`, and `IMAP_SECURE`, default `true`) set
   directly as environment variables, or placed in a `.env` file — by
   default `.env` next to the script itself (override the location with
   `ENV_FILE`). `.env` format is one `KEY=VALUE` per line, `#` comments and
   blank lines ignored, values may be wrapped in quotes. A real environment
   variable always takes precedence over the same key in `.env`. This is
   the simplest option if you're setting this up for a non-Proton account
   and don't already have an MCP config lying around.
2. Otherwise, **`CONFIG_JSON`** — `loadCredentials()` falls back to reading
   five fields out of an MCP-config-shaped JSON file. It doesn't actually
   require Proton Bridge, `proton-mail-bridge-client`, or Claude Desktop —
   any IMAP account works as long as the file at `CONFIG_JSON` has this
   shape:

```json
{
  "mcpServers": {
    "proton-mail-bridge": {
      "env": {
        "IMAP_HOST": "127.0.0.1",
        "IMAP_PORT": "1143",
        "IMAP_SECURE": "false",
        "IMAP_USERNAME": "you@example.com",
        "IMAP_PASSWORD": "your-imap-password"
      }
    }
  }
}
```

The `mcpServers.proton-mail-bridge` key path and the `IMAP_*` variable names
are fixed (the script looks them up literally) — only the values need to
point at your actual IMAP server. For a non-Bridge IMAP host, set
`IMAP_SECURE` to `"true"` and `IMAP_PORT` to your provider's TLS port (e.g.
`993`); `IMAP_HOST` doesn't need to be `127.0.0.1` — Bridge is just what
makes that the common case.

Requirements for use with mail servers:

1. **IMAP enabled** on the account (Gmail, Fastmail, iCloud, Outlook,
   self-hosted, etc. all support this, though some require turning it on).
2. **Password-based auth**, not OAuth — the script authenticates with a
   plain username/password, with no OAuth2 flow. So:
   - Gmail: needs an **app password** (requires 2FA enabled).
   - iCloud, Fastmail, Yahoo: same, an app-specific password.
   - Office 365/Outlook: many tenants have disabled basic-auth IMAP
     entirely in favor of OAuth-only — this would block it unless the
     tenant still allows app passwords.
3. **TLS settings matched to the provider** — set `IMAP_SECURE=true` and
   the provider's TLS port (usually `993`). The TLS certificate relaxation
   in the code only applies when `IMAP_HOST` is `127.0.0.1`/`localhost`, so
   a real provider still gets proper certificate validation.
4. **IDLE support**, for the near-instant detection this script is built
   around. Gmail, Fastmail, iCloud, and most modern IMAP servers support
   it; a provider without IDLE would fall back to whatever `imapflow` does
   in that case (not verified here — check `imapflow`'s docs if you pick
   such a provider).
5. **The magic-link email actually lands in that inbox** — true by
   construction if it's the same address you sign into Claude.ai with.

Everything else — subject match, the `SENDER_SUFFIX` DMARC-backed sender
check, dedup by `Message-ID`, link extraction/opening — is already
provider-agnostic.

## Install

```bash
npm install
```

Then either run it directly (`./claude-magic-link-watcher`), or symlink it
onto your `PATH` so `node_modules` still resolves via the script's real path:

```bash
ln -s "$(pwd)/claude-magic-link-watcher" ~/.local/bin/claude-magic-link-watcher
```

To run it as a background service on macOS via `launchd`, first swap in your
own label in `launchd/gs.wbig.claude-magic-link-watcher.plist` (the `gs.wbig`
prefix is mine — use your own reverse-DNS scheme if you like), and check the
`PATH` set in `EnvironmentVariables` includes wherever `node` lives (e.g.
`/opt/homebrew/bin`), since launchd's default `PATH` is minimal and won't
resolve the script's `#!/usr/bin/env node` shebang otherwise.

The plist's paths use a `__HOME__` placeholder rather than a hardcoded home
directory — launchd doesn't expand `~` or `$HOME` in `<string>` values (it
reads the XML literally, no shell involved), so those have to be substituted
before the file is installed rather than left for launchd to resolve at
load time:

```bash
sed "s|__HOME__|$HOME|g" launchd/gs.wbig.claude-magic-link-watcher.plist \
  > ~/Library/LaunchAgents/gs.wbig.claude-magic-link-watcher.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/gs.wbig.claude-magic-link-watcher.plist
```

Logs go to `~/Library/Logs/claude-magic-link-watcher/{stdout,stderr}.log`
(paths set in the plist).

## Known behavior: open may need manual click on "Try Again"

Opening the link may show a "we were unable to verify you with
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
challenge`). Given the failure is 100% reproducible once it begins and
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

Set `IDLE_THRESHOLD_SECONDS` to skip auto-opening whenever the machine has
been idle (no keyboard/mouse/trackpad input) for at least that long — checked
via macOS's `IOHIDSystem` idle counter (`ioreg -c IOHIDSystem`, `HIDIdleTime`
in nanoseconds) right before opening. An intentional sign-in is normally
requested by someone actively at the keyboard; a link arriving while the
machine has sat idle for several minutes is a signal worth not auto-completing
even if the sender check passes (for example, you might be logging in to
Claude on a separate device, and you don't want this script to steal the
magic link).