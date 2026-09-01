import assert from 'node:assert/strict';
import { createMcpHttpRouter } from '../dist/http/mcp-router.js';

function request(sessionId) {
  return { headers: sessionId ? { 'mcp-session-id': sessionId } : {} };
}

function response() {
  return {
    headersSent: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      this.body = body;
    },
  };
}

function createHarness() {
  const servers = [];
  const transports = [];
  let nextInitializedSession;

  const router = createMcpHttpRouter({
    isInitializeRequest: body => body?.method === 'initialize',
    createServer() {
      const server = {
        connectedTransport: undefined,
        closeCount: 0,
        async connect(transport) { this.connectedTransport = transport; },
        async close() { this.closeCount += 1; },
        async sendLoggingMessage() {},
      };
      servers.push(server);
      return server;
    },
    createTransport(options) {
      const transport = {
        options,
        requests: [],
        closeCount: 0,
        async handleRequest(req, _res, body) {
          this.requests.push({ req, body });
          if (body?.method === 'initialize' || (Array.isArray(body) && body.some(item => item?.method === 'initialize'))) {
            await options.onSessionInitialized(nextInitializedSession);
          }
        },
        async close() { this.closeCount += 1; },
      };
      transports.push(transport);
      return transport;
    },
  });

  return {
    router,
    servers,
    transports,
    setNextInitializedSession(value) { nextInitializedSession = value; },
  };
}

async function main() {
  const harness = createHarness();

  await harness.router.handlePost(request(), response(), { method: 'tools/call' });
  await harness.router.handlePost(request(), response(), { method: 'tools/call' });
  assert.equal(harness.servers.length, 1, 'stateless requests should reuse one server');
  assert.equal(harness.transports.length, 1, 'stateless requests should reuse one transport');
  assert.equal(harness.transports[0].options.stateless, true);
  assert.equal(harness.transports[0].requests.length, 2);

  harness.setNextInitializedSession('stateful-session');
  await harness.router.handlePost(request(), response(), { method: 'initialize' });
  assert.equal(harness.router.sessionCount(), 1, 'initialize should register its session');
  assert.equal(harness.transports[1].options.stateless, undefined);
  await harness.router.handlePost(request('stateful-session'), response(), { method: 'tools/call' });
  assert.equal(harness.transports[1].requests.length, 2, 'registered session should route to its original transport');

  const staleResponse = response();
  await harness.router.handlePost(request('stale-session'), staleResponse, { method: 'tools/call' });
  assert.equal(staleResponse.status, 404, 'ordinary stale sessions should return 404');

  harness.setNextInitializedSession('recovered-session');
  await harness.router.handlePost(request('stale-session'), response(), [{ method: 'initialize' }]);
  assert.equal(harness.router.sessionCount(), 2, 'fresh initialize envelope should retain its new session');
  assert.equal(harness.transports[2].options.stateless, undefined);
  await harness.router.handlePost(request('recovered-session'), response(), { method: 'tools/call' });
  assert.equal(harness.transports[2].requests.length, 2, 'recovered session should route to its original transport');

  await harness.router.cleanup();
  assert.equal(harness.router.sessionCount(), 0);
  assert.deepEqual(harness.transports.map(item => item.closeCount), [1, 1, 1]);
  assert.deepEqual(harness.servers.map(item => item.closeCount), [1, 1, 1]);

  console.log('HTTP MCP router lifecycle tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
