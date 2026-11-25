# Independent medical template updates — development checkpoint

Base: XRS Stable 0.4.83, commit `49ac5638a2f911030e7687f94901c8c4b585137b`.
Working branch: `codex/xrs-template-updates-084`. The application version remains
0.4.83 in this development checkpoint; no 0.4.84 release is authorized as complete
until the full acceptance criteria pass. Public Stable and app updater are untouched.

## Implemented locally

- Separate repository scaffold, schemas, canonical data-only `.xrszip` protocol,
  Ed25519 index/package verification, key fingerprints, tested dual-authorized
  sequential root transitions, strict ZIP/resource/path/style limits.
- Sanitized baseline of 113 templates; existing clinical source catalogs unchanged.
  All eight Spine v8 IDs and 40 native fields retained. The baseline uses the existing
  audited service-section constructor, not a new AI Review boundary algorithm.
- Independent local catalog generations, explicit install plan/confirmation,
  content-addressed package cache, flushed atomic state replacement, offline reads,
  retained prior catalogs, rollback, monotonic update ledger, conservative storage
  quota. Interrupted processes and concurrent writers are covered by tests.
- Effective catalog integration before workspace load and hot replacement of future
  template sources. Existing reports and local overrides are not rewritten.
  Retired/new template identities remain resolvable across rollback and restart.
- Compact settings entry and catalog manager with change preview, history,
  explicit installation and rollback confirmation, safe error messages.
- Local browser administrator tool: structured text editing, diff, readonly native
  fields/measurements, automatic revision, template/group cloning, medical approval
  reference and validated unsigned proposal download. No JSON/hash editing is needed.
- Independent validation/publishing workflows. Publication requires the protected
  Environment, separately approved medical content, channel-specific signing secret
  and provisioned public trust. Test releases cannot become Stable latest.

## Local verification

- Build and complete existing unit suite passed before the final checkpoint;
  final SHA is checked again by the dedicated Windows workflow.
- All 113 templates pass signed package roundtrip, hash and structural checks.
- Two real isolated Electron instances passed the local HTTPS synthetic test:
  matching catalog data, explicit install, independent sizes, Undo/Redo, isolated
  rollback, unchanged open reports and a saved new-template report after restart.
- All eight Spine templates and 40 fields passed real Electron text/paste/history
  tests. All eight passed DOCX state checks and actual Chromium PDF generation.
- Browser format/fill tests and per-document history/restart tests passed.
- Administrator browser preparation passed without editing JSON or calculating hashes.

The local HTTPS test is NOT the required GitHub publication acceptance. Real Microsoft
Word was not used, and no claim of full Word roundtrip compatibility is made.

## Blockers and remaining work

- GitHub Environment creation returned `403 Resource not accessible by integration`.
  No signing Environment, private key or secret has been provisioned.
- Public root metadata delivery/rotation/revocation still needs production integration
  and end-to-end testing. The root-transition verifier alone does not complete it.
- Application source configuration is intentionally `enabled:false, root:null`.
  Missing trust is a hard blocker, never trust-on-first-use or unsigned installation.
- Full arbitrary DOCX roundtrip / annotation of new paragraph and measurement fields
  is not implemented; ambiguous Word imports remain blocked. Existing fields and
  measurements can be preserved, not guessed from color.
- Per-template rollback and automatic cache garbage collection are not implemented.
  The quota refuses further installs rather than deleting required backups.
- The mandatory protected GitHub publication and installation on two independent XRS
  instances has not been completed. No app release, installer, app tag or Stable
  activation may occur until these blockers and Windows validation are resolved.

Publisher scaffold and owner-facing instructions are under
`template-updates/repository/`; `scripts/stage-template-repository.mjs` prepares a
separate local checkout with the verified sanitized sources and identical protocol.
The initial local template-repository commit is
`431dc1de660d9af842a63c1485f9201206e84769`; its first HTTPS push was denied with 403.
Recovery must follow the connector's repository selection, not a token/push bypass.
