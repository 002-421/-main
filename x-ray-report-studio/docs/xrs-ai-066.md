# XRS-AI-066 (unpublished 0.4.66 candidate)

Base: Stable 0.4.65, `6f6d4f32278dda4ee7d722ea56446089dcdac621`.

## Confirmed defects and changes

The renderer calls `desktop.dictionaryLoad` / `dictionaryMergeSave`, and main.cjs already handles both IPC channels, but Stable's preload did not expose either method. A real Electron card therefore threw a TypeError and showed the generic save failure. The preload now exposes the existing validated handlers. No updater or installer logic changed.

MedicalTerminologyEngine previously checked a small inflected adjective list and edit distance without consulting QUALITY-02 morphology. Correct noun cases such as «гипофиза» were therefore near-match warnings even when spelling accepted them. The existing exact regeneration logic and curated medical lemmas now live in a shared medical-word-recognition module used by both analyzers. Trusted dictionary parses and medical parses must regenerate the original word; predicted forms require a trusted medical lemma. Curated lemmas are added, not arbitrary suffix exclusions. Clinical findings remain comments and never change meaning.

The context card's selection-only «Проверить» button is removed. Safe replacements, dismissal, dictionary addition and closing remain. Personal terms suppress dictionary findings in both spelling and terminology, and errors report an actionable reason without exposing a profile path. All six automatic categories and the 650 ms debounce remain.

## Validation

- Build, npm test, medical morphology and terminology regressions.
- Browser contextual acceptance, morphology and existing document/history/export regressions in the existing Windows validation workflow.
- `node tests/dictionary-electron.mjs`: copied real Electron runtime with packaged app, real preload and IPC; isolated Cyrillic profile and shared dictionary; existing dictionary migration, card save, exact duplicate/case normalization, two tabs, full Electron restart, local removal tombstone, renewed finding after deletion, damaged-file refusal. No test mocks dictionary IPC or touches a real user's dictionary.
- Existing Windows workflow runs the new acceptance tests and packages an unpublished 0.4.66 Setup candidate with SHA256SUMS.txt. No release workflow is changed.

## Limits

User terms are exact case-insensitive forms, not an automatic approval of every possible inflection. Local dictionary removal uses the existing per-profile tombstone mechanism; the shared vocabulary remains available to other users. Ambiguous clinical/grammar comments require physician judgment. Windows runner confirmation is recorded in the task's final report; Linux execution alone is not Windows verification.

Stable publication requires a separate owner approval. No tag or Stable manifest change is part of this task.
