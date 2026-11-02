# Developer-key security review — 2026-11-01

This is a focused design and implementation review of the algorithms and APIs used by the installer. It is not an independent audit or a claim to have found every flaw in every encryption algorithm.

## Protection goals

The public installer can verify who issued a developer file without possessing the signing secret. The encrypted file hides developer details until its separate password is supplied. Knowing a file password does not permit issuing or changing valid files. The owner signing identity is encrypted at rest for the current Windows account and can be exported to a separately password-encrypted recovery backup.

## Reviewed failure modes and choices

| Component | Failure modes considered | Implementation |
|---|---|---|
| AES-256-GCM | Reusing a key/nonce pair; accepting plaintext before tag verification; short tags; altered headers | Fresh 32-byte salt and 12-byte nonce per file; 16-byte tag; authenticated header; no plaintext reaches callers until `decipher.final()` succeeds. |
| Ed25519 | Private-key exposure; accepting modified records; side-channel-prone handwritten arithmetic; using signatures in another protocol | Node's cryptography implementation; pinned Ed25519 public key; exact encrypted-box bytes signed; separate signature domains for licenses and owner backups. |
| scrypt | Guessable passwords; insufficient work factor; attacker-controlled cost parameters causing resource exhaustion | Fixed N=131072, r=8, p=1; 256 MiB implementation limit; random 256-bit password generator; minimum 16 characters for manually chosen passwords. Parameters cannot be negotiated by a file. |
| Windows DPAPI | Plaintext private-key files; accidentally using machine-wide scope; losing access after an account/OS change | `CurrentUser` scope; matching public key checked before migration; protect/decrypt round trip before atomic replacement; portable encrypted backup and restore tools. |
| File parsing | Oversized data, malformed base64, unsupported algorithms, format downgrade, backup-as-license substitution | 16 KiB envelope limit; canonical base64url and exact field checks; signature verified before password derivation; fixed algorithms and purposes; old plaintext licenses rejected. |
| App integration | Unbounded parallel password work; passwords in shell arguments, logs or jobs; accidental plaintext exports | One GUI key operation at a time; async scrypt; secret input through IPC or hidden prompt/stdin; DPAPI helper uses stdin; no password added to build descriptors. |

GCM nonce uniqueness is a security requirement, not an optional optimization. Fresh salts derive independently keyed files, and fresh 96-bit nonces avoid relying on a shared counter across installations. This design follows the authenticated-mode and key-separation guidance in [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) and the nonce requirements in [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final).

The scrypt cost matches an OWASP-listed 128 MiB configuration. Argon2id is another appropriate password-hardening option; scrypt is used here through Node's established built-in API without introducing another native crypto dependency. A long but predictable password can still be guessed offline. Use Generate and transmit each password separately from its file. See [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

CBC and CTR alone do not authenticate messages; ECB reveals structure. Neither is accepted by this format. ChaCha20-Poly1305 is an authenticated alternative with its own nonce-use requirements, but adding algorithm negotiation is unnecessary for this application. No handwritten block cipher, signature arithmetic, or password KDF is used.

Ed25519's deterministic signing avoids per-message random-nonce failures, but secrecy of its private key and side-channel-resistant implementation still matter. The app uses the runtime API rather than the RFC's illustrative arithmetic. See [RFC 8032 §8](https://www.rfc-editor.org/rfc/rfc8032.html#section-8).

Upstream [OpenSSL advisories](https://openssl-library.org/news/vulnerabilities/index.html) were checked, including CVE-2025-15467 involving CMS AuthEnvelopedData parsing. This application does not parse CMS or PKCS#12 license files; it uses direct AES-GCM operations over bounded JSON. That distinction does not establish that a runtime is free of other vulnerabilities. CLI tests use Node 24.19.0/OpenSSL 3.5.7; Electron 45.2.1 reports Node 24.22.1 and OpenSSL `0.0.0`, so the CLI's OpenSSL version must not be treated as Electron's patch status. Keep both runtimes updated.

DPAPI's protection is supplied by Windows and bound to the user context. It is not a password chosen by this application. See [Microsoft ProtectedData](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata?view=windowsdesktop-9.0). The public additional-entropy string supplies application context; it is not a secret embedded decryption key.

## File formats and secret handling

An encrypted v2 file contains an encoded ciphertext box and an Ed25519 signature. The authenticated header exposes only format/purpose, algorithm identifiers, fixed scrypt cost, salt and nonce. Developer name, revision and dates are encrypted. Base64url is transport encoding, not encryption.

Default GUI filenames contain an opaque random identifier. Filenames themselves are not encrypted; avoid adding private names to a filename if those should remain hidden.

The signing key remains at `%USERPROFILE%\.spider-donut-owner\issuer-private.pem` for path compatibility, but its contents are a DPAPI encrypted JSON container. Migration preserves its Ed25519 identity and creates no plaintext temporary backup. An encrypted `.spiderbackup` uses a distinct signed purpose and a separate owner-only password. Recovery refuses to overwrite an existing issuer and validates the original public identity.

Derived key buffers and transient plaintext buffers are cleared where practical. JavaScript strings, garbage collection, OS paging, crash dumps and a hostile process can prevent guaranteed memory erasure; this implementation makes no such guarantee.

## Limits that encryption cannot remove

- Anyone with a developer file and its password can copy or use that file. It is not bound to one device.
- Expiry uses the local clock; there is no trusted online clock or online revocation service.
- Code executing as the owner, administrators, or malware in that session may access or use the signing key. DPAPI does not protect against a compromised logged-in owner account.
- Someone controlling their computer can modify a local installer to bypass checks. Public GitHub development source remains public. These files are not DRM or server-side authorization.
- Old distributed installers cannot be made to reject old keys remotely. Version 1.1 requires newly issued encrypted files.
- Losing both Windows account access and the recovery backup/password loses the signing identity. Export a private recovery backup before moving accounts or reinstalling Windows.

Tests cover encryption round trips, wrong passwords, randomized salts/nonces, ciphertext/tag/header tampering, forged issuer signatures, unreasonable KDF parameters, legacy-format rejection, purpose separation, expiration and scope enforcement, Windows migration, corrupted DPAPI storage, and encrypted backup recovery. The GUI is tested against actual file issuance/unlocking and backup export. These tests are evidence for the exercised behavior, not proof against all cryptographic or platform attacks.
