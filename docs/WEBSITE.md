# Website publishing and verification

The public address is [starlight-protocol.github.io/starlight](https://starlight-protocol.github.io/starlight/).
Source lives in `website/`. `npm run site:build` creates the static site in `dist/site/`, copying
only an explicit list of page files and final demo assets. No framework or extra runtime dependency
is required. The public page describes the general-purpose platform and links directly to the
current GitHub documentation. Its report explorer displays captured runs and does not execute agents.

## Publishing contract

GitHub Pages uses **GitHub Actions**, not a branch folder. The
[Pages workflow](../.github/workflows/pages.yml) builds and validates a static artifact on pull
requests and main. On main, it deploys that artifact, then verifies the actual public URL.
The repository's Pages setting must have `build_type: workflow`.

The build requires an index, checks local assets and anchor targets, checks source documentation
links, validates the six recorded reports and chapter duration, and writes `build-info.json`.
The deployment record includes the source commit and SHA-256 hashes of the published files.

CI serves the artifact at a project subpath before uploading it. After deployment, the checker
requires the public root to return HTTP 200 and the expected title. It then compares the live
commit, MIME types, sizes, and file hashes against the build. Bounded retries allow CDN propagation;
a persistent 404, stale version, wrong media type, or damaged file fails the workflow.

## Local preview

```bash
npm run site:build
npm run site:preview
# In a second terminal:
node scripts/check-site.js http://127.0.0.1:4173/starlight/
```

Open `http://127.0.0.1:4173/starlight/`. The preview supports byte ranges for video seeking.
Reload after rebuilding. Check the six scenario buttons,
full report disclosure, chapter seeking, video playback and captions, navigation, and mobile layout.
The browser needs no API key or running agent backend.

## What caused the September 2026 outage

Pages was still configured to publish `main:/docs`. Refactoring removed the old homepage, leaving
Markdown guides in that folder but no root index. GitHub successfully built and deployed that
folder, so the workflow was green while the public root returned 404. The previous audit reported
that workflow success without testing the actual public URL. Local Markdown link checks could not
catch a missing Pages entry point or unavailable public video.

The fix establishes an explicit publishing artifact and a separate live verification step.
Regression tests exercise a good deployment, missing homepage, stale commit, corrupt asset,
and wrong media type through an HTTP server at the `/starlight/` subpath.
