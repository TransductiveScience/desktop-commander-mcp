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
