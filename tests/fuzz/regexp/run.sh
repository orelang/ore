#!/bin/sh
# Random regular expressions and ASCII subjects, matched by Ore and by Node:
# every exec in a loop (g, y), with indices and groups, and replace, must be
# Node's; a pattern Node takes and Ore rejects shows as `rejected:`.
#   tests/fuzz/regexp/run.sh [count] [seed]      (default: 20000 1)
set -eu
cd "$(dirname "$0")/../../.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"${NODE:-node}" tests/fuzz/regexp/gen.mjs "$work/cases.jsonl" "${1:-20000}" "${2:-1}" >"$work/node.txt"
"${ORE:-ore}" build --release tests/fuzz/regexp/check.ore -o "$work/check"
"$work/check" "$work/cases.jsonl" >"$work/ore.txt"
# V8 takes some names repeated where the specification says both groups may
# take part, as `(?<a>y)(?=q|(?<a>x))` (but not `(?=q|(?<a>x))(?<a>y)`); Ore
# rejects them, so those cases are counted apart.
perl -e '
    local $/; open my $n, "<", $ARGV[0]; open my $o, "<", $ARGV[1];
    my @n = split /\n(?=== )/, <$n>; my @o = split /\n(?=== )/, <$o>;
    my ($same, $v8, $differ) = (0, 0, 0);
    for my $i (0 .. $#n) {
        if ($n[$i] eq $o[$i]) { $same++ }
        elsif ($o[$i] =~ /^rejected: Duplicate capture group name$/m) { $v8++ }
        else { $differ++; print "NODE $n[$i]\nORE  $o[$i]\n\n" if $differ <= 10 }
    }
    print "regular expressions: $same as Node, $v8 duplicate names V8 takes against the specification, $differ differ\n";
    exit($differ > 0 ? 1 : 0)' "$work/node.txt" "$work/ore.txt"
