#!/bin/sh
# Runs the test suite in Linux containers: ci/test-linux.sh [linux/arm64|linux/amd64 ...]
set -e
cd "$(dirname "$0")/.."
platforms=${*:-linux/arm64 linux/amd64}
for platform in $platforms; do
    tag="ore-ci:$(echo "$platform" | tr / -)"
    docker build -q --platform "$platform" -t "$tag" ci >/dev/null
    echo "== $platform"
    # A clean copy of the sources (with .git, for the seed of the bootstrap), without build output of the host.
    docker run --rm --platform "$platform" -v "$PWD:/src:ro" "$tag" sh -c '
        tar -C /src --exclude=./node_modules --exclude=./dist --exclude="*/node_modules" --exclude=./.claude -cf - . | tar -xf - &&
        ci/bootstrap.sh dist && ORE=dist/ore ci/test.sh 2>&1 | tail -40'
done
