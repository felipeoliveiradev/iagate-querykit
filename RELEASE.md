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
| Push to `main` | `secrets`, `check`, then `publish` (npm + GitHub Release `vX.Y.Z`) |

`publish` (`scripts/publish-if-new.sh`):

1. Waits for `check` and `secrets`.
2. Uses concurrency group `npm-publish` so two events cannot publish at once.
3. Runs `npm run secret-scan` again after the build (and `prepublishOnly` runs it once more).
4. Reads `name` / `version` with single-quoted `node -p` (nested `node -e "..."` quotes break in YAML).
5. Requires `package.json` `repository.url` = `git+https://github.com/felipeoliveiradev/iagate-querykit.git` (empty/mismatch → npm provenance **E422**).
6. Requires a `## <version>` section in `CHANGELOG.md`.
7. Runs `npm view iagate-querykit@version version`. If that version is already on the registry, the job **skips** npm publish.
8. Otherwise `npm publish --provenance --access public`. `NODE_AUTH_TOKEN` comes only from `${{ secrets.NPM_TOKEN }}` and is never echoed.
9. Creates GitHub Release `vX.Y.Z` from that CHANGELOG section when it does not already exist (`contents: write`).

See `SECURITY.md` for the leaked-secret audit. `.gitleaks.toml` allowlists only the invented throwaway `querykit` / `QueryKit_*` strings.

This repository does **not** publish from a developer laptop. `make publish` is a reminder only.

## Cutting a release

1. Land the PR on `main`.
2. Bump `version` in `package.json` (already done in the PR that contains the change) and update `CHANGELOG.md`.
3. Merge to `main`. The publish job publishes to npm (if the version is new) and creates GitHub Release `vX.Y.Z` from `CHANGELOG.md`.
4. Confirm `npm view iagate-querykit version` and https://github.com/felipeoliveiradev/iagate-querykit/releases.

Do not run `npm publish` from a cloud agent or a local checkout unless you are the package owner and intend to publish.
