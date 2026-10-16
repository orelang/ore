#!/bin/sh
# Random strings and the methods of String.prototype, by Ore and by Node:
# every result must be Node's (see tests/fuzz/strings/gen.mjs for which
# methods get non-ASCII strings).
#   tests/fuzz/strings/run.sh [count] [seed]      (default: 20000 1)
set -eu
cd "$(dirname "$0")/../../.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"${NODE:-node}" tests/fuzz/strings/gen.mjs "$work/cases.jsonl" "${1:-20000}" "${2:-1}" >"$work/node.txt"
"${ORE:-ore}" build --release tests/fuzz/strings/check.ore -o "$work/check"
"$work/check" "$work/cases.jsonl" >"$work/ore.txt"
perl -e '
    local $/; open my $n, "<", $ARGV[0]; open my $o, "<", $ARGV[1];
    my @n = split /\n/, <$n>; my @o = split /\n/, <$o>;
    my ($same, $differ, $case) = (0, 0, "");
    for my $i (0 .. $#n) {
        $case = $n[$i] if $n[$i] =~ /^== /;
        if ($n[$i] eq ($o[$i] // "")) { $same++ }
        else { $differ++; print "$case\nNODE $n[$i]\nORE  $o[$i]\n\n" if $differ <= 20 }
    }
    print "string results: $same as Node, $differ differ\n";
    exit($differ > 0 ? 1 : 0)' "$work/node.txt" "$work/ore.txt"
