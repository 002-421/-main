import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { summarizeFrame } = require('../electron/startup-diagnostics.cjs');

test('startup frame summary records color distribution without persisting image content', () => {
  const image = {
    getSize: () => ({ width: 2, height: 2 }),
    // NativeImage bitmap uses BGRA ordering.
    getBitmap: () => Buffer.from([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
  };
  assert.deepEqual(summarizeFrame(image), {
    width: 2, height: 2, sampledPixels: 4, distinctSampleColors: 2,
    dominantColors: [{ color: '#000000', count: 2 }, { color: '#ffffff', count: 2 }],
  });
});
