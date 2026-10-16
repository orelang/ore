#!/bin/sh
# Runs the fuzzers that compare with Node (strings, json, collections, regexp,
# numbers) without end on a Kubernetes cluster: pods of node's image, each
# running every fuzzer in turn with seeds of its own, their checkers built
# beforehand for Linux x86-64 (they need only glibc 2.34) and given to the
# pods with the scripts in config maps, so that no image is built.
#
#   tests/fuzz/kube.sh deploy BINDIR [PODS]   BINDIR holds the checkers, named
#                                            by their fuzzer (strings, json...),
#                                            as `ore build --release
#                                            tests/fuzz/X/check.ore -o BINDIR/X`
#                                            makes them; 6 pods by default
#   tests/fuzz/kube.sh report                what each pod found: a line per
#                                            run, and the differences of those
#                                            that failed
#   tests/fuzz/kube.sh stop                  deletes the namespace
#
# kubectl uses $KUBECONFIG; the namespace is $ORE_FUZZ_NS (default ore-fuzz).
set -eu
cd "$(dirname "$0")/../.."
ns=${ORE_FUZZ_NS:-ore-fuzz}
fuzzers="strings json collections regexp numbers"

case ${1:-} in
deploy)
    bins=$2
    pods=${3:-6}
    kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f - >/dev/null
    # Config map keys cannot hold a slash: tests/fuzz/X/f is X--f.
    set --
    for f in $fuzzers; do
        [ -x "$bins/$f" ] || { echo "no checker $bins/$f" >&2; exit 1; }
        set -- "$@" --from-file="$f--gen.mjs=tests/fuzz/$f/gen.mjs" --from-file="$f--run.sh=tests/fuzz/$f/run.sh"
    done
    kubectl -n "$ns" create configmap fuzz-scripts "$@" --from-file=loop.sh=/dev/stdin --dry-run=client -o yaml <<'EOF' | kubectl apply --server-side --force-conflicts -f - >/dev/null
#!/bin/sh
# In a pod: lays out tests/fuzz as in the repository, with an `ore` whose
# `build` copies the checker built beforehand, and runs the fuzzers in turn.
set -u
mkdir -p /work/bin /results
cd /work
for f in /scripts/*--*; do
    name=$(basename "$f"); dir=tests/fuzz/${name%%--*}
    mkdir -p "$dir"; cp "$f" "$dir/${name#*--}"; chmod +x "$dir/${name#*--}"
done
cat >/work/bin/ore <<'ORE'
#!/bin/sh
# ore build [--release] tests/fuzz/X/check.ore -o OUT
src= out=
while [ $# -gt 0 ]; do case $1 in -o) out=$2; shift ;; *.ore) src=$1 ;; esac; shift; done
fuzzer=$(basename "$(dirname "$src")")
cp "/checkers/$fuzzer" "$out" && chmod +x "$out"
ORE
chmod +x /work/bin/ore
seed=$(( $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') * 1000 ))
while true; do
    for f in $FUZZERS; do
        case $f in numbers) count=2000000 ;; collections) count=30000 ;; *) count=100000 ;; esac
        seed=$((seed + 1))
        start=$(date +%s)
        if ORE=/work/bin/ore sh "tests/fuzz/$f/run.sh" "$count" "$seed" >/tmp/out 2>&1; then
            echo "ok $f seed=$seed count=$count $(( $(date +%s) - start ))s: $(tail -1 /tmp/out)"
        else
            echo "FAIL $f seed=$seed count=$count: $(tail -1 /tmp/out)"
            cp /tmp/out "/results/$f-$seed.txt"
            sed 's/^/  | /' /tmp/out | head -60
        fi
    done
done
EOF
    # A config map holds at most 1 MiB: one per checker.
    for f in $fuzzers; do
        kubectl -n "$ns" create configmap "fuzz-checker-$f" --from-file="$f=$bins/$f" --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f - >/dev/null
    done
    sources=$(for f in $fuzzers; do printf '            - configMap: { name: fuzz-checker-%s }\n' "$f"; done)
    kubectl -n "$ns" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fuzz
spec:
  replicas: $pods
  selector:
    matchLabels: { app: ore-fuzz }
  template:
    metadata:
      labels: { app: ore-fuzz }
      annotations: { scripts: "$(git rev-parse --short HEAD)-$(date +%s)" }
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: { app: ore-fuzz }
      containers:
        - name: fuzz
          image: node:24-bookworm-slim
          command: ["sh", "/scripts/loop.sh"]
          env:
            - { name: FUZZERS, value: "$fuzzers" }
          resources:
            requests: { cpu: 500m, memory: 512Mi }
            limits: { cpu: "1", memory: 1Gi }
          volumeMounts:
            - { name: scripts, mountPath: /scripts }
            - { name: checkers, mountPath: /checkers }
      volumes:
        - name: scripts
          configMap: { name: fuzz-scripts }
        - name: checkers
          projected:
            defaultMode: 0755
            sources:
$sources
EOF
    ;;
report)
    for pod in $(kubectl -n "$ns" get pods -l app=ore-fuzz -o name); do
        echo "== $pod"
        kubectl -n "$ns" logs "$pod" --tail=-1 | grep -v '^ok ' || true
        kubectl -n "$ns" logs "$pod" --tail=-1 | grep -c '^ok ' | sed 's/^/  runs that matched node: /'
    done
    ;;
stop)
    kubectl delete namespace "$ns"
    ;;
*)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
