#!/bin/sh
# Runs a command in a copy of this working tree on a Linux machine:
#   ORE_REMOTE=user@host [ORE_REMOTE_DIR=ore] ci/remote.sh [command...]
# (default: the test suite)
# The machine needs Bun, clang, LLVM's library and lld (see ci/Dockerfile);
# the copy lives in ~/$ORE_REMOTE_DIR there (~/ore by default) and is synced
# with rsync before each run; separate directories let runs go side by side.
set -e
cd "$(dirname "$0")/.."
: "${ORE_REMOTE:?set ORE_REMOTE to user@host}"
dir=${ORE_REMOTE_DIR:-ore}
rsync -az --delete --exclude=node_modules --exclude=dist --exclude=.claude --exclude=.git ./ "$ORE_REMOTE:$dir/"
command=${*:-bun run test}
# shellcheck disable=SC2029
ssh "$ORE_REMOTE" "cd $dir && export PATH=\$HOME/.bun/bin:/usr/lib/llvm-22/bin:\$PATH && bun install --frozen-lockfile --ignore-scripts >/dev/null && $command"
