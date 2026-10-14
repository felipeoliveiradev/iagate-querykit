# Release process

The `main` branch exists and is the default publish branch.

## Secrets the owner must add

In the GitHub repository (Settings → Secrets and variables → Actions):

1. **`NPM_TOKEN`** — an npm automation token with permission to publish `iagate-querykit`.
   Required by the publish job (`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`).
   Until this secret exists, CI checks still run; publish will fail at `npm publish`.

Provenance uses OIDC (`id-token: write`). The npm package must have trusted publishing configured **or** the classic `NPM_TOKEN` flow. This workflow supports the token flow with `--provenance`.

## What CI does

Workflow: `.github/workflows/ci.yml`

| Event | Jobs |
| --- | --- |
| Pull request | `secrets` (gitleaks on full history) + `check` — secret-scan, typecheck, tests (SQLite always; Postgres/MySQL via service containers), build |
| Push to `main` | `secrets`, `check`, then `publish` |
| GitHub Release published | `secrets`, `check`, then `publish` |

`publish`:

1. Waits for `check`.
2. Uses concurrency group `npm-publish` so two events cannot publish at once.
3. Runs `npm run secret-scan` again after the build (and `prepublishOnly` runs it once more).
4. Reads `version` from `package.json`.
5. Runs `npm view iagate-querykit@version version`. If that version is already on the registry, the job **skips**.
6. Otherwise `npm publish --provenance --access public`. `NODE_AUTH_TOKEN` comes only from `${{ secrets.NPM_TOKEN }}` and is never echoed.

See `SECURITY.md` for the leaked-secret audit. `.gitleaks.toml` allowlists only the invented throwaway `querykit` / `QueryKit_*` strings.

This repository does **not** publish from a developer laptop. `make publish` is a reminder only.

## Cutting a release

1. Land the PR on `main`.
2. Bump `version` in `package.json` (already done in the PR that contains the change) and update `CHANGELOG.md`.
3. Either:
   - merge to `main` (auto-publish after checks), or
   - create a GitHub Release whose tag matches the version (also triggers publish).
4. Confirm on https://www.npmjs.com/package/iagate-querykit.

Do not run `npm publish` from a cloud agent or a local checkout unless you are the package owner and intend to publish.
