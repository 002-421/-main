import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { closeSession, editorSnapshot, launchSession, sanitizedRequest } from './windows-ai-review-session.mjs';

const output = process.env.XRS_SMOKE_OUTPUT;
if (!output) throw new Error('XRS_SMOKE_OUTPUT is required');
await mkdir(output, { recursive: true });

const sessionState = { session: undefined, traceStarted: false, pageErrors: [], networkRequests: [], rendererReady: false };
const report = { mode: 'diagnostics', status: 'FAIL', profileMode: 'temporary --user-data-dir', rendererReady: false, workspaceState: null, errors: [], files: [] };
const writeJson = (filename, value) => writeFile(path.join(output, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

try {
  const session = await launchSession();
  sessionState.session = session;
  session.page.on('console', message => {
    if (message.type() === 'error') sessionState.pageErrors.push({ kind: 'console.error', message: message.text().slice(0, 1500) });
  });
  session.page.on('pageerror', error => sessionState.pageErrors.push({ kind: 'pageerror', message: String(error.message).slice(0, 1500) }));
  session.page.on('request', request => {
    if (/^https?:/i.test(request.url())) sessionState.networkRequests.push(sanitizedRequest(request));
  });

  await session.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  sessionState.traceStarted = true;
  await session.page.locator('#editor .ProseMirror').waitFor({ state: 'visible', timeout: 60_000 });
  const snapshot = await editorSnapshot(session.page);
  sessionState.rendererReady = snapshot.editorVisible;
  report.rendererReady = snapshot.editorVisible;
  if (!snapshot.editorVisible) throw new Error('Editor root is not visible');
  const sectionsBeforeAction = snapshot.sections.map(section => section.id);
  await session.page.locator('#new-report').click();
  await session.page.waitForFunction(() => {
    const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1') || 'null');
    return workspace?.reports?.length === 2 && workspace.reports.some(report => report.id === workspace.activeId);
  }, null, { timeout: 15_000 });
  const afterSave = await editorSnapshot(session.page);
  report.workspaceSaveCheck = {
    beforeUserAction: { workspacePresent: snapshot.workspacePresent, inMemorySectionIds: sectionsBeforeAction },
    afterRealUiAction: { workspacePresent: afterSave.workspacePresent, reportCount: afterSave.workspaceReportCount, activeDocumentPresent: afterSave.activeDocumentPresent },
    result: afterSave.workspacePresent && afterSave.workspaceReportCount === 2 ? 'PASS' : 'FAIL',
  };
  report.workspaceState = afterSave;
  await writeJson('application-state.json', { initial: snapshot, afterWorkspaceSaveAction: afterSave, workspaceSaveCheck: report.workspaceSaveCheck });
  if (report.workspaceSaveCheck.result !== 'PASS') throw new Error('Workspace save check failed after creating a report through the UI');
  report.status = 'PASS';
} catch (error) {
  report.errors.push({ message: String(error.message).slice(0, 2000) });
  const session = error.session ?? sessionState.session;
  if (session) sessionState.session = session;
  if (session?.page) {
    try {
      await writeFile(path.join(output, 'dom-snapshot.html'), await session.page.content(), 'utf8');
    } catch (snapshotError) { report.errors.push({ stage: 'dom-snapshot', message: String(snapshotError.message).slice(0, 1000) }); }
    try {
      await session.page.screenshot({ path: path.join(output, 'failure-window.png'), fullPage: false, timeout: 15_000 });
    } catch (screenshotError) {
      report.errors.push({ stage: 'screenshot', message: String(screenshotError.message).slice(0, 1000) });
      try { await writeFile(path.join(output, 'screenshot-unavailable.txt'), 'Renderer screenshot capture failed.\n', 'utf8'); } catch {}
    }
    try { report.workspaceState = await editorSnapshot(session.page); } catch {}
  } else {
    try { await writeFile(path.join(output, 'dom-snapshot.html'), '<!-- renderer unavailable -->\n', 'utf8'); } catch {}
    try { await writeFile(path.join(output, 'screenshot-unavailable.txt'), 'No renderer window was available to capture.\n', 'utf8'); } catch {}
    report.workspaceState = { available: false };
  }
} finally {
  const session = sessionState.session;
  if (session?.page) {
    try { await writeFile(path.join(output, 'dom-snapshot.html'), await session.page.content(), 'utf8'); } catch {}
    if (report.status !== 'PASS') {
      try { await session.page.screenshot({ path: path.join(output, 'failure-window.png'), fullPage: false, timeout: 15_000 }); }
      catch { try { await writeFile(path.join(output, 'screenshot-unavailable.txt'), 'Renderer screenshot capture failed.\n', 'utf8'); } catch {} }
    }
  }
  if (sessionState.traceStarted) {
    try { await session.context.tracing.stop({ path: path.join(output, 'playwright-trace.zip') }); }
    catch (error) { report.errors.push({ stage: 'trace-stop', message: String(error.message).slice(0, 1000) }); }
  } else await writeFile(path.join(output, 'trace-unavailable.txt'), 'Playwright could not connect to an Electron context; no trace can be produced.\n', 'utf8');
  report.rendererConsoleErrors = sessionState.pageErrors;
  report.rendererHttpRequests = sessionState.networkRequests;
  await writeJson('network-requests.json', sessionState.networkRequests);
  await closeSession(session);
  report.files = ['application-stdout.log', 'application-stderr.log', 'electron-chromium.log', 'electron-logs/', 'playwright-trace.zip or trace-unavailable.txt', 'failure-window.png or screenshot-unavailable.txt', 'dom-snapshot.html', 'application-state.json', 'network-requests.json'];
  await writeJson('diagnostics.json', report);
}

if (report.status !== 'PASS') process.exitCode = 1;
