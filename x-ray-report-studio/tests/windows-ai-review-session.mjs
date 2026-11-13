import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);

export async function launchSession() {
  const playwrightCorePath = process.env.XRS_SMOKE_PLAYWRIGHT_CORE;
  const exe = process.env.XRS_SMOKE_EXE;
  const profile = process.env.XRS_SMOKE_PROFILE;
  const output = process.env.XRS_SMOKE_OUTPUT;
  assert.ok(playwrightCorePath, 'XRS_SMOKE_PLAYWRIGHT_CORE is required');
  assert.ok(exe, 'XRS_SMOKE_EXE is required');
  assert.ok(profile, 'XRS_SMOKE_PROFILE is required');
  assert.ok(output, 'XRS_SMOKE_OUTPUT is required');
  await mkdir(output, { recursive: true });

  const probe = spawnSync('node', ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const port = Number(probe.stdout.trim());
  assert.ok(Number.isInteger(port) && port > 0, 'Could not allocate a loopback DevTools port');

  const stdout = createWriteStream(path.join(output, 'application-stdout.log'), { flags: 'a' });
  const stderr = createWriteStream(path.join(output, 'application-stderr.log'), { flags: 'a' });
  const app = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--no-first-run', '--disable-gpu', '--enable-logging=stderr', `--log-file=${path.join(output, 'electron-chromium.log')}`], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  app.on('error', error => {
    spawnError = error;
    stderr.write(`${error.stack ?? error.message}\n`);
  });
  app.stdout.pipe(stdout);
  app.stderr.pipe(stderr);
  const session = { app, browser: undefined, context: undefined, page: undefined, stdout, stderr, output };

  try {
    const endpoint = `http://127.0.0.1:${port}`;
    let version;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`Could not start packaged EXE: ${spawnError.message}`);
      if (app.exitCode !== null) throw new Error(`Packaged EXE exited early (${app.exitCode})`);
      try {
        const response = await fetch(`${endpoint}/json/version`);
        if (response.ok) { version = await response.json(); break; }
      } catch { /* Wait for the loopback-only Electron DevTools endpoint. */ }
      await delay(500);
    }
    assert.ok(version?.webSocketDebuggerUrl, 'Electron DevTools endpoint did not start');
    const { chromium } = require(playwrightCorePath);
    session.browser = await chromium.connectOverCDP(endpoint);
    const contexts = session.browser.contexts();
    assert.equal(contexts.length, 1, 'Expected one isolated Electron profile');
    session.context = contexts[0];

    let pages = session.context.pages();
    const pageDeadline = Date.now() + 60_000;
    while (!pages.some(candidate => candidate.url().startsWith('file:')) && Date.now() < pageDeadline) {
      await delay(250);
      pages = session.context.pages();
    }
    session.page = pages.find(candidate => candidate.url().startsWith('file:'));
    assert.ok(session.page, 'Packaged renderer did not open from the portable app directory');
    return session;
  } catch (error) {
    error.session = session;
    throw error;
  }
}

export async function closeSession(session) {
  if (!session) return;
  await session.browser?.close().catch(() => {});
  if (session.app?.exitCode === null && session.app.pid) {
    spawnSync('taskkill.exe', ['/PID', String(session.app.pid), '/T', '/F'], { stdio: 'ignore' });
    session.app.kill();
  }
  session.stdout?.end();
  session.stderr?.end();
}

export function sanitizedRequest(request) {
  const url = new URL(request.url());
  return { method: request.method(), origin: url.origin, resourceType: request.resourceType() };
}

export async function editorSnapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#editor .ProseMirror');
    const workspaceKey = 'mri-report-studio.workspace.v1';
    let workspace = null;
    try { workspace = JSON.parse(localStorage.getItem(workspaceKey) || 'null'); } catch {}
    const active = workspace?.reports?.find(report => report.id === workspace.activeId) ?? null;
    const sections = [...(root?.querySelectorAll('section[data-section-id]') ?? [])].map(section => ({
      id: section.getAttribute('data-section-id'),
      visible: section.getClientRects().length > 0,
      textLength: section.textContent?.length ?? 0,
    }));
    return {
      pageTitle: document.title,
      pageUrlScheme: location.protocol,
      editorVisible: !!root && root.getClientRects().length > 0,
      tabCount: document.querySelectorAll('#report-tabs .report-tab-select').length,
      activeTabPresent: !!document.querySelector('#report-tabs .report-tab.active .report-tab-select'),
      sections,
      workspacePresent: !!workspace,
      workspaceReportCount: workspace?.reports?.length ?? 0,
      activeDocumentPresent: !!active?.doc,
      activeDocumentSectionIds: (active?.doc?.content ?? []).filter(node => node.type === 'reportSection').map(node => node.attrs?.id),
    };
  });
}
