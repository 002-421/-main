# XRS 0.4.88: candidate and acceptance boundaries

Base: exact xrs-v0.4.87 / 658b96d19472e7cd87857c655b9dae96bf86383d.
Stable publication, merges, production catalog publication, changes to Secrets,
Environments and branch protection require separate owner authorization.

## Confirmed publication defect

Real read-only GitHub inspection found five empty drafts for
xrs-templates-v1.0.0: 460700726, 460705617, 460705986, 460707589,
460709077. All belong to operation 1ad3540f-ac67-417d-9286-d8031c15e490.
The tag route returns 404 for these drafts while GET release by ID succeeds.
The 0.4.87 upload and reconciliation paths used the tag route. Retries created
more drafts, and the IPC error wrapper hid the HTTP error as
ADMIN_OPERATION_FAILED. These existing drafts have not been deleted or changed.

The candidate locates the matching operation's oldest draft, uploads by its ID,
checks exact size/digest of both assets, activates only after integrity checks,
and verifies the public manifest/archive/latest pointer before success. An
ambiguous failure retains the original operation for reconciliation. It never
overwrites published assets or claims a queued/draft release is published.
Diagnostics contain only allowlisted stage/code/status/request/operation IDs.
Tokens remain in the main process and Windows DPAPI. One existing administrative
session permits preview and explicit confirmation, with expiry and owner checks.

The existing 0.4.87 HTTPS-origin + SHA-256 trust protocol is retained. This task
adds no signing keys and does not silently claim schema-3 catalogs have Ed25519
signatures. Legacy signed-catalog validation remains supported and tested.

## Highlight lifecycle

The 0.4.88 specification explicitly makes manually applied yellow functional.
New manual yellow uses the existing templateField/templateSize/paragraph model;
legacy manual yellow is migrated without changing visible text or native IDs.
Comparisons use each field's own text, not mapped adjacent paragraph ranges or
an outdated hint. Loading, selection and whole-document restoration do not
complete fields. Editing one range does not clear adjacent pending ranges.
Other fill colors retain normal formatting. Undo/Redo is a single edit event.

## Reset and recovery

Three actions reset standard-template local overrides/Drafts, preferences only,
or both. Personal template IDs, protocols, profile identities, signatures,
PIN, encrypted OAuth, installed catalog and existing backups are excluded.
An immutable checksummed backup is created before an in-app confirmation.
A durable journal and two-process acknowledgement permit rollback after
interruption. Restoring creates another backup. Publication/reset concurrency
and changed-Draft checks fail closed. Backup files remain local to userData.

The editor's existing cold-load normalization can populate templateOriginal on
an artificial document lacking it. The UI regression compares exact document
JSON before/after each reset and compares normalized JSON only after restart.

## UI

Default dark theme; the administration document and source/diff previews use
light paper and dark readable text without modifying document/export data.
The extra AI Review tools popup and bottom boundary warning are removed;
offline analysis, six categories, section model and contextual findings remain.
Catalog errors distinguish 404, network, authentication, throttling, server,
format and integrity failures. Installed version and publication metadata remain
separate from application version.

## Acceptance

The Windows validation workflow builds an internal exact installation package
and automatically tests published 0.4.87 -> candidate 0.4.88 with the existing
updater. It uploads diagnostics, not a user RC distribution. Synthetic GitHub
HTTPS integration runs real Electron, IPC and stores with two clients, but it
is not proof of real owner OAuth upload/public download. Real public catalog
publication and installation must be demonstrated before declaring READY.
No installed-owner OAuth token is available in the development environment;
development integration access is not evidence of that token's scopes.

Run npm ci, npm run build, npm test and the dedicated Windows workflow. See
workflow step results for actual Windows evidence; SKIP is never PASS.
