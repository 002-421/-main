import assert from 'node:assert/strict';

export async function chooseExport(page, selector) {
  await page.locator('#save-menu-toggle').click();
  await page.locator(selector).click();
  if (await page.locator('#continue-yellow-export').count()) await page.locator('#continue-yellow-export').click();
}

export function assertNoPrintPreview(page) {
  return page.locator('#preview-report, .word-preview-dialog, #preview-calibration-controls, #settings-preview-calibration').count()
    .then(count => assert.equal(count, 0, 'printing has no preview or calibration controls'));
}

/** Capture the actual web print path, leaving a temporary copy for geometry checks. */
export async function capturePrintLayout(page) {
  await page.evaluate(() => {
    document.querySelector('#test-print-layout')?.remove();
    window.__xrsPrintLayout = null;
    window.print = () => {
      const original = document.querySelector('#editor > .export-only-editor');
      window.__xrsPrintLayout = original.innerHTML;
      const copy = original.cloneNode(true);
      copy.id = 'test-print-layout';
      copy.style.display = 'block';
      document.body.append(copy);
    };
  });
  await chooseExport(page, '#export-pdf');
  await page.waitForFunction(() => typeof window.__xrsPrintLayout === 'string' &&
    !document.querySelector('#editor > .export-only-editor'));
  await assertNoPrintPreview(page);
  assert.equal(await page.locator('#editor > .ProseMirror').isVisible(), true);
  return page.locator('#test-print-layout');
}

export async function renderCapturedPdf(page, options = {}) {
  await page.evaluate(() => {
    const app = document.querySelector('#app');
    window.__xrsTestApplicationDisplay = app.style.display;
    app.style.display = 'none';
  });
  try {
    return await page.pdf({ preferCSSPageSize: true, printBackground: true, ...options });
  } finally {
    await page.evaluate(() => {
      document.querySelector('#app').style.display = window.__xrsTestApplicationDisplay;
    });
  }
}

export async function removePrintCapture(page) {
  await page.evaluate(() => document.querySelector('#test-print-layout')?.remove());
}
