# Required one-time provisioning

Audit on 2026-11-25: the owner has configured protected `main` and the three
Environments `catalog-test`, `catalog-stable`, `catalog-root-recovery`. Their
required reviewer is `002-421` (ID 210672295), and their deployment policy permits
only `main`. The integration can push feature branches; it still cannot change
Environment configuration. The detailed branch-protection API returns 403, so
required-check settings must be reviewed by the owner before enablement. Do not
weaken existing protection or treat feature-branch CI as publication permission.

No production keys, public root, signing secrets, trusted authorizing service or
provisioning flag have been installed. The following is the remaining controlled
procedure, not a record of completed provisioning. Real key creation requires the
owner's separate agreement to the secure procedure in PUBLISHER_HANDOFF.md.

1. Owner opens https://github.com/002-421/XRS-Templates/settings/environments .
2. Create `catalog-test`, `catalog-stable`, `catalog-root-recovery`.
3. Require review by authorized owner `002-421` (GitHub user ID 210672295).
   With a single authorized reviewer, self-review blocking would prevent owner-run
   deployments; keep explicit human review but do not require a second nonexistent
   account. Add a second qualified editor when available.
4. Restrict deployments to the protected publication branch `main`.
5. Protect `main`: no deletion/force push; require PRs and successful `validate`.
   Do not grant Actions bypass rights. Initial empty-repository bootstrap is a
   normal first commit, not a merge or force push.
6. Use three distinct Ed25519 key pairs: offline/root recovery, Stable signing,
   isolated test signing. Never share a Stable key with test/root roles.
7. Keep private keys only in protected secret storage. The root private key belongs
   to separately reviewed recovery tooling; normal publisher jobs cannot read it.
   Stable/test secrets are named `TEMPLATE_SIGNING_PRIVATE_KEY` in their respective
   Environments. No private key may be written to source, artifacts or XRS settings.
8. Validate and publish the **public** trust root (`trust/root.json`), then embed its
   public keys in XRS. Until this ceremony occurs, the app source configuration must
   remain `enabled:false, root:null`. Never invent a working key or trust an unsigned
   root downloaded at runtime.
9. Implement/test the root-metadata delivery/rotation/revocation path before enablement.
   The shared protocol already verifies sequential root transitions with both old
   and new signature thresholds; the production delivery path is still pending.
10. Set `TEMPLATE_PUBLICATION_PROVISIONED=true` only after verifying Environment
    protection, branch protection, public root, secrets and tests.
11. Perform the isolated synthetic publication/installation test on two XRS
    instances. No synthetic medical content belongs in the working Stable channel.
12. Publish initial Stable metadata (no template changes), and only then release
    the completed app integration through the existing XRS app release workflow.

A missing secret, permission, root, approval or successful acceptance test is a
blocker, not permission to replace the workflow with manual unsigned distribution.
