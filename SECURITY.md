# Security Policy

Coastal.AI runs agents with shell, filesystem, and (optionally) network
access on your own hardware. We take reports about anything that weakens
that trust boundary seriously.

## Reporting a Vulnerability

Please report security issues privately rather than opening a public
GitHub issue — a public issue for an unpatched vulnerability gives
attackers a head start against every install that hasn't updated yet.

Use **[GitHub Security Advisories](https://github.com/CoastalCrypto/Coastal.AI/security/advisories/new)**
for this repository to open a private report. Include:

- The affected version/commit.
- Steps to reproduce, or a minimal proof of concept.
- The impact as you see it (what an attacker gains, and what they need
  to already have to get there — e.g. network access to the host, a
  logged-in session, an `operator`-role account).

We'll acknowledge new reports within 5 business days and aim to ship a fix
or mitigation within 90 days of confirming the issue, sooner for anything
critical. We'll credit reporters in the release notes unless you'd rather
stay anonymous.

## Scope

In scope:

- `packages/*` — the shared engine (API auth, the agent loop, tool
  execution/sandboxing, the A2A coordination protocol, memory/notes
  substrate).
- `apps/desktop` — the Tauri desktop shell and its sidecar bundling.
- `os/*` — the CoastalOS kiosk/node images and their systemd units.
- The install scripts (`install.sh`, `install.ps1`, `install-windows.ps1`)
  and the packaging/release pipelines under `.github/workflows/`.

Out of scope / won't generally be treated as a vulnerability on their own:

- An agent doing something harmful *after* you've explicitly granted it
  `trusted` or `autonomous` trust level, or `admin`-role access — both are
  documented as "same access as you" / "no approval gates." Issues where
  the *gate itself* can be bypassed without that grant are in scope.
- Behavior of a model you've pointed Coastal.AI at (hallucination, unsafe
  tool-call suggestions a human or the permission gate then approves).
- Denial of service against your own locally-running instance that
  requires no more access than you'd already have to misuse it anyway
  (e.g. "the Architect's build gate is slow if you give it a huge diff").

## Currently tracked, already-public hardening work

So a report doesn't duplicate something already underway: as of this
writing, known gaps being worked through incrementally (see the git
history for `fix(core)`/`fix(coordination)` commits) include the A2A TCP
transport's lack of transport-level encryption (signatures protect
integrity/authenticity, not confidentiality, today), and a backlog of
transitive-dependency advisories surfaced by the CI audit job
(`.github/workflows/ci.yml`) that aren't yet all remediated — that job is
currently informational rather than a merge-blocking gate for exactly that
reason, see its inline comment.

## Supported Versions

This project ships from `master` rather than maintaining parallel release
branches. Security fixes land on `master` and the next tagged release
(`desktop-v*` / `os-v*` / the `.deb`/apt lane); there is no backport policy
for older tags.
