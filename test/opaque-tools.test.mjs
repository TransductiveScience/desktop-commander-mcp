import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = new URL(process.env.DC_OPAQUE_TEST_URL || 'http://127.0.0.1:9181/mcp');
const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
async function withClient(fn) {
  const client = new Client({ name: 'desktop-commander-opaque-contract-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(endpoint);
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
test('MCP has no embedded UI capability and tools use opaque argument envelopes', async () => {
  await withClient(async (client) => {
    const capabilities = client.getServerCapabilities();
    assert.equal(capabilities.resources, undefined);
    const listing = await client.listTools();
    assert.equal(listing.tools.length, 26);
    for (const tool of listing.tools) {
      assert.deepEqual(tool.inputSchema.required, ['payload_b64'], tool.name);
      assert.deepEqual(Object.keys(tool.inputSchema.properties), ['payload_b64'], tool.name);
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      assert.ok(!JSON.stringify(tool).includes('ui://'), tool.name);
      assert.ok(!JSON.stringify(tool).includes('outputTemplate'), tool.name);
      assert.ok(!JSON.stringify(tool).includes('resourceUri'), tool.name);
    }
  });
});
test('plaintext and malformed Base64 fail closed', async () => {
  await withClient(async (client) => {
    const cases = [
      { origin: 'llm' },
      { payload_b64: '', unexpected: true },
      { payload_b64: '!!!!' },
      { payload_b64: 'e30' },
      { payload_b64: encode([]) },
      { payload_b64: encode('hello') },
      { payload_b64: encode({}), origin: 'llm' },
    ];
    for (const value of cases) {
      const response = await client.callTool({ name: 'get_config', arguments: value });
      assert.equal(response.isError, true, JSON.stringify(value));
      assert.match(JSON.stringify(response.content), /BASE64_REQUIRED|BASE64_INVALID/);
    }
  });
});
test('encoded configuration, filesystem, and process calls succeed', async () => {
  await withClient(async (client) => {
    const config = await client.callTool({ name: 'get_config', arguments: { payload_b64: encode({}) } });
    assert.notEqual(config.isError, true);
    assert.match(JSON.stringify(config.content), /Current configuration/);
    assert.equal(config.structuredContent, undefined, 'get_config must never provide editor widget payload');
    const oldUiConfig = await client.callTool({ name: 'get_config', arguments: { payload_b64: encode({ origin: 'ui' }) } });
    assert.notEqual(oldUiConfig.isError, true);
    assert.equal(oldUiConfig.structuredContent, undefined, 'cached UI callers receive plain text only');

    const file = await client.callTool({ name: 'read_file', arguments: { payload_b64: encode({ path: new URL('../package.json', import.meta.url).pathname, length: 4 }) } });
    assert.notEqual(file.isError, true);
    assert.match(JSON.stringify(file.content), /desktop-commander/);
    const oldUiFile = await client.callTool({ name: 'read_file', arguments: { payload_b64: encode({ path: new URL('../package.json', import.meta.url).pathname, length: 4, origin: 'ui' }) } });
    assert.notEqual(oldUiFile.isError, true);
    assert.equal(oldUiFile.structuredContent, undefined, 'cached preview callers must not receive widget payload');

    const process = await client.callTool({ name: 'start_process', arguments: { payload_b64: encode({ command: "printf 'OPAQUE_EXEC_OK\\n'", timeout_ms:8000 }) } });
    assert.notEqual(process.isError, true);
    assert.match(JSON.stringify(process.content), /OPAQUE_EXEC_OK/);
  });
});
