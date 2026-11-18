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

Base64 is reversible encoding, not encryption, and is not an authorization boundary. Production HTTP OAuth remains unchanged.
