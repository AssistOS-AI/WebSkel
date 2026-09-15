/*
 * Local build validation script
 * - Runs `npm run build`
 * - Verifies dist files exist
 * - Imports ESM and requires UMD bundles to ensure they load
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');
  const esPath = path.join(distDir, 'webskel.mjs');
  const umdPath = path.join(distDir, 'webskel.umd.js');

  console.log('Building library with Vite...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

  console.log('Verifying dist artifacts...');
  for (const p of [esPath, umdPath]) {
    if (!fs.existsSync(p)) {
      throw new Error(`Expected build artifact missing: ${p}`);
    }
    const stats = fs.statSync(p);
    if (stats.size === 0) {
      throw new Error(`Build artifact is empty: ${p}`);
    }
  }

  console.log('Importing ESM build...');
  const esm = await import(pathToFileURL(esPath).href);
  const esmExport = esm?.default ?? esm?.WebSkel;
  if (typeof esmExport !== 'function') {
    throw new Error('ESM export is not a class/function');
  }
  if (typeof esmExport.initialise !== 'function') {
    throw new Error('ESM export does not expose static initialise()');
  }
  if (typeof esm.createSecureUuid !== 'function') {
    throw new Error('ESM build does not export createSecureUuid()');
  }

  console.log('Requiring UMD build...');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const umd = require(umdPath);
  const umdExport = umd?.default ?? umd?.WebSkel ?? umd; // UMD may export in different shapes
  if (typeof umdExport !== 'function') {
    throw new Error('UMD export is not a class/function');
  }
  if (typeof umdExport.initialise !== 'function') {
    throw new Error('UMD export does not expose static initialise()');
  }
  if (typeof umd.createSecureUuid !== 'function') {
    throw new Error('UMD build does not export createSecureUuid()');
  }
  const cryptoApi = { getRandomValues(bytes) { bytes.fill(0); return bytes; } };
  const expected = '00000000-0000-4000-8000-000000000000';
  if (esm.createSecureUuid(cryptoApi) !== expected || umd.createSecureUuid(cryptoApi) !== expected) {
    throw new Error('Built UUID helpers must work without crypto.randomUUID()');
  }

  console.log('Build validation passed. Dist artifacts are present and loadable.');
}

main().catch((err) => {
  console.error('\nBuild validation failed:\n', err?.stack || err?.message || err);
  process.exit(1);
});

