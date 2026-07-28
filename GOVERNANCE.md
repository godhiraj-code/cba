# Starlight Governance

Starlight 5.x is currently a maintainer-led alpha project.

## Scope

The normative JSON-RPC/WebSocket specification is language-neutral. This repository ships and supports one reference implementation: JavaScript on maintained Node.js releases.

Adding another implementation language is not part of the 5.x alpha roadmap. A proposal must first demonstrate external demand, an independent maintainer and conformance against the public TCK.

## Protocol changes

A change to protocol methods, schemas, security boundaries or observable behavior must include:

1. Motivation and compatibility impact.
2. Specification and canonical-schema updates.
3. Runtime and TypeScript contract updates.
4. Positive and adversarial tests.
5. Black-box TCK coverage when externally observable.
6. A passing `npm run release:gate`.

Breaking changes require a new wire-protocol major version. Implementation-package versions follow Semantic Versioning independently from the wire version.

## Decision making

The lead maintainer makes final decisions during alpha after public issue or pull-request review. Decisions should optimize for a small, verifiable protocol rather than feature count or implementation-language breadth.

## Security

Do not disclose suspected vulnerabilities in a public issue. Use GitHub private vulnerability reporting or contact the maintainer privately. Security fixes may bypass the normal review period, but must receive regression coverage before release.

## Releases

A release requires:

- Green Node.js 22 and 24 CI.
- A passing release gate from a clean checkout.
- Neutral installation and installed-package E2E proof.
- Zero known production dependency vulnerabilities.
- Honest alpha/stability and deployment-responsibility documentation.

Publishing packages, tags or releases requires explicit maintainer approval.
