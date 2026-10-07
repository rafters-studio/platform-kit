# platform-kit

## Unreleased

- `@rafters/platform-auth`: `authOptions(brand, env)` from `/server` returns better-auth options built from a brand config, validated by `@rafters/platform-contracts` before anything is built, with UUIDv7 ids. `clientPlugins(brand)` from `/client` returns the matching client plugins. With `ledger: true`, the brand passes the ledger module as a third argument and the options add ledger's plugin with user soft delete; a brand with ledger off never loads `@rafters/ledger`, an optional peer dependency. (#4)
- `@rafters/platform-contracts`: the shared Zod schemas every platform package agrees on. A sender request (email or text recipient, one of five message kinds with its own data) and the `Sender` interface; the thin event envelope (UUIDv7 id, brand, subject, time; change events name the record and changed fields, never values; sign-in-failed events carry a subject or a hashed address); and the brand config with every default filled, validated by `parseBrandConfig`, which names every failing path. (#27)

## 0.1.0

The package shell: `@rafters/platform-auth` with its `./shared`, `./server`, and `./client` subpath exports, empty until the brand config and `authOptions` land. CI runs on every pull request and merge-queue entry, and a pushed `v*` tag publishes through npm trusted publishing.
