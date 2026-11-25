# Trust and recovery model

The package contains only canonical UTF-8 JSON in an uncompressed ZIP_STORED
archive (`package.json`, `template.json`). The signed envelope uses Ed25519 and
SHA-256 key IDs derived from SPKI DER. This format uses sorted JSON object keys,
finite numbers and exact canonical bytes; it does not claim unrestricted RFC 8785
interoperability. Sizes, depth, node count, entry count, central/local ZIP headers,
CRC, paths, duplicate names, signatures and content hashes are checked before use.
No arbitrary extraction, scripts, external images, executable extensions or dynamic
code loading is supported. Only preapproved builtin reference-image hashes pass.

The catalog index authenticates channel, sequence, version, publisher, compatibility,
package URLs, sizes, SHA-256 and actions. Package signatures bind IDs/versions/action
and exact template hash. A higher signed sequence and a new catalog version are
required for new updates; same-version equivocation and replay are rejected.
An explicit rollback does not lower the update high-water mark.

Stable and test keys must be disjoint; a separate root role authorizes sequential
rotation signed by old and new roots. The root verifier is implemented/tested;
production root distribution/revocation is not yet wired and is an enablement
blocker. Current application configuration has no publisher key and cannot install
remote templates. Never replace this with trust-on-first-use.

Threats considered: compromised download/mirror, tampered ZIP/index, stale metadata,
malicious proposal, network interruption, concurrent installation and process exit.
A compromise of a normal Actions job should not expose the root recovery key.
Protected Environments must require a human review of the exact workflow commit,
proposal and medical approval. Actions are pinned; secrets appear only in the
protected signing job and are never accepted from a proposal.

A compromised authorized signer can sign harmful clinical data within its role;
cryptography cannot certify medical correctness. A GitHub owner/admin compromise
can undermine repository protection. Recovery requires the separately controlled
root key, trusted root delivery and, if the trust anchor itself is compromised,
an out-of-band application trust update. Do not claim GitHub controls alone prevent
these compromises. Source-code changes affecting signing must be separately reviewed.

Installations are immutable content-addressed generations with a flushed atomic
state pointer. Previous generations are retained; writes never touch report files
or doctor settings. A 128 MiB quota refuses further installation instead of deleting
required backups. Automatic garbage collection and per-template rollback are not
implemented yet. Power-loss durability still depends on filesystem/OS guarantees;
Windows tests are mandatory before production enablement.

Report a suspected signing compromise privately to the repository owner. Freeze
publication, preserve evidence, revoke the online key through the trusted root
process, publish approved replacement metadata, and verify independent clients.
Never silently reuse a version, overwrite a tag, or disable signature verification.
