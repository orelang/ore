#!/bin/sh
# Fuzzing of the front end: programs of the suite, damaged at random (a cut,
# a repeated line, a token or bracket put in), are checked and formatted. The
# compiler must answer with diagnostics, never a panic or a crash, and `ore
# fmt` of a file that parses must give a file that formats to itself. A
# failing input is kept in $FUZZ (default .fuzz/) as syntax-N.ore.
#
#   tests/fuzz/syntax.sh [first-seed] [count]      (default: 1 500)
# ORE is the compiler. The status is 1 on a failure.
set -u
cd "$(dirname "$0")/../.."
first=${1:-1}
count=${2:-500}
ore=${ORE:-ore}
keep=${FUZZ:-$(pwd)/.fuzz}
mkdir -p "$keep"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
files=$(find tests/run tests/diag -name '*.ore' | sort)
total=$(echo "$files" | wc -l)
run() { perl -e 'alarm 20; exec @ARGV' "$@"; }
crashed=0
unstable=0
seed=$first
while [ "$seed" -lt $((first + count)) ]; do
    source=$(echo "$files" | sed -n "$((seed % total + 1))p")
    # One to three damages, chosen and placed by the seed.
    perl -e '
        srand($ARGV[0]); local $/; open my $f, "<", $ARGV[1]; my $t = <$f>;
        my @tokens = ("{", "}", "(", ")", "[", "]", "<", ">", "=>", ";", ",", ".", "?", ":", "?.", "??", "...",
            "\"", "`", "\${", "/", "*", "//", "/*", "@", "#", "let", "const", "class", "function", "async", "await",
            "yield", "return", "if", "else", "for", "of", "in", "new", "this", "super", "typeof", "keyof", "as",
            "extends", "implements", "interface", "type", "import", "export", "from", "1e309", "0x", "1n", "\\u{", "\n");
        for (1 .. 1 + int(rand(3))) {
            my $at = int(rand(length($t) + 1));
            my $kind = int(rand(4));
            if ($kind == 0) { substr($t, $at, int(rand(30))) = "" }
            elsif ($kind == 1) { my $l = int(rand(length($t))); my $e = index($t, "\n", $l); $e = length($t) if $e < 0;
                substr($t, $at, 0) = substr($t, $l, $e - $l + 1) }
            else { substr($t, $at, 0) = " " . $tokens[int(rand(@tokens))] . " " }
        }
        print $t' "$seed" "$source" >"$work/m.ore"
    problem=""
    run "$ore" check "$work/m.ore" >"$work/check" 2>&1
    status=$?
    if [ $status -ge 2 ] || grep -q "^panic:" "$work/check"; then
        problem="check crashed ($status)"
    else
        cp "$work/m.ore" "$work/f.ore"
        if run "$ore" fmt "$work/f.ore" >"$work/fmt" 2>&1; then
            cp "$work/f.ore" "$work/g.ore"
            if ! run "$ore" fmt "$work/g.ore" >>"$work/fmt" 2>&1; then
                problem="fmt fails on its own output"
            elif ! cmp -s "$work/f.ore" "$work/g.ore"; then
                problem="fmt is not idempotent"
            fi
        elif grep -q "^panic:" "$work/fmt" || [ $? -ge 2 ]; then
            problem="fmt crashed"
        fi
    fi
    if [ -n "$problem" ]; then
        echo "seed $seed ($source): $problem"
        cp "$work/m.ore" "$keep/syntax-$seed.ore"
        case $problem in check*|fmt\ crashed) crashed=$((crashed + 1)) ;; *) unstable=$((unstable + 1)) ;; esac
    fi
    seed=$((seed + 1))
done
echo "damaged programs: $count, crashes: $crashed, fmt problems: $unstable"
[ $((crashed + unstable)) = 0 ]
