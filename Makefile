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

publish: clean build test
	npm publish --access public 