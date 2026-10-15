import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Each script answers an invalid argument with output; through a symlink it used to skip main() and exit 0 silently.
const SCRIPTS = ['automerge-guard', 'mission', 'check-edge-contracts', 'factory-release', 'factory-discovery', 'ruos-evaluation', 'benchmark-ticket-codec'];

test('scripts still run when reached through a symlinked checkout', () => {
  const link = join(mkdtempSync(join(tmpdir(), 'dream-link-')), 'checkout');
  symlinkSync(ROOT, link);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const name of SCRIPTS) {
    const result = spawnSync(process.execPath, [join(link, 'scripts', `${name}.mjs`), '--invalid-argument'], {
      cwd: ROOT, env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.notEqual(result.stdout + result.stderr, '', `${name} printed nothing through a symlink (exit ${result.status})`);
  }
});
