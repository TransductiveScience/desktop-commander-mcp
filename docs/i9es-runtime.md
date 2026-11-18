# i9ES production runtime branch

This branch tracks the **actual i9ES Linux Desktop Commander source** independently of the cross-platform `main` branch. It preserves i9ES-specific runtime changes without replacing Windows process-control functionality on `main`.

## Scope

- Production source: `/home/ned/.local/opt/desktop-commander-mcp/`
- Git checkout: `/home/ned/projects/desktop-commander-mcp/`
- User service: `desktop-commander-mcp.service`
- Production HTTP: `127.0.0.2:9180`, OAuth-enabled; health at `/healthz`
- Tool contract: 26 operations with a strict `payload_b64` envelope, no MCP embedded `ui://` resources.

i9ES-specific changes include a bounded HTTP shutdown, loopback-only session-count endpoint, unrestricted default file line counts, the i9ES process and filesystem handlers, an optional freezeless-search policy, and removal of Linux-inapplicable Windows process-control handlers. Other service-side scripts not needed for the built MCP are not part of this source snapshot.

## Verification receipts (18 November 2026)

The repository `src/` tree was identical to the installed `src/` tree using `diff -qr`. TypeScript build completed with exit code 0.

Built `dist/server.js` SHA-256:

`e7995e04923d2a9da64f3cc318648011824b1a8c9c386b1674729f9964b119e7`

Built `dist/http/index.js` SHA-256:

`d1156e2b795e79a46b85ab04a3aba7eec5cacc0408d2da83b2a1501aff60135a`

Both hashes matched the live i9ES installation. Its health endpoint returned HTTP 200 and unauthenticated `/mcp` returned HTTP 401. Production OAuth was not disabled or modified, and the running service was not restarted for this source snapshot.

This is a deployment/source parity receipt, not a claim that Base64 is cryptographic protection. Base64 only encodes UTF-8 JSON arguments.

## Opaque history isolation (18 November 2026)

The active user service now has `deploy/i9es/96-opaque-history.conf` installed as a systemd drop-in, setting `DESKTOP_COMMANDER_TOOL_HISTORY_FILE` to `/home/ned/.claude-server-commander/tool-history-i9es-opaque.jsonl`. It retains its existing OAuth and `KillMode=process` settings. Source branch `f38ee6af2a3fb4052dc96c6fcec2dd44cc568cad` was deployed successfully and the service restarted with PID `2349717`; health returned HTTP 200. This documents host state, not a bundled history-data artifact.

Before the cutover, `scripts/migrate-tool-history.cjs` produced an atomic read-only-source snapshot of the legacy shared history: 1,455 records, 1,426 plaintext inputs and outputs converted to Base64; all records passed reversible decode comparison. Snapshot destination SHA-256: `76c68197f861840332b62393754a9de570b4942b359c266c3f5a4dc1ca85280d`. After cutover, a direct `get_config` call increased the dedicated file to 1,456 records, all 1,456 having encoded arguments and outputs; permissions remained `0600`.

**Legacy stream remains active:** Upstream and pre-cutover Desktop Commander instances may still append plaintext into the old `tool-history.jsonl` file. The original was deliberately not replaced, truncated, or deleted, and writes after the snapshot are not included in the dedicated file. A future coordinated retirement of the remaining legacy writers is needed before any archival deletion. The separate test unit `dc-opaque-path-test.service` was stopped after verification; the older shared `dc-opaque-shadow.service` was preserved.

## Legacy writer transition (18 November 2026)

A second updated stdio connection, `dc-i9es-stdio-opaque`, was created through Kitsune (initial PID `2398586`). It exposes the same 26 Base64-only MCP operations, is independently usable, and writes to `~/.claude-server-commander/tool-history-i9es-stdio-opaque.jsonl` with mode `0600`. This leaves existing Kitsune and upstream npm processes alive; it does not redirect their active clients.

The original shared history prefix at **1,713,763 bytes** still had SHA-256 `267668a7eda5505e89a602d6969a6aa1755fddde49774231a580ea59824c8147`. Source-preserving incremental capture is implemented by `scripts/catchup-legacy-history.cjs`, with four fixture tests passing across the initial migration and the incremental importer. The attempted first import against the live source was blocked by the execution gateway, so no live delta-capture receipt exists yet. No recurring timer was installed. The old shared history remains intact.

Remaining work: verify the first real-source catch-up, then transition active legacy Kitsune callers to the updated stdio alias when those sessions can safely reconnect. Never terminate these processes solely on the basis of their executable name.
