# API-key cutover

This is the API-key contract for the existing D1 `api_keys` table. No schema
change is required.

## Hashing and presentation

- Generate 32 cryptographically random bytes with the Worker Web Crypto API.
- Encode the bytes as unpadded base64url and issue the token as
  `gf_live_<43-character-payload>`.
- Store `key_prefix` as the first 16 characters of the complete token
  (`gf_live_` plus the first 8 payload characters). Never store the token.
- Compute `key_hash` as SHA-256 over the exact UTF-8 bytes of the complete
  token, represented as 64 lowercase hexadecimal characters. This is
  intentionally unsalted: the current table has no salt or algorithm column,
  and authentication must reproduce the same deterministic value.
- Accept only `Authorization: Bearer <token>` for API-key authentication.
  Hash the supplied token exactly as received after removing the Bearer
  scheme and one separator; do not trim, normalize, or hash the prefix alone.
  Look up `key_hash` with `revoked_at IS NULL`, and update `last_used_at` only
  after successful authorization. Do not log tokens or hashes.

## Issuance

Authenticate the issuing actor through the existing owner/admin boundary and
require the target `project_id`. Generate the token once, calculate its hash,
then insert:

```sql
INSERT INTO api_keys
  (id, project_id, key_prefix, key_hash, label, created_at)
VALUES
  (?, ?, ?, ?, ?, datetime('now'));
```

Return the complete token once over TLS; return only `id`, `project_id`,
`key_prefix`, `label`, and `created_at` thereafter. Treat a duplicate
`key_hash` as an issuance failure and retry with a newly generated token.

## Revocation

Revoke by authorized `id` and project, never by accepting or storing the
plaintext token:

```sql
UPDATE api_keys
SET revoked_at = COALESCE(revoked_at, datetime('now'))
WHERE id = ? AND project_id = ?;
```

Authentication must reject every row with a non-null `revoked_at`. Revocation
is idempotent; retain the row for auditability and do not delete it. A
successful revocation should also create the normal project audit event.

## Migration and cutover

1. Inventory `api_keys` by `id`, `project_id`, `key_prefix`, `key_hash`, and
   `revoked_at` without exporting secret material. Confirm every active row
   has a unique 64-character lowercase-hex SHA-256 hash and a non-empty
   prefix.
2. If an existing active row contains plaintext, a different hash format, or
   an unknown hash provenance, do not attempt an in-place conversion: the
   plaintext cannot be safely recovered or verified from this schema. Mark it
   revoked with `datetime('now')`, issue a replacement token, and deliver the
   replacement through the existing secure channel.
3. Deploy authentication that uses the exact hashing and `revoked_at IS NULL`
   lookup above. During rollout, accept only the new `gf_live_` format; do not
   maintain a plaintext or alternate-hash fallback.
4. Update clients to send the replacement token as a Bearer token, verify
   project scoping, then revoke the superseded key. Confirm no active legacy
   rows remain and retain all revoked rows for audit.
