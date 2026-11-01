# Preview Builds and Deployment

No deployments, Cloudflare Access changes, or DNS changes may proceed without Josh's yes.

## Seed local KV from fixture

Seed a local preview KV namespace from the synthetic fixture. This fixture data is for local previews only and must never be written to production KV.

```sh
export WRANGLER_CACHE_DIR=/tmp/wrcache
npx wrangler kv key put feeds --binding FEEDS_KV --local --path tests/fixtures/preview-feeds.json
```

## Preview build

Build the preview bundle from the repository root:

```sh
npx opennextjs-cloudflare build
```

## Deploy preview

After a successful build, upload the preview version:

```sh
wrangler versions upload
```

Use the preview URL returned by Wrangler to inspect the uploaded build.

## Cloudflare Access

Cloudflare Access must run in front of the preview deployment. Enabling or changing the Access application requires Josh's yes.

## Proposed five-minute KV export cron

This is a proposal only; the cron is not installed.

```cron
*/5 * * * * npx tsx scripts/kv-export.ts
```

The proposed schedule runs the KV export every 5 minutes.

## Proposed Mac push with launchd

This is a proposal only; the launchd job is not installed.

The Mac push would use launchd to pull and push the preview repository from the Mac.
