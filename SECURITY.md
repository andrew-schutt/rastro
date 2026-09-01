# Security Policy

## Supported versions

Rastro is **pre-alpha**. Only the latest published version of each package receives fixes;
there are no backports. Packages: `rastro-core`, `rastro-react`, `rastro-analysis`.

## Reporting a vulnerability

**Please do not open a public issue.** For this project a public report is itself the
disclosure, and the most likely finding is one that leaks user data — see below.

Use GitHub's private vulnerability reporting: the **Security** tab of
[andrew-schutt/rastro](https://github.com/andrew-schutt/rastro/security) → **Report a
vulnerability**. It opens a private thread visible only to the maintainers.

Include what you'd want to receive: affected package and version, what you observed, and the
smallest reproduction you have. A failing test against `packages/core/src/redact.ts` or a
minimal React tree is ideal.

Expect an acknowledgement within a week. Given one maintainer and pre-alpha status, that is a
best effort, not an SLA.

## What counts as a vulnerability here

Rastro is a browser SDK that runs inside other people's applications and captures interaction
telemetry. Its security surface is mostly **data escaping that should not have**, which is
unusual enough to be worth naming explicitly. In scope:

- **A redaction or tokenization bypass** — user content reaching an emitted event. The privacy
  requirements in [`docs/SEMANTIC-CONVENTIONS.md`](docs/SEMANTIC-CONVENTIONS.md) are MUST-level:
  `url.path` must be tokenized, `ux.accessible_name` must be redacted, and the default capture
  level is metadata, not content. A way to defeat any of those is a vulnerability, not a bug.
- **Capture reaching content it should never touch** — input values, password fields, or text
  from elements the capture path is supposed to ignore.
- **An escape from the reserved-attribute guard**, letting application `track()` props
  overwrite the Required attribute set.
- Anything in the collector allowing cross-project data access, or injection through an
  ingested event into storage or the dashboard.

Known and already documented, so **not** a report — see the "known holes" section of
[`docs/NOTES.md`](docs/NOTES.md):

- Numeric `track()` props are not redacted (`{ userId: 84213 }`); the allow/deny model is
  planned.
- `tokenizePath` recognizes identifier *shapes*, so it cannot catch `/users/johndoe`.
- The collector's CORS is wide open and there is no project key. It is not yet meant to face
  the public internet.

A finding that makes one of these materially worse than documented is still worth reporting.

## Deploying the collector

`apps/collector` is a development server. It has no authentication, no rate limiting, and
permissive CORS. Do not expose it to the internet without putting your own authentication and
network controls in front of it.
