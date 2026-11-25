# Template updates and editor corrections — acceptance candidate

XRS package version remains **0.4.83**. Development branches are
`codex/xrs-template-updates-084` and `XRS-Templates/codex/template-admin-revisions-084`.
This candidate is not a Stable release. The application source remains disabled
without a public trust anchor. No real signing key, channel or updater was changed.

## Implemented candidate behavior

- Reuses existing signed `.xrszip` protocol, transport, content-addressed catalog
  generations, atomic activation, quota, rollback and structural highlight model.
- External clipboard text inherits document/paragraph typography and paragraph
  layout. Internal functional-field copies retain the established parser. The
  current font selector resolves inline/paragraph inheritance and mixed values;
  12 → 11 pt applies on the first action. A first-line-indent menu writes paragraph
  attributes (0 / 1 / 1.25 / 1.5 cm), with Undo/Redo and persistence.
- Schema-2 signed indexes bind Active/Archived/Revoked revisions and approval
  metadata. Existing history is immutable; revocation survives local rollback.
  Each doctor can select a cached Archived revision for a new report without PIN.
  New reports record source identity/version; existing reports are not rewritten.
- XRS has a separate local authoring surface behind a salted-scrypt PIN, persisted
  throttling, renderer-bound 15-minute sessions and safe audit events. It uses
  library templates, not patient reports. Source hashes/native fields are checked.
  DOCX import blocks unresolved OOXML revisions/conflicts, supports explicit manual
  section/field/measurement mapping and exports medically confirmed local Drafts.
  Empty editor caret paragraphs are removed only outside service sections; actual
  medical text there blocks preparation instead of being discarded.
- Publisher branch builds signed schema-2 indexes and takes the approver identity
  from the protected GitHub Environment review, not from proposal input.

## Local evidence

`npm run build` passes. Full `npm test`: **365 tests / 360 pass / 0 fail / 5 Linux
skips for Windows-only scenarios**. Dedicated tests cover all 113 trusted source
hashes and 567 native-field identities, strict DOCX/OOXML rejection, PIN lifetime
and throttling, archive/revocation integrity, paste styles, font units and indents.

Actual Electron scenarios passed: clipboard style inheritance; first-action font
change; indent, Undo/Redo and cold restart; real DOCX and Chromium PDF creation;
isolated administrative authoring and Draft export with five spine-pop fields;
two isolated clients receiving signed revisions over local HTTPS, Active/Archived
choice, unchanged open reports, independent rollback and cold restart.
All eight Spine v8 editing/history scenarios passed. Existing history regression
passed. Browser formatting and all eight Spine DOCX/PDF export regressions passed
with unchanged editor state. The Windows workflow also runs the full suite and
the dedicated scenarios.
CI results and remaining browser regression results are reported separately for
the exact committed SHA; this document does not claim a future run passed.

Standalone publisher tests: **5 pass**, including the signed revision-index builder
and restoration of a remotely added template through signed addition history.
The staged 113-source repository and browser proposal preparation also pass;
these tests are not a real GitHub publication.

## Blocking acceptance items

1. No trusted HTTPS publishing service/identity provider is deployed; publication
   from XRS is fail-closed. The local PIN does not confer remote publishing rights.
2. No real keys have been generated (owner agreement is required). Public root,
   protected signing secrets and provisioning flag are not installed.
3. Authenticated production root delivery/rotation/revocation remains unwired.
4. The protected publisher changes require a separately approved merge. None was
   performed. No restrictions, keys, tokens or GitHub permissions were bypassed.
5. A production operator flow for revoking a previously published revision is not
   complete, although client-side signed revocation and rollback protection work.
6. Publication without Codex through GitHub, followed by receipt on two clients,
   has not happened. The successful local HTTPS test must not be substituted for it.
7. Real Microsoft Word roundtrip/Track Changes validation has not been performed;
   tests use synthetic OOXML and clipboard HTML fixtures.

Review `template-updates/repository/PUBLISHER_HANDOFF.md` for the proposed secure
key/service procedure. Choose custodians, service host, identity provider and
editor identities, approve the protected PR and key ceremony, then run isolated
publication acceptance. Stable requires all acceptance criteria and a separate
owner release permission. Keep Stable 0.4.83 unchanged until then.
