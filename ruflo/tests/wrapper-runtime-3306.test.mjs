import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const wrapperSource = fileURLToPath(new URL('../bin/ruflo.js', import.meta.url));
const wrapperVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function install(t, cliVersion) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-wrapper-3306-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const wrapperDir = join(root, 'node_modules', 'ruflo');
  const cliDir = join(root, 'node_modules', '@claude-flow', 'cli');
  mkdirSync(join(wrapperDir, 'bin'), { recursive: true });
  mkdirSync(join(cliDir, 'bin'), { recursive: true });
  copyFileSync(wrapperSource, join(wrapperDir, 'bin', 'ruflo.js'));
  writeFileSync(join(wrapperDir, 'package.json'), JSON.stringify({ name: 'ruflo', version: wrapperVersion, type: 'module' }));
  writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: cliVersion, type: 'module' }));
  writeFileSync(join(cliDir, 'bin', 'cli.js'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.RUFLO_TEST_MARKER, 'launched');\n`);
  return { bin: join(wrapperDir, 'bin', 'ruflo.js'), cliDir, marker: join(root, 'cli-launched') };
}

function run(fixture, args) {
  return spawnSync(process.execPath, [fixture.bin, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, RUFLO_TEST_MARKER: fixture.marker },
  });
}

test('matching wrapper and runtime report the version without importing the CLI', (t) => {
  const fixture = install(t, wrapperVersion);
  const result = run(fixture, ['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `ruflo v${wrapperVersion}\n`);
  assert.equal(result.stderr, '');
  assert.equal(existsSync(fixture.marker), false);
});

test('a stale runtime is disclosed without breaking the version command', (t) => {
  const fixture = install(t, '3.33.0');
  const result = run(fixture, ['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `ruflo v${wrapperVersion}\n`);
  assert.match(result.stderr, new RegExp(`wrapper v${wrapperVersion.replaceAll('.', '\\.')}.*3\\.33\\.0`));
  assert.equal(existsSync(fixture.marker), false);
});

test('a stale runtime is disclosed on stderr and MCP still launches', (t) => {
  const fixture = install(t, '3.33.0');
  const result = run(fixture, ['mcp', 'start']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /expects @claude-flow\/cli/);
  assert.equal(existsSync(fixture.marker), true);
});

test('missing CLI metadata warns without taking the version command offline', (t) => {
  const fixture = install(t, wrapperVersion);
  rmSync(join(fixture.cliDir, 'package.json'));
  const result = run(fixture, ['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `ruflo v${wrapperVersion}\n`);
  assert.match(result.stderr, /cannot verify installed CLI version/);
  assert.equal(existsSync(fixture.marker), false);
});

test('a matching runtime still receives MCP commands', (t) => {
  const fixture = install(t, wrapperVersion);
  const result = run(fixture, ['mcp', 'start']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(existsSync(fixture.marker), true);
});
