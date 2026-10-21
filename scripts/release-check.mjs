import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(pkg.name, '@powercess/tfgm-mcp');
assert.notEqual(pkg.private, true, 'Package must be publishable');
assert.equal(pkg.publishConfig?.access, 'public');
assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const tag = process.env.RELEASE_TAG || '';
if (process.env.DRY_RUN !== 'true' || tag) {
  assert.equal(tag, `v${pkg.version}`, 'Release tag must exactly match package.json version');
}
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);
const tarball = `powercess-tfgm-mcp-${pkg.version}.tgz`;
const distTag = pkg.version.includes('-') ? 'next' : 'latest';
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tarball=${tarball}\ndist_tag=${distTag}\n`);
console.log(`Validated ${pkg.name}@${pkg.version}; npm dist-tag: ${distTag}`);
