# Security — leaked-secret audit

This document is the secret-leak report for `iagate-querykit`. **No secret values are printed** — only location, type, and a mask.

Scan date: 2026-10-14. Tools: gitleaks 8.24.3, trufflehog 3.88.33, plus a custom pack/docs scanner. Branches scanned: `main`, `cursor/querykit-production-hardening-3f5f`, empty `gh-pages` (init-only). 50 commits / 49 unique via gitleaks `--all`.

## Verdict

**No live credentials, tokens, private keys, or company hosts were found.** Nothing needs rotation. **No git history rewrite** (and none will be force-pushed without owner approval).

## 1. Git history (all branches)

| Scanner | Scope | Result |
| --- | --- | --- |
| gitleaks `detect --log-opts=--all` | 49 commits, ~2.7 MB | **0 leaks** |
| gitleaks `--no-git` working tree | ~37 MB | **0 leaks** |
| gitleaks + trufflehog on `origin/gh-pages` | empty tree (`29815c8 chore: init gh-pages`) | **0 leaks** |
| trufflehog `git file://.` verified+unknown | full local repo | **1 unverified**, not a secret (below) |

Trufflehog unverified hit:

| Item | Value |
| --- | --- |
| Detector | Postgres (unverified) |
| File | `src/__tests__/ephemeral-db-guard.test.ts` |
| Commit | `fbc8a9f` (still present) |
| Type | invented rejection fixture `postgres://…@prod-db.internal/…` used to assert the helper **refuses** remote hosts |
| Classification | throwaway / negative test, not a company DSN |

`recam`: **0** matches in any blob. RFC1918 IPs (`192.168.*`, `10.*`, `172.16.*`) appear **only** in that same guard test as hosts that must be rejected.

Committed `.env` / `*.pem` / `*.key` / `_authToken`: **none ever**. Tracked `.npmrc` is only `legacy-peer-deps=true`.

Commit author domains (counts only): `gmail.com` (public package author) and `cursor.com` (this hardening branch). No company mailbox.

## 2. Published npm (`iagate-querykit`)

Versions on the registry (latest `0.1.46`; **1.0.0 is not published**):

`0.1.0`, `0.1.1`, `0.1.2`, `0.1.3`, `0.1.4`, `0.1.41`, `0.1.42`, `0.1.43`, `0.1.44`, `0.1.45`, `0.1.46`

Every tarball was downloaded and extracted. Sourcemaps, `.env`, `.npmrc`, and fixtures were scanned.

| Check | Result |
| --- | --- |
| `.env` / `.env.*` | **absent** in every version |
| `.npmrc` | **absent** in every version |
| private keys / `npm_` tokens / `AKIA…` / `ghp_` | **absent** |
| Sourcemaps | `.d.ts.map` declaration maps only (no `sourcesContent` secrets). 0.1.0–0.1.42 also shipped `dist/__tests__/*.d.ts.map` (packaging noise, not secrets). |
| README emails | one-letter fixtures (`a@b.com`, `a@x.com`, `c@x.com`) — docs, not people |

No credential rotation is required for anything that was ever published.

## 3. Fixtures, compose, CI, STUDY / AUDIT

| Location | What it looks like | Classification |
| --- | --- | --- |
| `docker-compose.test.yml`, `.github/workflows/ci.yml`, `src/__tests__/integration/ephemeral.ts` | user `querykit` / password `querykit` on `127.0.0.1` | **throwaway**, invented for loopback CI/compose |
| same + MSSQL profile | `sa` / `QueryKit_123` @ `127.0.0.1:1433` | **throwaway** |
| same + Oracle profile | `querykit` / `QueryKit123` @ `127.0.0.1:1521/FREEPDB1` | **throwaway** |
| `src/__tests__/engine-plugins.test.ts`, `dialect-conformance.test.ts` | `password-super-secret`, `super-secret-token` | redaction fixtures (tests assert they do **not** appear in `DriverError`) |
| website docs (`mysql.md` / `oracle.md` / `sqlserver.md` / `postgresql.md`) | `secret`, `tiger`, `Passw0rd!`, `postgres://user:pass@localhost:5432/app` | generic / Scott-Tiger / Microsoft-style placeholders on localhost |
| `package.json` `author` | `felipeoliveiradeveloper@gmail.com` | public npm author, not a secret |
| STUDY / AUDIT | `esm@x.com`, `cjs@x.com`, `nodenext@x.com` | consumer-verify fake rows |

No internal hostnames, no `192.168.*` production targets, no `recam`, no company emails.

## 4. Workflows

`.github/workflows/ci.yml` (only workflow):

- Triggers: `pull_request`, `push` to `main`, `release` published. **No `pull_request_target`.**
- `NPM_TOKEN` is referenced only as `${{ secrets.NPM_TOKEN }}` → `NODE_AUTH_TOKEN`. Never echoed, never written to a file, never passed to `echo` / `printenv`.
- Publish permissions: `contents: read`, `id-token: write` (provenance). Workflow-level default is now `contents: read`.
- Service-container passwords are the same invented `querykit` pair.

## 5. PR body, comments, artifacts

PR [#1](https://github.com/felipeoliveiradev/iagate-querykit/pull/1): **0** issue comments, **0** review comments, **0** reviews, **0** Actions artifacts. Body scan: no tokens, keys, or non-loopback DSNs. Only this one PR exists on the repo.

## 6. Controls added this round

- CI job `secrets` (gitleaks on full history, `contents: read`, no secrets).
- `npm run secret-scan` (`scripts/secret-scan.mjs`) on every `check` job and **before** `npm publish` (`prepublishOnly` + publish step).
- `.gitleaks.toml` allowlists only the documented throwaway strings.

## Rotation / history rewrite

| Credential | Rotate? |
| --- | --- |
| Anything in git history | **No** |
| Anything on npm 0.1.0–0.1.46 | **No** |
| GitHub `NPM_TOKEN` secret | **No leak found.** Still rotate on a normal schedule / if the secret was ever pasted into a chat. |
| Throwaway `querykit` / `QueryKit_*` | **No** — they bind only to disposable loopback containers |

History rewrite plan (listed only; **not executed**):

1. Owner approval required.
2. `git filter-repo` (or BFG) on every ref, including `gh-pages`.
3. Force-push all rewritten refs.
4. Notify forks; revoke any credential that had been in a rewritten blob.

None of that is needed today.
