import { expect, test } from 'bun:test';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir);

test('a refused malq connection is labelled and retried within five seconds', async () => {
  const probe = `
    globalThis.fetch = async () => { throw new Error('Unable to connect'); };
    require('./api/core.cjs');
    await Bun.sleep(6500);
  `;
  const child = Bun.spawn(['bun', '-e', probe], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const output = `${stdout}\n${stderr}`;
  const failures = output.match(/pool: fill error/g) ?? [];

  expect(exitCode).toBe(0);
  expect(output).toContain('malq unavailable at http://127.0.0.1:4400');
  expect(output).toContain('retrying in 5s');
  expect(failures.length).toBeGreaterThanOrEqual(2);
}, 10_000);
