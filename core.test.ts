import { expect, test } from 'bun:test';
import path from 'node:path';
import sharp from 'sharp';

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

test('findGapOffset detects a puzzle gap in a synthetic image', async () => {
  // Inline the algorithm to avoid importing core.cjs (which starts pool/timers).
  async function findGapOffset(bgBuffer: Buffer): Promise<number> {
    const raw = await sharp(bgBuffer).grayscale().raw().toBuffer({ resolveWithObject: true });
    const w = raw.info.width, h = raw.info.height;
    const data = raw.data;

    const iw = w + 1;
    const I = new Float64Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        I[(y + 1) * iw + (x + 1)] =
          data[y * w + x] + I[y * iw + (x + 1)] + I[(y + 1) * iw + x] - I[y * iw + x];
      }
    }
    function rectSum(x1: number, y1: number, x2: number, y2: number) {
      return I[(y2 + 1) * iw + (x2 + 1)] - I[y1 * iw + (x2 + 1)] - I[(y2 + 1) * iw + x1] + I[y1 * iw + x1];
    }

    const gW = Math.round(w * 0.16);
    const gH = Math.round(h * 0.35);
    const pad = Math.round(gW * 0.35);
    const startX = Math.floor(w * 0.15);

    let bestX = startX, bestContrast = -Infinity;
    for (let x = startX; x <= w - gW; x++) {
      for (let y = pad; y <= h - gH - pad; y++) {
        const innerArea = gW * gH;
        const innerSum = rectSum(x, y, x + gW - 1, y + gH - 1);
        const ox1 = Math.max(0, x - pad);
        const oy1 = Math.max(0, y - pad);
        const ox2 = Math.min(w - 1, x + gW + pad - 1);
        const oy2 = Math.min(h - 1, y + gH + pad - 1);
        const outerSum = rectSum(ox1, oy1, ox2, oy2);
        const borderArea = (ox2 - ox1 + 1) * (oy2 - oy1 + 1) - innerArea;
        if (borderArea <= 0) continue;
        const contrast = (outerSum - innerSum) / borderArea - innerSum / innerArea;
        if (contrast > bestContrast) {
          bestContrast = contrast;
          bestX = x;
        }
      }
    }
    return bestX;
  }

  const cases = [
    { gapX: 200, label: "gap at 200" },
    { gapX: 120, label: "gap at 120" },
    { gapX: 280, label: "gap at 280" },
  ];

  const width = 340;
  const height = 190;
  const gapW = 55;

  for (const { gapX } of cases) {
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        const inGap = x >= gapX && x < gapX + gapW && y > 20 && y < height - 20;
        const base = inGap ? 40 : 160;
        const noise = Math.floor(Math.random() * 20) - 10;
        const v = Math.max(0, Math.min(255, base + noise));
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = v;
      }
    }

    const bgBuffer = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg()
      .toBuffer();

    const detected = await findGapOffset(bgBuffer);
    expect(Math.abs(detected - gapX)).toBeLessThanOrEqual(5);
  }
}, 15_000);
