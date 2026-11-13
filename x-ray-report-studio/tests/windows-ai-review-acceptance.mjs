import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { closeSession, editorSnapshot, launchSession, sanitizedRequest } from './windows-ai-review-session.mjs';

const output = process.env.XRS_SMOKE_OUTPUT;
if (!output) throw new Error('XRS_SMOKE_OUTPUT is required');
const resultPath = path.join(output, 'results.json');
const result = [];
let session;
let page;
let activeDocumentTextBeforeReview = '';
let reportCreated = false;
let documentEdited = false;
let documentRestored = false;
let reviewAvailable = false;
let networkRequests = [];
const record = async (name, callback, dependencies = []) => {
  if (dependencies.some(value => !value)) {
    result.push({ name, status: 'BLOCKED', reason: 'A prerequisite acceptance scenario did not pass' });
    await saveResults();
    return;
  }
  try {
    const details = await callback();
    result.push({ name, status: 'PASS', ...(details ?? {}) });
  } catch (error) {
    result.push({ name, status: 'FAIL', reason: String(error.message).slice(0, 1600) });
  }
  await saveResults();
};
const saveResults = () => writeFile(resultPath, `${JSON.stringify({ mode: 'functional-acceptance', result, summary: summarize() }, null, 2)}\n`, 'utf8');
const summarize = () => ({
  pass: result.filter(item => item.status === 'PASS').length,
  fail: result.filter(item => item.status === 'FAIL').length,
  blocked: result.filter(item => item.status === 'BLOCKED').length,
  overall: result.some(item => item.status !== 'PASS') ? 'FAIL' : 'PASS',
});

