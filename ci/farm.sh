#!/usr/bin/env bash
# Runs builds and test suites on a farm of Linux machines instead of this one.
# A job is a commit and a command: the commit's tree is sent with git archive
# (nothing is built here), the command runs in ~/farm/<job> on a machine with
# a free slot, and its output is kept in $ORE_FARM_HOME/logs/<job>.log.
#
#   ci/farm.sh test NAME REF [FILTER...]   the suite of REF (or the cases of
#                                          FILTER), its runner built by the
#                                          machine's base compiler
#   ci/farm.sh verify NAME REF             bootstrap REF from the seed, then
#                                          its whole suite: a release check
#   ci/farm.sh run NAME REF COMMAND...     any command in the tree of REF
#   ci/farm.sh probe NAME REF FILE...      builds the compiler of REF and runs
#                                          each FILE of its tree with it
#   ci/farm.sh submit NAME test|probe REF [ARGS...]
#                                          queues a test or probe for `serve`,
#                                          which writes done/NAME.status; the
#                                          output is in logs/NAME.log. Agents,
#                                          which cannot reach the machines, use
#                                          this.
#   ci/farm.sh wait NAME                   waits for a submitted job (at most
#                                          50 minutes), prints its log and
#                                          exits with its status
#   ci/farm.sh serve                       runs the queue, a job per free slot
#   ci/farm.sh base REF                    builds each machine's base compiler
#   ci/farm.sh status                      slots, queue and recent results
#
# The machines are listed in $ORE_FARM (default ~/.config/ore/farm), a line
# each: `user@host slots`. A slot runs one job with the machine's cores
# divided among its slots. Each needs LLVM 22 with lld and clang (see
# ci/Dockerfile), rsync, and the seed of ci/bootstrap.sh in ~/.cache/ore.
set -euo pipefail
cd "$(dirname "$0")/.."
home=${ORE_FARM_HOME:-$HOME/.cache/ore/farm}
hosts=${ORE_FARM:-$HOME/.config/ore/farm}
mkdir -p "$home/slots" "$home/logs" "$home/queue" "$home/done"
[ -f "$hosts" ] || { echo "no machines: list them in $hosts as 'user@host slots'" >&2; exit 1; }

machines() { grep -v '^\s*\(#\|$\)' "$hosts"; }

# Takes a free slot, waiting for one: prints `host slots slot`.
acquire() {
    while true; do
        while read -r host slots; do
            for ((i = 1; i <= slots; i++)); do
                lock="$home/slots/$host-$i"
                # A slot whose owner died is free again.
                if [ -d "$lock" ] && ! kill -0 "$(cat "$lock/pid" 2>/dev/null || echo 0)" 2>/dev/null; then
                    rm -f "$lock/pid" "$lock/job"
                    rmdir "$lock" 2>/dev/null || true
                fi
                if mkdir "$lock" 2>/dev/null; then
                    echo $$ >"$lock/pid"
                    echo "$1" >"$lock/job"
                    echo "$host $slots $i"
                    return
                fi
            done
        done < <(machines)
        sleep 5
    done
}

release() { rm -f "$home/slots/$1-$2/pid" "$home/slots/$1-$2/job"; rmdir "$home/slots/$1-$2" 2>/dev/null || true; }

# Runs a command in the tree of a commit on a free slot; the status is the command's.
job() {
    local name=$1 ref=$2 command=$3
    local commit host slots slot
    commit=$(git rev-parse --verify "$ref^{commit}")
    read -r host slots slot < <(acquire "$name")
    trap 'release "$host" "$slot"' EXIT
    local log="$home/logs/$name.log"
    echo "== $name: $(git log -1 --format='%h %s' "$commit") on $host (slot $slot)" | tee "$log"
    local dir="farm/$name"
    git archive --format=tar "$commit" | ssh "$host" "rm -rf $dir && mkdir -p $dir && tar -x -C $dir"
    local status=0
    # shellcheck disable=SC2029
    ssh "$host" "cd $dir && export PATH=/usr/lib/llvm-22/bin:\$PATH FARM_JOBS=\$(( \$(nproc) / $slots )) && $command" >>"$log" 2>&1 || status=$?
    [ $status = 0 ] && ssh "$host" "rm -rf $dir" || true
    echo "== $name: exit $status" >>"$log"
    tail -4 "$log"
    return $status
}

