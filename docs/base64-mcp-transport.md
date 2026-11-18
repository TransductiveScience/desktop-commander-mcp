# Opaque Base64 MCP transport

Desktop Commander MCP uses a **Base64-only argument envelope**. This is an encoding convention for machine-readable messages, not encryption, authorization, or a scanner bypass.

For each tool, supply exactly one argument named `payload_b64`. Encode the JSON object containing that tool's original arguments as UTF-8, then encode those bytes with padded RFC 4648 Base64.

Example of original argument object:

```json
{"command":"printf 'ready\\n'","timeout_ms":8000}
```

The client sends the MCP tool call with:

```js
const payload_b64 = Buffer.from(
  JSON.stringify({ command: "printf 'ready\\n'", timeout_ms: 8000 }),
  'utf8'
).toString('base64');
await client.callTool({ name: 'start_process', arguments: { payload_b64 } });
```

The server validates the envelope (one property, canonical Base64 with valid padding), decodes UTF-8, parses JSON, requires an object, and then dispatches to its original operation. Normal operation-specific validation remains in each handler. Requests using unencoded argument properties are rejected with `BASE64_REQUIRED`. Malformed payloads return `BASE64_INVALID`.

MCP embedded HTML resources have been removed: the initialize response advertises no `resources` capability, and tool descriptions contain no `ui://` URI, `openai/outputTemplate`, or `ui/resourceUri` metadata.

Tool responses are also **content-only**: no `structuredContent` widget payload is returned. `get_config` now returns configuration as ordinary text rather than editable `uiHints`/`entries` metadata. This holds for legacy clients that still submit an encoded `origin: "ui"` argument. File-reading tools keep their ordinary text/image content available to agents.

**Boundaries:** Base64 is reversible by any recipient, observer, or scanner that recognizes it. The existing OAuth authorization remains mandatory on the external HTTP endpoint. Sensitive inputs should not be placed in logs. Existing MCP clients that cached the old tool schemas must reconnect and rediscover the current schemas.

**Tool history:** New records persist both argument objects and capped outputs as reversible UTF-8 JSON/Base64 envelopes. `get_recent_tool_calls` returns these envelopes without silently decoding them. Older plaintext entries are converted in memory when loaded, but their historical on-disk bytes remain unchanged: concurrent MCP instances may be writing to the same JSONL file. Explicitly decoding a history field reconstructs its data. This is opacity, not confidentiality against someone with file access.

## Verification

Build: `npm run build`.

On an isolated HTTP test instance at `http://127.0.0.1:9181/mcp` with authentication disabled only for loopback testing:

```sh
node --test test/opaque-tools.test.mjs
```

The suite checks all tool schemas, no embedded UI metadata, strict rejection of plaintext and noncanonical inputs, and successful encoded configuration, file-read, and process commands.
