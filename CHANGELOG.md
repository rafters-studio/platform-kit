# platform-kit

## Unreleased

- `@rafters/platform-contracts`: the shared Zod schemas every platform package agrees on. A sender request (email or text recipient, one of five message kinds with its own data) and the `Sender` interface; the thin event envelope (UUIDv7 id, brand, subject, time; change events name the record and changed fields, never values; sign-in-failed events carry a subject or a hashed address); and the brand config with every default filled, validated by `parseBrandConfig`, which names every failing path. (#27)

## 0.1.0

The package shell: `@rafters/platform-auth` with its `./shared`, `./server`, and `./client` subpath exports, empty until the brand config and `authOptions` land. CI runs on every pull request and merge-queue entry, and a pushed `v*` tag publishes through npm trusted publishing.
