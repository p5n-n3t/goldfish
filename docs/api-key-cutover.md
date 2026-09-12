# API-key cutover

Goldfish has isolated project keys and one separate workspace key for the
owner's local coding-agent fleet. Both authorize agent REST, MCP, and GraphQL
access. The private dashboard is the owner-facing surface that issues and
revokes project keys; the dashboard password and its cookie are never
substitutes for an agent key.

## Hashing and presentation

- Generate 32 cryptographically random bytes with the Worker Web Crypto API.
- Encode the bytes as unpadded base64url and issue the token as
  `gf_live_<43-character-payload>`.
- Store `key_prefix` as the first 16 characters of the complete token
  (`gf_live_` plus the first 8 payload characters). Never store the token.
- Compute `key_hash` as SHA-256 over the exact UTF-8 bytes of the complete
  token, represented as 64 lowercase hexadecimal characters. This is
  deterministic because authentication must reproduce it.
- Accept only `Authorization: Bearer <token>` for project-key authentication.
  Hash the supplied token exactly after removing the Bearer scheme and one
  separator; do not trim, normalize, or hash the prefix alone.
- Look up `key_hash` with `revoked_at IS NULL`, and update `last_used_at` only
  after successful authorization. Do not log tokens or hashes.

## Dashboard issuance

The signed-in dashboard administrator selects a project and opens **API keys**. Issuing a key returns the complete token exactly once over TLS,
along with its ID, project, prefix, and label. The dashboard later lists only
non-secret metadata such as label, prefix, creation time, last use, and
revocation state.

Copy the token directly into the target agent’s approved credential store or
`GOLDFISH_API_KEY` environment variable. Do not put it in a repository, global
workflow file, prompt, screenshot, terminal transcript, or task log.

Bootstrap routes using `ADMIN_BOOTSTRAP_SECRET` are available for managed
provisioning, but the same token rules apply. `ADMIN_BOOTSTRAP_SECRET` must
never be supplied to an agent client.

## Revocation

The dashboard revokes by key ID and project, never by accepting or storing the
plaintext token:

```sql
UPDATE api_keys
SET revoked_at = COALESCE(revoked_at, datetime('now'))
WHERE id = ? AND project_id = ?;
```

Authentication rejects every row with a non-null `revoked_at`. Revocation is
idempotent; Goldfish retains the row and audit event for traceability instead of
deleting it. After revocation, remove the key from the client credential store.

## Rotation and migration

1. Inventory `api_keys` by `id`, `project_id`, `key_prefix`, `key_hash`, and
   `revoked_at` without exporting secret material.
2. If an active row has unknown hash provenance or a nonconforming hash format,
   revoke it and issue a replacement. Plaintext cannot safely be reconstructed
   from a hash-only schema.
3. Move the client to the replacement project key, verify the intended project
   scope, then revoke the superseded key.
4. Retain revoked rows for audit and do not add a plaintext or legacy-token
   fallback.
