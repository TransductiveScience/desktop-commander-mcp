const test=require('node:test');
const assert=require('node:assert/strict');
const {classify}=require('../scripts/audit-desktop-commander-processes.cjs');

test('legacy process candidate is distinguished from safe isolated stdio connection',()=>{
  assert.equal(classify({
    command:'node /home/ned/.local/opt/desktop-commander-mcp/dist/index.js',
    home:'/home/ned',override:''
  }),'shared-history-candidate');
  assert.equal(classify({
    command:'node /home/ned/.local/opt/desktop-commander-mcp/dist/index.js',
    home:'/home/ned',override:'/home/ned/.claude-server-commander/tool-history-i9es-stdio-opaque.jsonl'
  }),'isolated-override');
});
test('upstream npm probes and non-MCP processes are not confused with shared legacy writers',()=>{
  assert.equal(classify({
    command:'npm exec @wonderwhy-er/desktop-commander@0.3.3',
    home:'/tmp/kitsune-probe-123',override:''
  }),null);
  assert.equal(classify({
    command:'node /tmp/kitsune-probe-123/.npm/_npx/abc/node_modules/.bin/desktop-commander',
    home:'/tmp/kitsune-probe-123',override:''
  }),'temporary-probe');
  assert.equal(classify({
    command:'uvx mcp-server-git -r /home/ned/projects/desktop-commander-mcp',
    home:'/home/ned',override:''
  }),null);
  assert.equal(classify({
    command:'/usr/local/bin/cloudflared --config /home/ned/.cloudflared/desktop-commander-i9es.yml tunnel run',
    home:'/home/ned',override:''
  }),null);
  assert.equal(classify({
    command:'node /home/ned/other-server.js',
    home:'/home/ned',override:''
  }),null);
});
