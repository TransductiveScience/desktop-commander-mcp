# i9ES Desktop Commander stdio connection cutover

Last live inventory: 18 November 2026, 17:19 CET.

## Canonical active targets

| Kitsune alias / service | Process at inspection | History ownership |
|---|---:|---|
| `dc-i9es-stdio-opaque` | 2398586 | `~/.claude-server-commander/tool-history-i9es-stdio-opaque.jsonl` |
| `desktop-commander-mcp.service` | 2349717 | `~/.claude-server-commander/tool-history-i9es-opaque.jsonl` |
| `dc-i9es-opaque-publisher` | 1822422 | Legacy shared `~/.claude-server-commander/tool-history.jsonl` |

The process inspection identified four upstream npm `0.3.3` workers using separate temporary HOME directories. These are independent probe instances, not writers to the shared `/home/ned` history.

The source is `scripts/audit-desktop-commander-processes.cjs`. It reads process metadata without exposing argument contents, credentials or complete environments. Run `node scripts/audit-desktop-commander-processes.cjs`; verify with `node --test test/desktop-commander-process-audit.test.cjs`.

**Limit of evidence:** A `/proc` inventory identifies possible file owners, not in-flight tool requests, remote session references, or whether clients have completed a handoff. Kitsune's connection status reports cumulative call counts, but a stable count is not sufficient to conclude all clients have disconnected.

## Migration rule

1. Route **new** tool calls through the verified `dc-i9es-stdio-opaque` alias, or the authenticated production HTTP server. Both use Base64-only `payload_b64` and private history files.
2. Keep `dc-i9es-opaque-publisher` reachable while any existing session could still call it. Do not invoke `Kitsune.release` or `Kitsune.reload` without session-drain evidence: both terminate the current subprocess.
3. Once dependent clients explicitly reconnect to the new alias, check that the old alias has no pending requests or active consumers and that its call count stays unchanged across the drain window. Only then release the old alias. Do not stop the parent Kitsune service.
4. Verify the upgraded destination's tool list, a read-only encoded `get_config`, file mode `0600`, and the continued health of the production HTTP service. Run the process inventory again and confirm the shared-history candidate disappears.

## Historic data

The original plaintext history must **not** be truncated or replaced while old writers exist. A separately verified 1,455-record snapshot and immutable incremental deltas preserve a reversible Base64 version. The user timer `dc-legacy-history-catchup.timer` runs every five minutes and validates all prior byte intervals before importing new complete records. Failures are visible in `dc-legacy-history-catchup.service` status and journal; the importer never restarts MCP processes.

## Passive old-alias drain observer (18 November 2026)

Because Kitsune's alias resolver chooses the **first matching live connection**, reconnecting a second server under the legacy name cannot safely reroute its clients. `Kitsune.reload` and `Kitsune.release` both terminate the older process.

`scripts/observe-kitsune-legacy.mjs` uses a read-only call to Kitsune's local MCP `status` tool and stores only the old/new PIDs, per-connection call counts, and shared legacy file inode/size/mtime. It never reads or stores command contents and never invokes a release or reload. Records go to `~/.claude-server-commander/legacy-alias-observer.jsonl` (mode `0600`). Two fixture tests passed: `node --test test/observe-kitsune-legacy.test.mjs`.

The owner-scoped `deploy/i9es/dc-legacy-alias-observer.service` and `.timer` were installed under `~/.config/systemd/user/`; the service's first run returned `Result=success` and `ExecMainStatus=0`. The timer was enabled for a 15-minute calendar, with the next trigger verified at **17:45 CET**. Initial readings: legacy PID `1822422`, **160 calls**; upgraded PID `2398586`, **61 calls**; legacy file `1,831,033` bytes and unchanged. This observer never authorizes retirement itself.

**Retirement condition:** Observe stable counts over a meaningful drain window *and* establish that dependent clients have switched or disconnected. If that evidence cannot be obtained, leave the legacy alias running. Inactivity alone is insufficient.

Base64 is reversible encoding, not encryption, and is not an authorization boundary. Production HTTP OAuth remains unchanged.
