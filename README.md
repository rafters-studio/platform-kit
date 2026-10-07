# platform-kit

The `@rafters/platform-*` packages every brand runs on:

- `@rafters/platform-contracts`: the shared Zod schemas (sender requests, events, brand config) every package depends on.
- `@rafters/platform-sender`: the day-one sender, `emailSender(env.EMAIL)`, delivering each message kind through Cloudflare's `send_email` binding.
- `@rafters/platform-auth`: auth for every brand, as better-auth option objects.

They release together at one version. Each brand runs its own deployment and consumes the packages from npm.

## Development

```bash
vp install        # after pulling
vp check          # format, lint, types
vp test           # tests
pnpm run build    # build every package
```

## Releasing

CI runs on every pull request and merge-queue entry. `release status` shows the version; `release patch|minor|major` prepares a release branch, and `release finish <x.y.z>` pushes the tag. A pushed `v*` tag runs `.github/workflows/release.yml`, which publishes through npm trusted publishing with provenance.

A brand-new package is published once by hand before its trusted publisher can be registered; see the `@rafters/release` README, "A brand-new package".
