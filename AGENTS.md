# platform-kit

The `@rafters/platform-*` packages every brand runs on (rafters, bandz, smugglr, fence), starting with `@rafters/platform-auth`. Each package versions and publishes on its own; each brand runs its own deployment and consumes the packages from npm. A user is one identity across a brand's root domain and its subdomains, and none across brands. Owned by the platform agent.

If you are part of a legion team, orient through legion before reading anything here:

```
legion whoami --repo platform          # who owns this repo
legion whatami --repo platform         # how platform works
legion recall --repo platform-kit      # what platform-kit remembers about the task at hand
legion sym ...                         # code questions: definitions, references
```

The auth intent is legion document 01a10e09-a7e0-7aa0-8906-b39ee392819d (surface platform-auth).

Toolchain: Vite+ (`vp`). Run `vp install` after pulling, and `vp check` and `vp test` before committing.

## Running the tests

The tests build every database with the real migratr CLI, so migratr must be installed at the commit `.github/workflows/ci.yml` pins (`dcc991ff469583458f70f16280926163972e9603`). Without it, a fresh checkout fails dozens of auth tests with `spawnSync ENOENT`. Install it with:

```
cargo install --locked --git https://github.com/rafters-studio/migratr --rev dcc991ff469583458f70f16280926163972e9603 migratr-cli
```

Or point the `MIGRATR` environment variable at a migratr binary you already have. When ci.yml moves the pin, change it here in the same commit.

## Naming a migration

Name a new migration with the real current UTC time to the second, taken when the file is created: `date -u +%Y%m%d%H%M%S`. Never use a round or invented timestamp; two files that share a version are refused by migratr as `duplicate_version`. A shipped migration is never renamed or edited.
