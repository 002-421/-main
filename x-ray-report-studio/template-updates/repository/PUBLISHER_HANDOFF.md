# Protected publisher handoff — owner decision required

This document describes a reviewable procedure. It does not provision a service,
generate working keys, grant permissions, enable a channel or publish a catalog.

## Changes ready for review

The feature branch adds schema-2 revision history and records the authenticated
GitHub Environment reviewer. Merge requires a separately approved PR, successful
`validate` and the existing protected-branch checks. No protection bypass is used.
The application can prepare a PIN-protected local Draft and export its unsigned
proposal. A PIN or proposal-supplied medical reference is not remote authority.

## Keys and trust ceremony (not yet authorized)

1. Owner chooses the key custodian, isolated machine/hardware and recovery holders.
   Generate three distinct Ed25519 keys: offline root, online test, online Stable.
   Do not generate them on a doctor's computer or in a normal CI job.
2. Retain the root private key offline under the custodian's recovery policy. Store
   test and Stable private keys only as Environment-scoped signing secrets. Review
   the exact protected workflow SHA before permitting a job to use those secrets.
3. Review/publish public root metadata and embed that trust anchor in XRS. Implement
   authenticated sequential root delivery and test expiry, rotation and online-key
   revocation before enabling downloads. Never use trust-on-first-use.
4. Keep the provisioning flag false until all gates and end-to-end tests pass.
   Use only synthetic content and the test key for the first publication.

## Trusted service for publishing from XRS

Owner must select an HTTPS service host, identity provider and authorized medical
editor identities. Suggested contract: OIDC Authorization Code with PKCE in the
system browser, state/nonce validation and short-lived, audience-bound access
credentials. The service validates issuer, subject, audience, expiry, replay
protection and server-side editor membership; it never trusts the PIN or a role
claim supplied by XRS. Long-lived personal GitHub tokens are forbidden in XRS.

The service revalidates canonical proposal size/schema/base hash, stable field IDs,
medical approval reference and privacy checks. Bind approval to the proposal hash,
channel and base revision, with an idempotency key. Use a narrowly installed GitHub
App and short-lived installation credentials only on the service to submit a PR
and dispatch the existing main-only publisher. Retain the owner Environment review
until an explicitly approved protection model replaces it. Do not bypass main,
required checks, Environment review or catalog signing. Surface `awaiting review`,
`published`, or the safe failure code and run URL to XRS; do not report publication
when merely queued. Never overwrite a release/tag/previous revision.

A separate review must specify service persistence/encryption, audit retention,
allowed identities, incident response, credential revocation and exact least
GitHub permissions. No service has been deployed by this branch.

## Acceptance before production

Publish one synthetic proposal to the protected test channel, without Codex as an
operator. On two isolated XRS installations confirm the same signed Active index,
Archived selection without PIN, unchanged old reports, independent rollback,
revoked revision denial, offline cache and cold restart. Complete Windows CI and
actual Word exchange validation. Verify production root delivery/revocation. Only
then request separate permission to enable and release XRS Stable.
