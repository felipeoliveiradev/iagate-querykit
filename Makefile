SHELL := /bin/bash

.PHONY: all clean build typecheck test test-watch pack publish

all: clean build test

clean:
	rm -rf dist

build:
	npm run build

typecheck:
	npm run typecheck

test:
	npm test

test-watch:
	npm run test:watch

pack: clean build
	npm pack

# Publishing is done by GitHub Actions (see RELEASE.md). Do not npm publish from a laptop.
publish:
	@echo "Merge to main. CI publishes to npm and creates GitHub Release vX.Y.Z. Owner must set the NPM_TOKEN secret."
	@echo "See RELEASE.md"
	@exit 1
