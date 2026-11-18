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

The original shared history prefix at **1,713,763 bytes** retains SHA-256 `267668a7eda5505e89a602d6969a6aa1755fddde49774231a580ea59824c8147`. Source-preserving incremental capture is implemented by `scripts/catchup-legacy-history.cjs`, and the initial migration plus incremental importer passed four tests.

**Live import and timer verification, 18 November 2026:** The first real capture imported 63 complete records from byte 1,713,763 to 1,787,415. Two further manual calls imported one new record each; a systemd-managed service run at 17:08 CET then imported five additional records through byte 1,797,168. All 70 imported records had their arguments and outputs converted to Base64, maintaining exact contiguous source byte ranges. Prior delta archives were reverified before each subsequent capture. Along with the 1,455-record initial snapshot, this accounts for 1,525 records as of 17:08 CET. Legacy processes continue to append to the untouched original file.

The verified user units `deploy/i9es/dc-legacy-history-catchup.service` and `deploy/i9es/dc-legacy-history-catchup.timer` were installed in `~/.config/systemd/user/`. The timer is enabled and active on a five-minute calendar. The first manual service execution returned `Result=success`, `ExecMainStatus=0`; its journal includes exact byte ranges, hashes and counts. The next scheduled trigger was reported as **17:10 CET**. The service only runs the importer and never restarts any MCP server.

Remaining work: selectively transition existing legacy Kitsune connections to the verified `dc-i9es-stdio-opaque` alias as their sessions can reconnect safely. Never terminate them based solely on executable names. No deletion or truncation of legacy history is authorized.
