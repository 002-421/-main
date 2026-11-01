import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelManager, modelDirectory } from '../electron/ai-model.cjs';

const fixture = Buffer.alloc(2 * 1024 * 1024, 0x5a);
fixture.write('GGUF', 0, 'ascii');
async function serverFor(requestHandler) {
  const server = createServer(requestHandler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/model.gguf` };
}

test('Qwen model cache path stays stable across app versions and build directories', () => {
  const first = modelDirectory({ platform: 'win32', localAppData: 'C:\\Users\\Doctor\\AppData\\Local', userData: 'build-a' });
  const nextBuild = modelDirectory({ platform: 'win32', localAppData: 'C:\\Users\\Doctor\\AppData\\Local', userData: 'build-b' });
  assert.equal(first, nextBuild);
  assert.match(first, /MRI Report Studio[\\/]ai-models$/);
});

test('a new computer without a model cache is detected and can enter the download flow', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mri-qwen-empty-'));
  const manager = createModelManager({ root, model: { id: 'qwen-empty-v1', filename: 'qwen.gguf', url: 'http://127.0.0.1/model.gguf', maxBytes: fixture.length } });
  try {
    assert.deepEqual(await manager.status(), { ready: false, modelId: 'qwen-empty-v1', partialSize: 0, path: path.join(root, 'qwen.gguf') });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a completed Qwen model is reused on later app iterations without another download', async () => {
  let requests = 0;
  const { server, url } = await serverFor((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-length': fixture.length, etag: '"fixture"' });
    response.end(fixture);
  });
  const root = await mkdtemp(path.join(os.tmpdir(), 'mri-qwen-cache-'));
  const manager = createModelManager({ root, model: { id: 'qwen-fixture-v1', filename: 'qwen.gguf', url, maxBytes: fixture.length + 1 } });
  const progress = [];
  try {
    const first = await manager.ensure(event => progress.push(event));
    const reused = await manager.ensure();
    assert.equal(first.ready, true);
    assert.deepEqual(reused, first);
    assert.equal(requests, 1);
    assert.equal((await stat(first.path)).size, fixture.length);
    assert.deepEqual(await readFile(first.path), fixture);
    assert.ok(progress.length > 0);
    assert.equal((await manager.status()).ready, true);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the model cache detects a damaged GGUF file and marks it for redownload', async () => {
  const { server, url } = await serverFor((_request, response) => {
    response.writeHead(200, { 'content-length': fixture.length });
    response.end(fixture);
  });
  const root = await mkdtemp(path.join(os.tmpdir(), 'mri-qwen-integrity-'));
  const manager = createModelManager({ root, model: { id: 'qwen-integrity-v1', filename: 'qwen.gguf', url, maxBytes: fixture.length + 1 } });
  try {
    const cached = await manager.ensure();
    assert.equal((await manager.verifyIntegrity()).valid, true);
    const damaged = Buffer.from(fixture); damaged[damaged.length - 1] ^= 0xff;
    await writeFile(cached.path, damaged);
    assert.deepEqual(await manager.verifyIntegrity(), { valid: false, reason: 'checksum', size: fixture.length });
    assert.equal((await manager.status()).ready, false);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('an interrupted Qwen download resumes from its persistent partial file', async () => {
  let rangeStart = -1;
  const { server, url } = await serverFor((request, response) => {
    const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
    rangeStart = range ? Number(range[1]) : -1;
    if (range) {
      response.writeHead(206, {
        'content-length': fixture.length - rangeStart,
        'content-range': `bytes ${rangeStart}-${fixture.length - 1}/${fixture.length}`,
        etag: '"fixture"',
      });
      response.end(fixture.subarray(rangeStart));
    } else {
      response.writeHead(200, { 'content-length': fixture.length, etag: '"fixture"' });
      response.end(fixture);
    }
  });
  const root = await mkdtemp(path.join(os.tmpdir(), 'mri-qwen-resume-'));
  const model = { id: 'qwen-resume-v1', filename: 'qwen.gguf', url, maxBytes: fixture.length + 1 };
  const manager = createModelManager({ root, model });
  try {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'qwen.gguf.part'), fixture.subarray(0, 640_000));
    const result = await manager.ensure();
    assert.equal(rangeStart, 640_000);
    assert.equal(result.ready, true);
    assert.deepEqual(await readFile(result.path), fixture);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
