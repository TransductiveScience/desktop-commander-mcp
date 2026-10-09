# Windows-native process control (Transductive Edge)

This fork keeps Desktop Commander's cross-platform file, shell, session and MCP runtime.
It adds Windows-only native process inspection and guarded scheduler controls. These
are explicit MCP tools, **not** an assertion that Desktop Commander is Windows-only.

## Implemented and verified (2026-10-09)

- `list_processes`: Windows uses structured PowerShell `Get-Process` rather than
  whitespace-splitting `tasklist`; Linux/macOS use a `ps` listing.
- `inspect_windows_process`: inspect a PID with a timed CPU sample; return the
  process creation instant, parent PID, session ID, CPU share (single-core and
  machine-wide), cumulative CPU seconds, private/working-set bytes, thread count,
  handle count, priority, and affinity.
- `set_windows_process_policy`: optionally adjust priority (idle, below normal,
  normal, above normal, high) and/or CPU affinity. Requires PID **and** exact
  creation timestamp obtained from inspection, to prevent PID-reuse races.
  `dry_run` defaults to true and every applied change is read back.
  There is intentionally no real-time-priority setting.
- Startup validation discards invalid optional legacy process-fallback ports,
  instead of breaking core session listing.

## MCP calls

Read-only observation:

```json
{"name":"inspect_windows_process","arguments":{"pid":28604,"sample_ms":500}}
```

Preview a resource-policy adjustment (copy actual start_utc from the observation):

```json
{"name":"set_windows_process_policy","arguments":{
  "pid":28604,"expected_start_utc":"2026-10-08T13:55:56.2580000Z",
  "priority":"below_normal","dry_run":true
}}
```

Only use `"dry_run":false` after checking the exact target and intended effect.
This is a process-priority/affinity primitive, not Process Lasso's automatic
persistent policy engine. Existing system and third-party processes must not
be changed based only on executable names.

## Platforms and limitations

The **core** remains cross-platform. Windows-only tools emit explicit unsupported
results on Linux/macOS; they never attempt to execute Windows commands there.
Fork-specific Windows deployment is verified; Linux/macOS should be regression-
tested independently before claiming full deployment parity.

Current scope does NOT include process suspension, a kernel driver, ProBalance,
persistent rules, fine-grained thread scheduling, or system-wide CPU policy.
A safe future extension would add process trees, network sockets, I/O counters,
per-thread samples, and policy histories, with identity checks and test receipts.

## Verification

- `npm run build` — success (TypeScript).
- `node scripts/windows/test-process-control.mjs` — 11 checks passed, including an actual priority change on the test process and restoration.
- `node scripts/validate-tools-sync.js` — 28 server tools match 28 manifest entries.
- Live Windows HTTP MCP `list_processes` and `list_sessions` recovered after
  a controlled scheduled-task restart on port 9180.
- Machine receipt: `logs/windows-process-control-test.json` (local receipt,
  not checked into Git).
