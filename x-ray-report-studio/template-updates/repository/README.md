# XRS medical template catalog

Development infrastructure for independent, signed medical template updates.
**Not enabled in production XRS. No signed Stable catalog has been published.**

Sources are sanitized snapshots of the already bundled XRS 0.4.83 catalog. They
retain permanent template IDs, service-field IDs, formatting and the existing
structural editable-highlight contract. The original XRS catalogs are unchanged.
Patient reports, doctor profiles, stamp images and signing keys do not belong here.

## Local preparation

Install Node.js 24, download/clone this repository, then run `npm ci --ignore-scripts`.
On Windows open `Start-Template-Admin.cmd`, then open the local address it prints.
Select a template, edit text, review the comparison and field list, enter the
medical approval reference, and download an unsigned `.xrsproposal`.
No JSON editing, checksum calculation or GitHub token is required in the tool.

This initial editor preserves existing formatting and treats native fields and
measurements as protected. Remapping native fields and full Word roundtrip are not implemented yet.
A new template/group can be cloned through the local UI; existing source IDs stay
untouched. Several prepared proposals can be published in one catalog workflow
by supplying their filenames separated by commas. An arbitrary
DOCX must not be treated as a publishable package. Unresolved Track Changes and
ambiguous XRS fields remain blockers in the existing XRS importer.

## Publication — currently blocked pending provisioning and acceptance

`validate-templates.yml` checks JSON Schema, canonical data, identifiers, field
contracts, original source hashes, known reference images and proposal structure.
Automatic checks cannot prove medical correctness or absence of every form of
personal data. A medical editor must approve each change.

`publish-catalog.yml` is initially disabled by the absent
`TEMPLATE_PUBLICATION_PROVISIONED=true` repository variable. It additionally requires
protected `catalog-test` / `catalog-stable` Environments, an authorized reviewer,
a trusted public root and a channel-specific signing secret. Do not remove these
gates to get a successful run.

After provisioning and acceptance, upload an approved proposal into `incoming/`
through a reviewed PR, run the publication workflow on `main`, select the channel,
and have the authorized editor approve the Environment deployment. The workflow
signs data, creates an immutable tag, prepares a draft GitHub Release, verifies
uploaded digests, makes it public and verifies downloaded hashes. It never changes
an existing tag. Test Releases are prereleases and never become the latest Stable.

The local tool authenticates the current published channel before editing when a
public trust root is provisioned. The publisher independently restores the signed
current catalog and rejects stale proposals. Without a public root the tool can
only prepare draft baseline proposals; it cannot publish them.

No app release may claim this full workflow ready until a prepared change has been
published through the protected workflow and installed in two independent XRS
instances. Test content must stay in the isolated test channel.

See [Provisioning](PROVISIONING.md), [Security](SECURITY.md), and
[Administrator guide](ADMIN_GUIDE_RU.md).
