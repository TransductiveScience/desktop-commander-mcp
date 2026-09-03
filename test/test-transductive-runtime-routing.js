import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtimeFiles = [
  'src/utils/feature-flags.ts',
  'src/utils/open-browser.ts',
  'src/utils/capture.ts',
  'src/utils/dockerPrompt.ts',
  'src/remote-device/device.ts',
  'setup-claude-server.js',
  'uninstall-claude-server.js',
  'track-installation.js',
  'plugin.json',
  'manifest.template.json',
  'server.json',
  'server.yaml',
  'README.md',
  'FAQ.md',
  'PRIVACY.md',
];

for (const file of runtimeFiles) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:^|\.)desktopcommander\.app/i, `${file} must not relay to desktopcommander.app`);
}

const flags = fs.readFileSync(new URL('../src/utils/feature-flags.ts', import.meta.url), 'utf8');
assert.match(flags, /process\.env\.DC_FLAG_URL\?\.trim\(\) \|\| null/, 'remote feature flags must be explicit opt-in');

const server = fs.readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
assert.match(server, /transductive-science-desktop-commander/, 'MCP server identity must be Transductive Science');

console.log('TRANSDUCTIVE_RUNTIME_ROUTING_PASS upstream_relay=absent remote_flags=opt_in');
