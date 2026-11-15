# XRS-AI-065 candidate

Base: Stable 0.4.64 (`720bb6578899d641d2655f85d9cdc48bcbdf2bc9`).
Offline core source: QUALITY-02 (`a3ef0e215d527a456c698bae15ccf7c4305c67f3`).
Contextual UI reused from local `codex/xrs-ai-contextual-review-ui` (`bc49b19`).

The six categories are always enabled. Hunspell/nspell and Az/OpenCorpora run
locally with bundled vocabularies. Punctuation and style use limited explicit
rules. Terminology, consistency and clinical logic use existing deterministic
analyzers; findings are warnings for a physician, not a medical validation.
Spelling guesses and changes with possible medical meaning remain comments.
No background download, cloud provider or AI network request is used.

Review runs on initial opening and 650 ms after the final edit. Prior analyses
are cancelled, and generation, report ID and document snapshot must all match
before results appear. An edit immediately removes stale decorations. Tab
changes clear the previous document's marks; each tab keeps its own rejection
keys for unchanged findings for this application session. Rejections are not
stored inside reports or persisted across application restarts.

Decorations live only in ProseMirror plugin state, outside document JSON.
Overlapping ranges share one card. Hover, click and keyboard activation are
supported; the card follows scrolling and window resizing. Safe replacements
validate the current block, source range and active tab, preserve text marks,
use one editor transaction and move the caret to the end of the correction.
Undo/Redo remain available. Ranges crossing paragraph/cell boundaries require
manual editing; exact spans inside table cells are supported.

The editable personal dictionary is separate from trusted built-in forms.
Removed shared terms are suppressed locally using `xrs.dictionary.removed.v1`;
this does not delete another user's shared dictionary. Built-in forms cannot
be removed through personal dictionary settings. QUALITY-02 morphological
validation remains conservative; unknown terms are not proof of pathology.

Only confirmed report sections (description/conclusion) are analyzed. Flat,
ambiguous, reordered, empty or privacy-guard-rejected documents show a local
review-unavailable status rather than silently rewriting their structure.
The existing explicit boundary-migration tool remains available. Analysis is
asynchronous and cancellable on the renderer; it is not an AI worker process.
Very large documents can still produce brief synchronous work in rule engines.

Update UI: progress was inside hidden `#update-main` after confirmation. The
container is now visible during install. Download percentage comes from the
existing IPC event; unmeasured preparation/install stages animate without fake
percentages. Existing error details and manual confirmation are retained.
All updater, installer and release workflow implementations are identical to
Stable 0.4.64. The data-contract allowlist adds 0.4.65 without changing schema.

Validation entry points:
- `npm run build`, `npm test`
- `node tests/ai-review-browser.mjs` (auto review, two tabs, card, dictionary,
  source invalidation, replacement/history and blocked external requests)
- `node tests/update-progress-browser.mjs` (UI with synthetic IPC events)
- existing Electron/DOCX/PDF, history, recovery and tab lifecycle suites
- existing Windows validation workflow on `codex/xrs-ai-065`

Candidate packaging uses `package_setup.py --candidate-output` and the existing
ZIP verifier. This branch does not activate Stable, create release tags or
publish updates. Publication requires the owner's final decision after CI.
