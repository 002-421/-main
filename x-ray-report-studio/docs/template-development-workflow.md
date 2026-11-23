# XRS template development workflow

## Current template integration

- The integration candidate starts from Stable tag `xrs-v0.4.81`, commit `7790d69771d3534349a4fa549ba85e185a15e59f`.
- The template integration is isolated in `codex/xrs-spine-v8-integration-082`; it does not merge the historical Spine Review branch.
- The next working branch for template development is `codex/xrs-template-development`, published from Stable 0.4.82, commit `45cf40c792526ba6469372fd39da32d8e96a3aae`. Subsequent groups must start from the then-current compatible Stable.
- Approved source: `XRS_Spine_Templates_0.4.77_Review_v8.zip`, SHA-256 `9378885380ee793a79aa9c525201f3e6ee59e8524d13161cc1193a12b6f90d25`. Use files under `Редакция_DOCX/` as the approved medical text; `Оригиналы_XRS_0.4.77/` are comparison references only. The source archive is not duplicated in this repository.

## Integrated templates

The approved catalog entries are `spine-shop`, `spine-shop-m`, `spine-shop-art`, `spine-gop`, `spine-gop-m`, `spine-pop`, `spine-pop-m`, and `spine-kkop`. Their original five `templateField` IDs are retained (40 IDs total). The other 105 built-in MRI/CT templates are fingerprinted against Stable 0.4.81 in `tests/fixtures/spine-review-v8-integrity.json`.

Medical wording is imported only from approved source paragraphs before the system-managed physician signature. Keep the application's existing header, physician stamp, footer, field behavior, export, and pagination mechanisms.

## Yellow editable ranges

Use [editable-highlights-v1.md](editable-highlights-v1.md) as the single contract for every medical group. Paragraph completion and individual pending measurements are independent system states. Manual fill is independent. Convert authored legacy yellow only when creating a template instance, never by examining colors in a restored patient report. Preserve source medical text, native field IDs and manual formatting. Do not create group-specific editor handlers.

## Required invariants

- Do not change approved medical language without clinician approval.
- Do not change template IDs, the 40 retained field IDs, template versioning, or the other 105 templates as part of this group.
- Do not import old editor, pagination, AI Review, profile, updater, or export code from historical template branches. Start each integration from the then-current Stable and port only approved catalog data plus separately justified, minimal technical fixes and tests.
- Do not alter patient documents or profile data.
- Keep Word `w:ins` / `w:del` changes resolved before import; the verifier rejects unresolved tracked changes.
- Keep the XRS-managed header, doctor stamp, date, and footer; do not copy those blocks from source DOCX.

## Reproducible checks

From `x-ray-report-studio/`:

```sh
npm run build
npm test
npm run test:spine-review-v8
ELECTRON_PATH="$PWD/node_modules/electron/dist/electron" npm run test:browser
node scripts/verify-spine-review-v8.mjs /path/to/XRS_Spine_Templates_0.4.77_Review_v8.zip
git diff --check
```

Windows CI, Windows packaging, and Microsoft Word must be reported separately. A Linux/LibreOffice test is not evidence of Microsoft Word compatibility or Windows process behavior.

## Future template groups and Stable synchronization

1. Obtain approved medical DOCX and record its exact archive hash.
2. Begin from the current verified Stable commit in a fresh integration worktree.
3. Map every source document to existing template IDs and field IDs; stop on ambiguity, unresolved tracked changes, or conflicting source hashes.
4. Port only that approved template group. Add a source fingerprint and checks proving unrelated catalog entries are unchanged.
5. Run structural verification, unit tests, Electron/browser coverage, DOCX/PDF checks, and full Windows CI. Compare against the current Stable behavior.
6. Complete manual acceptance before release. Keep separate groups as separate logical commits.
7. After Stable changes, rebase only by recreating the integration candidate from new Stable and reapplying the approved template-only delta. Never merge an old template branch wholesale.

The separate GPT_XRS-Шаблоны chat is a collaboration context, not a Git branch and is not automatically synchronized. Copy the handoff summary from the task report into that chat when continuing work.

## Standard package for a new group

Export from current XRS to DOCX, edit and approve in Word, resolve tracked changes, then run structural inspection. Keep the source DOCX, automatic source SHA-256, template revision, structure manifest, change report and test report together. Run the safe inspection prototype and catalog comparison before integrating. Stop on ambiguous field mapping or unsupported Word structure; never manually guess IDs. Supported imports need explicit preview acceptance, verified backup and rollback. Templates are revised independently of the application; patient reports are never rewritten. A full arbitrary-Word converter is a separate implementation stage documented in the contract.
