# XRS 0.4.72 — Offline Review Hotfix candidate

Base: 1849fc9757bea6abfbec206c7a9e9fc113521b99 (0.4.71).

The decoration plugin no longer intercepts Space/Enter or caches the last focused underline. Clicking a finding explicitly opens its card; typing never does. Edits invalidate the reviewed snapshot. Spell cards offer an explicit replacement input, subject to existing clinical replacement guards, and preserve range validation and editor history. Clinical comments never become replacements.

Categories can be selected independently in a small local menu. The checker still runs automatically with the existing debounce. Detail text is collapsible and cards have bounded height. IDs are deterministic SHA-256 values of the finding, range and explanation; unchanged reanalysis retains the same identity.

Rules: morphological synovitis laterality; unique-focus brain location; explicit contrast/ventricular negations; consolidated explicit multilevel stenosis vs global denial; normalized slash/dash/Cyrillic spine levels and ranges; low-confidence extrusion/prolapse clarification on the same level. Joined-word candidates are offered only when both parts are dictionary-recognized and the split is unique. Original misspellings are excluded from candidates; dictionaries are never extended automatically.

Conservative limitations: this is a finite local rule set, not exhaustive medical understanding. Ambiguous multiple findings and bilateral statements are skipped rather than assigned an invented side. No universal numeric stenosis threshold is used. Word/PDF, updater, backups, profile data schema and templates are unchanged. XRS_AI_Review_Anatomy_Rules_Head.docx was not found locally and was not reviewed.

Manual acceptance after an authorized release: open a synthetic report; type Space within «суженсправа»; verify no popup and Undo/Redo; open a spelling card and replace only its selected range; compare synovitis sides and a unique focus in different brain lobes; verify one multilevel stenosis warning and no warning for «на остальных уровнях»; switch two tabs; toggle the six categories and restart; inspect DOCX/PDF for absence of review decorations.
