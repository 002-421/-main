# 0.4.66 FINAL diagnostic candidate (unpublished)

## Confirmed findings

- Laterality did not recognize adjectival `правосторонняя` / `левосторонняя`; level parsing did not handle slash and shortened forms. These now share normalized levels; the mapped ReviewEngine regression requires both side and level warnings, as comments.
- ReviewEngine dedup previously collapsed different explanations on the same span. It now retains distinct clinical warnings. The old global ConsistencyEngine invocation was also producing false level comparisons between unrelated or negative clauses. ReviewEngine uses the entity-matching clinical consistency engine; the legacy class remains available for compatibility.
- Explicit spinal canal denial vs stenosis and general hernia denial vs extrusion now have conservative rules with named-level exclusions and uncertainty exclusions. These are bounded rules, not a general clinical reasoner.
- A reflexive participle followed by an instrumental/genitive complement was treated as a noun modifier. The uncertain replacement is suppressed; regressions include the owner's antelisthesis, stenosis and edema examples.
- A block image nested in a paragraph reproduces `Invalid content for node paragraph` with the actual ProseMirror schema. Import can split known block children out of legacy paragraphs, retaining text, marks, media and ordering, only into a previewed separate copy. Unknown structures remain refused. The real `attachDoctorStamp` export helper creates exactly this incompatible nesting; a regression reproduces the failure with its output, without Word editing. The user's failed original file is still unavailable for matching that individual document.
- Word run wrappers (hyperlinks, content controls, tracked insertions) formerly lost their text in the edited Word parser. Runs are retained and existing import warnings remain. Deleted tracked text is not reintroduced.

## White-screen status

The intermittent user white screen has not been reproduced or attributed to GPU or AI. XRS uses a vanilla TypeScript/Tiptap UI, not React, so a React Error Boundary is not applicable.

The bootstrap now installs critical exception/rejection protection before editor initialization: an emergency screen suspends workspace writes and offers local diagnostic folder access; no automatic renderer reload is introduced. Logs retain event, version, timestamp, safe error type and numeric stack locations, never error message/document fragments. Existing renderer crash/unresponsive diagnostics remain, crash after ready also shows a native warning. Window minimize/restore/resize events are logged. Startup logs rotate at ~1 MB with at most ten retained startup files.

The real Electron stress test minimizes/restores/resizes 15 times, switches/edits four reports, injects an exception, verifies save suspension, restarts, kills the actual renderer, and restarts again to compare persisted documents. It checks that a private sentinel is absent from logs. This is bounded synthetic stress, not a proof of long-duration Windows 11 reliability or persistence of edits that have not yet reached autosave.

No silent reset of a corrupt workspace is introduced. An unrecoverable document remains refused; original files are never overwritten. Arbitrary unsupported Word drawing/embedded object fidelity is not promised. Word transformations in automated tests are OOXML transformations, not an installed Microsoft Word session.

## Acceptance and release

Existing dictionary IPC, dictionary restart/removal, 650 ms automatic checks and six categories are retained. Additional browser acceptance checks all six categories, negative controls, clinical contradictions, displayed decorations/cards, and absence of medical auto-replacement. Existing DOCX/PDF, history, backup and tab tests remain required by Windows validation.

No updater, installer, release workflow, templates, profile format, version bump beyond 0.4.66, tag, merge or Stable publication is included. Final report records the exact tested commit, CI run and unpublished artifact.