seed='$(ls -t ~/.cache/ore/seed-* | head -1)'
case ${1:-} in
test)
    name=$2 ref=$3
    shift 3
    job "$name" "$ref" "[ -x ~/farm/base/ore ] || { echo 'no base compiler: ci/farm.sh base main'; exit 1; }; \
        ORE=~/farm/base/ore ORE_TEST_CACHE=\$PWD/.test-cache ORE_TEST_JOBS=\$FARM_JOBS ci/test.sh --timeout 1500 $* | tail -40"
    ;;
probe)
    name=$2 ref=$3
    shift 3
    job "$name" "$ref" "[ -x ~/farm/base/ore ] || { echo 'no base compiler: ci/farm.sh base main'; exit 1; }; \
        ~/farm/base/ore build compiler/src/main.ore -o .farm-ore --release 2>&1 | tail -30 && \
        for f in $*; do echo \"== \$f\"; ./.farm-ore run \"\$f\" 2>&1 | head -200; done"
    ;;
verify)
    job "$2" "$3" "ORE=$seed ci/bootstrap.sh dist >/dev/null 2>&1 && \
        ORE=dist/ore ORE_TEST_CACHE=\$PWD/.test-cache ORE_TEST_JOBS=\$FARM_JOBS ci/test.sh --timeout 1500 | tail -40"
    ;;
run)
    name=$2 ref=$3
    shift 3
    job "$name" "$ref" "$*"
    ;;
submit)
    name=$2
    shift
    rm -f "$home/done/$name.status"
    printf '%s\n' "$@" >"$home/queue/$name.job.tmp"
    mv "$home/queue/$name.job.tmp" "$home/queue/$name.job"
    echo "queued $name: wait for $home/done/$name.status, the log is $home/logs/$name.log"
    ;;
wait)
    for ((t = 0; t < 600; t++)); do
        if [ -f "$home/done/$2.status" ]; then
            tail -n 80 "$home/logs/$2.log"
            exit "$(cat "$home/done/$2.status")"
        fi
        sleep 5
    done
    echo "$2 is still running: ci/farm.sh wait $2 again" >&2
    exit 124
    ;;
serve)
    # Queued jobs start as slots free; each runs in its own process.
    while true; do
        for file in "$home"/queue/*.job; do
            [ -e "$file" ] || continue
            name=$(basename "$file" .job)
            mapfile -t args <"$file"
            rm -f "$file"
            case ${args[0]:-} in
            test | probe) ("$0" "${args[0]}" "$name" "${args[@]:1}" >/dev/null 2>&1; echo $? >"$home/done/$name.status") & ;;
            *) echo "unknown kind: ${args[0]:-}" >"$home/logs/$name.log"; echo 2 >"$home/done/$name.status" ;;
            esac
            sleep 1
        done
        sleep 3
    done
    ;;
base)
    commit=$(git rev-parse --verify "${2:-main}^{commit}")
    while read -r host _; do
        (
            echo "== base on $host: $(git log -1 --format='%h %s' "$commit")"
            git archive --format=tar "$commit" | ssh "$host" "rm -rf farm/base-src && mkdir -p farm/base-src && tar -x -C farm/base-src"
            # shellcheck disable=SC2029
            ssh "$host" "cd farm/base-src && export PATH=/usr/lib/llvm-22/bin:\$PATH && ORE=$seed ci/bootstrap.sh dist >/dev/null 2>&1 && mkdir -p ../base && mv dist/ore ../base/ore.new && mv ../base/ore.new ../base/ore && echo built"
        ) >"$home/logs/base-$host.log" 2>&1 &
    done < <(machines)
    wait
    tail -n 2 "$home"/logs/base-*.log
    ;;
status)
    echo "slots:"
    while read -r host slots; do
        for ((i = 1; i <= slots; i++)); do
            lock="$home/slots/$host-$i"
            echo "  $host/$i: $([ -d "$lock" ] && cat "$lock/job" 2>/dev/null || echo free)"
        done
    done < <(machines)
    echo "queued: $(ls "$home/queue" | sed 's/\.job$//' | tr '\n' ' ')"
    echo "done:"
    for file in $(ls -t "$home"/done/*.status 2>/dev/null | head -20); do
        echo "  $(basename "$file" .status): exit $(cat "$file")"
    done
    ;;
*)
    sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
