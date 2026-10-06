# platform-kit

The `@rafters/platform-*` packages every brand runs on (rafters, bands, smugglr, fence), starting with `@rafters/platform-auth`. Each package versions and publishes on its own; each brand runs its own deployment and consumes the packages from npm. A user is one identity across a brand's root domain and its subdomains, and none across brands. Owned by the platform agent.

If you are part of a legion team, orient through legion before reading anything here:

```
legion whoami --repo platform          # who owns this repo
legion whatami --repo platform         # how platform works
legion recall --repo platform-kit      # what platform-kit remembers about the task at hand
legion sym ...                         # code questions: definitions, references
```

The auth intent is legion document 01a10e09-a7e0-7aa0-8906-b39ee392819d (surface platform-auth).

Toolchain: Vite+ (`vp`). Run `vp install` after pulling, and `vp check` and `vp test` before committing.
