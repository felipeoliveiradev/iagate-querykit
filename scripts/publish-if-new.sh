#!/usr/bin/env bash
# Publish iagate-querykit to npm when this version is not on the registry,
# then optionally create GitHub Release vX.Y.Z from CHANGELOG.md.
#
# Fiboui lessons:
#   1) Nested quotes around node -e in a YAML run: block break the
#      version-check. Read name/version with single-quoted node -p only.
#   2) npm publish --provenance returns E422 if repository.url is empty
#      or does not match this GitHub repo.
#   3) Never echo NODE_AUTH_TOKEN / NPM_TOKEN.
set -euo pipefail

VERSION="$(node -p 'require("./package.json").version')"
NAME="$(node -p 'require("./package.json").name')"
REPO_URL="$(node -p 'require("./package.json").repository.url')"
EXPECTED_REPO='git+https://github.com/felipeoliveiradev/iagate-querykit.git'

if [ -z "${REPO_URL}" ] || [ "${REPO_URL}" != "${EXPECTED_REPO}" ]; then
  echo "package.json repository.url must be ${EXPECTED_REPO} (npm provenance E422 if empty/mismatched)." >&2
  exit 1
fi

if ! node scripts/extract-changelog.mjs "${VERSION}" >/dev/null; then
  echo "CHANGELOG.md must have a ## ${VERSION} section." >&2
  exit 1
fi

if npm view "${NAME}@${VERSION}" version >/dev/null 2>&1; then
  echo "Version ${NAME}@${VERSION} is already on npm; skipping publish."
else
  npm publish --provenance --access public
fi

if [ "${CREATE_GITHUB_RELEASE:-0}" = "1" ]; then
  if gh release view "v${VERSION}" >/dev/null 2>&1; then
    echo "GitHub Release v${VERSION} already exists."
  else
    NOTES="$(mktemp)"
    node scripts/extract-changelog.mjs "${VERSION}" > "${NOTES}"
    gh release create "v${VERSION}" --title "v${VERSION}" --notes-file "${NOTES}"
    rm -f "${NOTES}"
    echo "Created GitHub Release v${VERSION}"
  fi
fi
