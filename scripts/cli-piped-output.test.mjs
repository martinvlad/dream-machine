import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = 'packages/cli/dist/bin.js';

test('piped CLI output arrives whole even when the reader is slow', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dream-pipe-'));
  const config = join(dir, 'dream.config.json');
  const extraDisciplines = Array.from({ length: 5000 }, (_, i) => `discipline-${i}-${'x'.repeat(32)}`);
  writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync('dream.config.json', 'utf8')), extraDisciplines }));
  const file = join(dir, 'prompt.md');
  await new Promise((done, fail) => spawn(process.execPath, [BIN, 'compile', config, '--out', file], { stdio: 'ignore' })
    .on('exit', (code) => (code === 0 ? done() : fail(new Error(`compile --out exited ${code}`)))));
  const expected = readFileSync(file, 'utf8');
  assert.ok(expected.length > 128 * 1024, `fixture should exceed a pipe buffer, got ${expected.length} bytes`);

  // A consumer that starts reading late, as `dream-machine compile | slow-consumer` does.
  const pipeline = `"${process.execPath}" ${BIN} compile "${config}" | (sleep 1; cat)`;
  const { code, stdout } = await new Promise((done) => {
    const chunks = [];
    const child = spawn('/bin/sh', ['-c', pipeline], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (status) => done({ code: status, stdout: Buffer.concat(chunks) }));
  });
  assert.equal(code, 0);
  const received = stdout.toString('utf8');
  // stdout ends with a newline the file doesn't have; compare the text itself.
  assert.ok(received.trimEnd().length === expected.trimEnd().length, `received ${received.length} of ${expected.length} bytes`);
  assert.ok(received.trimEnd() === expected.trimEnd(), 'piped text differs from the --out file');
});