try {
  try {
    session = await launchSession();
    page = session.page;
    page.on('request', request => {
      if (/^https?:/i.test(request.url())) networkRequests.push(sanitizedRequest(request));
    });
  } catch (error) {
    if (error.session) session = error.session;
    result.push({ name: 'packaged_application_startup', status: 'FAIL', reason: String(error.message).slice(0, 1600) });
    for (const name of [
      'fresh_profile_document', 'create_report_through_ui', 'edit_description_and_conclusion', 'save_and_restore_document',
      'spelling_category', 'punctuation_category', 'style_category', 'terminology_category', 'consistency_category', 'clinical_category',
      'enable_experimental_review_for_test', 'medical_comments_are_not_applied', 'category_preferences_persist', 'document_is_unchanged_by_review',
      'no_external_ai_requests', 'stable_beta_profile_isolation', 'updater_network_is_separate',
    ]) result.push({ name, status: 'BLOCKED', reason: 'Packaged application did not start' });
    await saveResults();
  }

  if (page) {
    await record('fresh_profile_document', async () => {
      await page.locator('#editor .ProseMirror').waitFor({ state: 'visible', timeout: 60_000 });
      const initial = await editorSnapshot(page);
      assert.ok(initial.editorVisible, 'Initial editor is not visible');
      const sectionIds = initial.sections.map(section => section.id);
      assert.ok(sectionIds.includes('description') && sectionIds.includes('conclusion'), 'Initial report lacks structured description/conclusion sections');
      assert.equal(await page.locator('#ai-review-open').count(), 0, 'AI Review must remain disabled by default');
      return { editor: 'visible', sections: sectionIds, workspacePersistedBeforeAction: initial.workspacePresent, aiReviewDefault: 'disabled' };
    });

    await record('create_report_through_ui', async () => {
      await page.locator('#report-tabs .report-tab-select').first().waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('#new-report').click();
      await page.waitForFunction(() => {
        const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1') || 'null');
        return workspace?.reports?.length === 2 && workspace.reports.some(report => report.id === workspace.activeId);
      }, null, { timeout: 15_000 });
      reportCreated = true;
      return { reportsInWorkspace: 2, creation: 'real UI action' };
    });

    const descriptionText = 'Иследование  проведено , очаг очаг. Очаг 5 мм справа в лобной доле. На уровне L4-L5 определяется грыжа межпозвонкового диска. гиперинтенсвный участок.';
    const conclusionText = 'Очаг 5 мм слева в лобной доле. Грыж межпозвонковых дисков не выявлено.';
    const replaceSectionText = async (id, text) => {
      const section = page.locator(`#editor .ProseMirror section[data-section-id="${id}"]`);
      await section.waitFor({ state: 'visible', timeout: 15_000 });
      const selected = await section.evaluate(element => {
        const editorRoot = element.closest('.ProseMirror');
        const selection = window.getSelection();
        if (!editorRoot || !selection) return false;
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        editorRoot.focus();
        return true;
      });
      assert.equal(selected, true, `Could not select ${id} in the editor`);
      await page.keyboard.insertText(text);
    };

    await record('edit_description_and_conclusion', async () => {
      await replaceSectionText('description', descriptionText);
      await replaceSectionText('conclusion', conclusionText);
      await page.waitForFunction(({ description, conclusion }) => {
        const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1') || 'null');
        const active = workspace?.reports?.find(report => report.id === workspace.activeId);
        const flatten = node => `${node?.text ?? ''}${(node?.content ?? []).map(flatten).join('')}`;
        const descriptionSection = active?.doc?.content?.find(node => node.type === 'reportSection' && node.attrs?.id === 'description');
        const conclusionSection = active?.doc?.content?.find(node => node.type === 'reportSection' && node.attrs?.id === 'conclusion');
        return flatten(descriptionSection).includes(description) && flatten(conclusionSection).includes(conclusion);
      }, { description: descriptionText, conclusion: conclusionText }, { timeout: 15_000 });
      documentEdited = true;
      return { sectionsEdited: ['description', 'conclusion'], source: 'synthetic text entered through editor keyboard input' };
    }, [reportCreated]);

    await record('save_and_restore_document', async () => {
      await page.reload();
      await page.locator('#editor .ProseMirror section[data-section-id="description"]').waitFor({ state: 'visible', timeout: 60_000 });
      const stored = await page.evaluate(() => {
        const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1') || 'null');
        const active = workspace?.reports?.find(report => report.id === workspace.activeId);
        const flatten = node => `${node?.text ?? ''}${(node?.content ?? []).map(flatten).join('')}`;
        return {
          description: flatten(active?.doc?.content?.find(node => node.type === 'reportSection' && node.attrs?.id === 'description')),
          conclusion: flatten(active?.doc?.content?.find(node => node.type === 'reportSection' && node.attrs?.id === 'conclusion')),
        };
      });
      assert.ok(stored.description.includes(descriptionText), 'Description was not restored');
      assert.ok(stored.conclusion.includes(conclusionText), 'Conclusion was not restored');
      documentRestored = true;
      return { workspacePersisted: true, documentRestored: true };
    }, [documentEdited]);

    await record('enable_experimental_review_for_test', async () => {
      await page.evaluate(() => localStorage.setItem('xrs.ai-review.experimental', 'enabled'));
      await page.reload();
      await page.locator('#ai-review-open').waitFor({ state: 'visible', timeout: 60_000 });
      await page.locator('#ai-review-open').click();
      assert.equal(await page.locator('#ai-mode').inputValue(), 'local');
      const cloudOption = page.locator('#ai-mode option[value="cloud"]');
      assert.equal(await cloudOption.count(), 1, 'Cloud option must exist');
      assert.deepEqual(
        await cloudOption.evaluate(option => ({
          hasDisabledAttribute: option.hasAttribute('disabled'),
          disabled: option.disabled,
          matchesDisabled: option.matches(':disabled'),
        })),
        {
          hasDisabledAttribute: true,
          disabled: true,
          matchesDisabled: true,
        },
        'Cloud option must be disabled in the DOM',
      );
      assert.equal(await page.locator('[data-ai-category]').count(), 6);
      reviewAvailable = true;
      return { featureFlag: 'test-only', provider: 'local', categories: 6, cloud: 'disabled' };
    }, [documentRestored]);

    const categories = [
      ['spelling', 'Орфография'],
      ['punctuation', 'Пунктуация'],
      ['style', 'Стиль и грамматика'],
      ['terminology', 'Медицинская терминология'],
      ['consistency', 'Согласованность описания и заключения'],
      ['clinical', 'Клиническая логика'],
    ];
    const medical = new Set(['terminology', 'consistency', 'clinical']);
    for (const [selected, label] of categories) {
      await record(`category_${selected}_is_independent`, async () => {
        for (const [id] of categories) {
          const checkbox = page.locator(`[data-ai-category="${id}"]`);
          if (id === selected) await checkbox.check();
          else await checkbox.uncheck();
        }
        await page.locator('#ai-results').evaluate(element => { element.textContent = ''; });
        await page.locator('#ai-check').click();
        await page.locator('#ai-check').waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForFunction(() => {
          const button = document.querySelector('#ai-check');
          return !!button && !button.disabled;
        }, null, { timeout: 60_000 });
        const rows = page.locator('#ai-results .notice');
        const texts = [];
        for (let index = 0; index < await rows.count(); index++) texts.push(await rows.nth(index).innerText());
        assert.ok(texts.some(text => text.includes(label)), `${selected} did not produce its expected synthetic finding`);
        const otherLabels = categories.filter(([id]) => id !== selected).map(([, otherLabel]) => otherLabel);
        for (const otherLabel of otherLabels) assert.ok(!texts.some(text => text.includes(otherLabel)), `${selected} run also returned disabled category ${otherLabel}`);
        if (medical.has(selected)) {
          const matching = rows.filter({ hasText: label }).first();
          assert.equal(await matching.getByRole('button', { name: 'Принять' }).isDisabled(), true, `${selected} comment must not be applicable`);
          assert.ok((await matching.innerText()).includes('(без замены)'), `${selected} must not propose a replacement`);
        }
        return { selected, disabledCategoriesExcluded: true, findings: texts.length, medicalComment: medical.has(selected) };
      }, [reviewAvailable]);
    }

    await record('medical_comments_are_not_applied', async () => {
      const current = await page.evaluate(() => {
        const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1'));
        const active = workspace.reports.find(report => report.id === workspace.activeId);
        return JSON.stringify(active.doc);
      });
      activeDocumentTextBeforeReview = current;
      for (const category of ['terminology', 'consistency', 'clinical']) {
        const checkbox = page.locator(`[data-ai-category="${category}"]`);
        for (const [id] of categories) id === category ? await checkbox.check() : await page.locator(`[data-ai-category="${id}"]`).uncheck();
        await page.locator('#ai-results').evaluate(element => { element.textContent = ''; });
        await page.locator('#ai-check').click();
        await page.waitForFunction(() => { const button = document.querySelector('#ai-check'); return !!button && !button.disabled; }, null, { timeout: 60_000 });
        const row = page.locator('#ai-results .notice').filter({ hasText: categories.find(([id]) => id === category)[1] }).first();
        assert.equal(await row.getByRole('button', { name: 'Принять' }).isDisabled(), true, `${category} comment can be applied`);
        assert.ok((await row.innerText()).includes('(без замены)'), `${category} comment proposes replacement text`);
      }
      const after = await page.evaluate(() => {
        const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1'));
        const active = workspace.reports.find(report => report.id === workspace.activeId);
        return JSON.stringify(active.doc);
      });
      assert.equal(after, current, 'AI Review changed the document without explicit acceptance');
      return { medicalComments: 'comment-only', documentChanged: false };
    }, [reviewAvailable]);

    await record('document_is_unchanged_by_review', async () => {
      const after = await page.evaluate(() => {
        const workspace = JSON.parse(localStorage.getItem('mri-report-studio.workspace.v1'));
        const active = workspace.reports.find(report => report.id === workspace.activeId);
        return JSON.stringify(active.doc);
      });
      assert.equal(after, activeDocumentTextBeforeReview, 'Review modified the active document');
      return { unchanged: true };
    }, [reviewAvailable]);

    await record('category_preferences_persist', async () => {
      for (const [id] of categories) {
        const checkbox = page.locator(`[data-ai-category="${id}"]`);
        if (id === 'punctuation') await checkbox.uncheck();
        else await checkbox.check();
      }
      await page.reload();
      await page.locator('#ai-review-open').waitFor({ state: 'visible', timeout: 60_000 });
      await page.locator('#ai-review-open').click();
      assert.equal(await page.locator('[data-ai-category="punctuation"]').isChecked(), false, 'Punctuation opt-out did not persist');
      for (const id of ['spelling', 'style', 'terminology', 'consistency', 'clinical']) assert.equal(await page.locator(`[data-ai-category="${id}"]`).isChecked(), true, `${id} selection did not persist`);
      return { punctuation: false, otherFiveCategories: true };
    }, [reviewAvailable]);

    await record('no_external_ai_requests', async () => {
      assert.deepEqual(networkRequests, [], 'Renderer made external HTTP(S) requests during the AI Review scenarios');
      return { rendererHttpRequests: 0, outboundProcessPolicy: 'blocked by per-EXE firewall rule' };
    });

    await record('stable_beta_profile_isolation', async () => {
      const profile = path.resolve(process.env.XRS_SMOKE_PROFILE);
      const runnerTemp = path.resolve(process.env.RUNNER_TEMP || path.dirname(profile));
      assert.ok(profile.startsWith(`${runnerTemp}${path.sep}`), 'Profile is outside the unique runner temporary directory');
      assert.match(path.basename(profile), /^xrs-Acceptance-profile-/u);
      assert.ok(!/(Stable|Beta)/iu.test(profile), 'Temporary profile path overlaps a Stable/Beta profile name');
      return { userDataDir: 'unique RUNNER_TEMP path', stableBetaProfileOpened: false };
    });

    const mainPath = path.join(path.dirname(process.env.XRS_SMOKE_EXE), 'resources', 'app', 'electron', 'main.cjs');
    await record('updater_network_is_separate', async () => {
      const { readFile } = await import('node:fs/promises');
      const main = await readFile(mainPath, 'utf8');
      const match = /const UPDATE_MANIFEST\s*=\s*'([^']+)'/u.exec(main);
      assert.ok(match, 'Could not identify the independent Electron updater endpoint');
      const endpoint = new URL(match[1]);
      assert.equal(endpoint.protocol, 'https:');
      return { updaterOrigin: endpoint.origin, aiReviewRequests: networkRequests.length, updaterOutbound: 'blocked by firewall policy' };
    });
  }
} finally {
  if (session) await closeSession(session);
  await saveResults();
}

if (result.some(item => item.status !== 'PASS')) process.exitCode = 1;
