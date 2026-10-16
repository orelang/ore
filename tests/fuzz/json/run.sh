#!/bin/sh
# Random JSON texts read and written by Ore and by Node: every text Node
# rejects Ore must reject, and every other must give Node's value back
# (tests/fuzz/json/gen.mjs).
#   tests/fuzz/json/run.sh [count] [seed]      (default: 20000 1)
set -eu
cd "$(dirname "$0")/../../.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"${NODE:-node}" tests/fuzz/json/gen.mjs "$work/texts.jsonl" "${1:-20000}" "${2:-1}" >"$work/node.txt"
"${ORE:-ore}" build --release tests/fuzz/json/check.ore -o "$work/check"
"$work/check" "$work/texts.jsonl" >"$work/ore.txt"
perl -e '
    local $/; open my $n, "<", $ARGV[0]; open my $o, "<", $ARGV[1]; open my $t, "<", $ARGV[2];
    my @n = split /\n/, <$n>; my @o = split /\n/, <$o>; my @t = split /\n/, <$t>;
    my ($same, $skip, $differ) = (0, 0, 0);
    for my $i (0 .. $#n) {
        if ($n[$i] eq "skip") { $skip++ }
        elsif ($n[$i] eq ($o[$i] // "")) { $same++ }
        else { $differ++; print "TEXT $t[$i]\nNODE $n[$i]\nORE  $o[$i]\n\n" if $differ <= 10 }
    }
    print "json texts: $same as Node, $skip damaged into another value, $differ differ\n";
    exit($differ > 0 ? 1 : 0)' "$work/node.txt" "$work/ore.txt" "$work/texts.jsonl"
