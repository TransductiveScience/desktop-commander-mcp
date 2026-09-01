const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function git(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function sha256(relativePath) {
  const content = fs.readFileSync(path.join(root, relativePath));
  return createHash('sha256').update(content).digest('hex');
}

const info = {
  revision: git(['rev-parse', 'HEAD'], 'unknown'),
  dirty: git(['status', '--porcelain'], '') !== '',
  builtAt: new Date().toISOString(),
  node: process.version,
  artifacts: {
    httpIndex: sha256('dist/http/index.js'),
    mcpRouter: sha256('dist/http/mcp-router.js'),
    server: sha256('dist/server.js'),
  },
};

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`Wrote dist/build-info.json for ${info.revision}${info.dirty ? ' (dirty)' : ''}`);
