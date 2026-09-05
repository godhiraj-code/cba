# Contributing to Starlight

Read the [objective](docs/OBJECTIVE.md), [agent guide](docs/AGENTS.md), and
[governance](GOVERNANCE.md) before changing the platform boundary.

## Development

Use Node.js 22 or 24 and npm:

```bash
npm ci
npm test
npm run demo:walkthrough
```

`src/platform` owns missions; `src/core` owns coordination and transport. Agent-specific tools
and models belong in agent modules. Keep secrets and generated data outside version control.
The package.json `files` allowlist defines the published surface.

Add regression tests for observable failures and concurrency boundaries. Verify that assertions
cover the requirement rather than merely agreeing with the implementation. Update declarations,
documentation, the audit, and examples for public API changes. Wire changes also follow the
schema/specification/TCK requirements in governance.

## Release verification

```bash
npm run release:gate
```

This runs all tests, lint, TypeScript consumer checks, schema alignment, 19 black-box protocol
checks, an authenticated multi-process proof, all walkthrough scenarios, the website build,
neutral installed-package demo/inspection, and a
production and development dependency audit. Packaging checks both CLI shims in a temporary path containing
spaces and rejects legacy/test/build material. Registry access is needed for installation/audit.
Caches are isolated or stored in ignored `.npm-cache/`.

GitHub Actions runs the gate on Linux with Node.js 22 and 24 and verifies that checks do not
dirty the repository. The audit records the actual local environment separately; a local pass
does not substitute for that CI matrix.

See [the demo guide](docs/DEMO.md) for optional media generation. Python, Pillow, and FFmpeg are
media-authoring tools, not npm runtime dependencies.

See [website publishing](docs/WEBSITE.md) for previewing and deploying the public site. The Pages
workflow must verify the actual public URL and asset hashes after deployment. A green build alone
does not establish that the homepage or video is available.

Publishing to npm, tagging releases, and changing deployments require explicit maintainer
authorization. A GitHub push does not publish the npm package.
