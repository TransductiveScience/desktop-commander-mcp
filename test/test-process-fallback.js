import assert from 'node:assert/strict';
import http from 'node:http';
import { runWithHttpRequestContext } from '../dist/http/request-context.js';
import { listSessions, readProcessOutput } from '../dist/tools/improved-process-tools.js';
import { callProcessFallback } from '../dist/tools/process-fallback.js';

const resultText = (result) => result?.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || '';

async function main() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ authorization: req.headers.authorization, body });
      const text = body.params.name === 'list_sessions'
        ? 'PID: 4242, Blocked: true, Runtime: 60s'
        : '[Reading 1 lines from line 1 (total: 2 lines, 0 remaining)]\n\nlegacy-output';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text }] } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const previous = process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_URL;
  const previousPort = process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT;

  try {
    delete process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_URL;
    process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT = String(address.port);
    await runWithHttpRequestContext({ accessToken: 'fixture-token' }, async () => {
      const sessions = await listSessions();
      assert.match(resultText(sessions), /PID: 4242/, 'fallback session must remain discoverable through the replacement runtime');

      const output = await readProcessOutput({ pid: 4242, offset: 1, length: 10, timeout_ms: 100 });
      assert.match(resultText(output), /legacy-output/, 'unknown PID must remain readable through the draining runtime');
    });

    assert.equal(requests.length, 2, 'list and read should each be forwarded exactly once');
    assert(requests.every((request) => request.authorization === 'Bearer fixture-token'), 'verified request token must be forwarded without modification');
    assert.deepEqual(requests.map((request) => request.body.params.name), ['list_sessions', 'read_process_output']);

    process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_URL = 'https://example.com/mcp';
    delete process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT;
    await assert.rejects(
      () => callProcessFallback('list_sessions', {}),
      /must be an HTTP loopback URL/,
      'fallback must reject non-loopback destinations before sending credentials',
    );

    console.log('PROCESS_FALLBACK_PASS forwarded=2 loopback_only=true');
  } finally {
    if (previous === undefined) delete process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_URL;
    else process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_URL = previous;
    if (previousPort === undefined) delete process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT;
    else process.env.DESKTOP_COMMANDER_PROCESS_FALLBACK_PORT = previousPort;
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
