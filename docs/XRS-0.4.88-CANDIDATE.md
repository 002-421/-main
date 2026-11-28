# XRS 0.4.88 consolidated candidate

Base application: exact Stable xrs-v0.4.87,
658b96d19472e7cd87857c655b9dae96bf86383d. This candidate continues the reviewed
0.4.88 work; the owner's final consolidated specification replaces earlier
0.4.88 requirements. Application Stable publication is not authorized.

## Official catalog bootstrap

The owner authorized publishing only the complete unchanged 113-template
Stable 0.4.87 catalog as 1.0.0 (55 MRI, 58 CT, including the eight Spine v8
and forty native Spine fields). Its canonical source content SHA-256 is
c2980b1d19661fcb0a738d74ccbe1b7dad4265e6293fa02710051a070ed8c3e2.
The independent operation is b063498e-1094-415b-8d19-fef5345d35a9. No user
workstation, local override, experimental Draft or old request is used.

The owner separately authorized retiring only the unpublished tag reservation
2a42d1d53f765b467554ae95063f2cf422c03485. The five existing empty draft
releases remain unchanged, and old operation
1ad3540f-ac67-417d-9286-d8031c15e490 is never resumed. Bootstrap workflow and
fixed source/request/artifact hashes live in XRS-Templates. Before official
publication, an isolated synthetic prerelease must exercise real GitHub
binary assets and two instances of the production downloader without changing
the production latest pointer. Publication requires successful full Windows
validation of this exact candidate. Physical owner-computer testing is deferred
until that unavailable computer returns; isolated tests are labeled explicitly.

## GitHub recovery and authorization

Real XRS OAuth previously confirmed owner 002-421, scope public_repo, all five
drafts accessible by ID with HTTP200, and their tag route returning HTTP404.
The publisher now uses draft IDs, finds matching operations, checks both asset
hashes/sizes and activates only after verification. Retry preserves the original
new operation. Only a zero-byte starter asset on an owned, reserved draft may
be removed for upload retry. Published/unknown data are never overwritten.
Safe diagnostics include phase/code/status/request/operation IDs, not tokens.

The administrative PIN has been removed from UI, preload, IPC and TemplateAdmin.
Each privileged access uses the existing main-process GitHub owner/permission
check. Renderer handles are bound to their originating webContents; they do not
contain credentials. Revoked access fails closed. Valid DPAPI-persisted OAuth
needs no repeated login or PIN. Legacy PIN files are ignored and retained.

The same operation journal uses a new oauth-pending.json pointer for new
OAuth-authorized operations. The old pending.json and its request files are
never resumed, rewritten or deleted. Old incomplete history is read-only and
marked LEGACY_NOT_RESUMABLE. This keeps the unavailable owner's experiment
intact and permits an explicit local template reset after application update.

The owner-approved existing 0.4.87 HTTPS-origin + SHA-256 catalog protocol is
preserved. No new signing keys or authorization server is introduced.

## Editor and UI

Existing paste/typography/first-indent corrections remain. Manual and system
yellow share the structural templateField/templateSize/paragraph lifecycle;
only changes to a range's own text complete it. Selection, focus, restoration,
other text and formatting do not complete pending ranges. Existing native IDs
remain intact. Legacy yellow migration preserves formatting and Unicode; long
ranges stay within the existing field-hint limit. Template finalization rearms
edited paragraph identities with valid matching marks for new template use.

The existing zoom slider retains minimum75 and step5; its maximum is200.
Actual long-document Electron tests cover100/150/175/200, cursor, selection,
scrolling, Undo/Redo and cold restart. Screen zoom never changes document data
or export. Export comparison keeps the pre-existing print optimization setting
fixed; optimized print copies are separate from editor font size.

Theme selection lives only in Settings: Light, Dark and AMOLED. Dark is the
fallback/default; valid saved themes survive migration. AMOLED has real #000
shell surfaces, readable menus/controls, and shared white document paper.
Theme choices persist after restart and do not alter DOCX/PDF document data.

The extra AI Review popup and bottom boundary warning are removed. Six offline
categories, medical section boundaries and contextual findings remain; Electron
regression exercises the categories in all three themes.

## Reset and recovery

Three explicit actions reset standard-template overrides/Drafts, preferences
only, or both. Documents, personal template IDs, profiles, signatures, OAuth,
the installed catalog and prior backups are excluded. A unique checksummed
backup precedes confirmation. A durable journal and main/renderer acknowledgement
permit rollback after interrupted application. Restore creates another backup.
Legacy publication files and PIN files are retained. No automatic reset occurs
when installing/updating XRS. A newly pending OAuth publication blocks conflicting
resets; the superseded legacy pointer does not block them.

## Acceptance boundaries

The Windows workflow performs npm ci, build/type checks, full tests, actual
Electron/clipboard/DOCX/PDF, all113 source checks, eight Spine/40fields, three
themes and zoom, reset/recovery, real DPAPI with synthetic OAuth responses, and
an internal exact ZIP installation/update test from published0.4.87. No user RC
installer is published. Real GitHub catalog bootstrap is a separate explicit
workflow with real Device Flow and anonymous production downloads. Mock tests,
real GitHub tests and unavailable physical-computer/Word checks are reported
separately. No merge or application Stable release is performed.
