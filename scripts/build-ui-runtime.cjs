#!/usr/bin/env node
/**
 * Embedded MCP Apps UI has been removed. This step exists for compatibility
 * with older package build scripts, and removes any stale UI bundles emitted
 * by a previous build. Keep the file-preview shared type modules intact.
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const obsolete = [
  'dist/ui/contracts.js',
  'dist/ui/contracts.d.ts',
  'dist/ui/resources.js',
  'dist/ui/resources.d.ts',
  'dist/ui/config-editor/index.html',
  'dist/ui/config-editor/styles.css',
  'dist/ui/config-editor/config-editor-runtime.js',
  'dist/ui/file-preview/index.html',
  'dist/ui/file-preview/styles.css',
  'dist/ui/file-preview/preview-runtime.js',
];
for (const relativePath of obsolete) {
  fs.rmSync(path.join(root, relativePath), { force: true });
}
console.log('MCP embedded UI omitted; stale UI bundles removed.');
