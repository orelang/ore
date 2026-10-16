// K-nucleotide from the Computer Language Benchmarks Game: generates a DNA
// sequence of n nucleotides with the fasta generator, counts its k-mers in
// maps keyed by strings, and prints the counts of the 1- and 2-mers, most
// frequent first, and those of the five sequences the game asks for.
package main

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

var sequence string

func count(k int) map[string]int {
	counts := map[string]int{}
	for i := 0; i+k <= len(sequence); i++ {
		counts[sequence[i:i+k]]++
	}
	return counts
}

func frequencies(k int) string {
	counts := count(k)
	keys := []string{}
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if counts[a] != counts[b] {
			return counts[a] > counts[b]
		}
		return a < b
	})
	parts := []string{}
	for _, key := range keys {
		parts = append(parts, key+":"+strconv.Itoa(counts[key]))
	}
	return strings.Join(parts, " ")
}

func main() {
	n := 2000000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	// The generator of fasta, choosing a nucleotide by integer weights out of 139968.
	seed := 42
	var chunk strings.Builder
	for i := 0; i < n; i++ {
		seed = (seed*3877 + 29573) % 139968
		switch {
		case seed < 42398:
			chunk.WriteByte('A')
		case seed < 70391:
			chunk.WriteByte('C')
		case seed < 98384:
			chunk.WriteByte('G')
		default:
			chunk.WriteByte('T')
		}
	}
	sequence = chunk.String()

	parts := []string{frequencies(1), frequencies(2)}
	for _, key := range []string{"GGT", "GGTA", "GGTATT", "GGTATTTTAATT", "GGTATTTTAATTTATAGT"} {
		parts = append(parts, key+":"+strconv.Itoa(count(len(key))[key]))
	}
	fmt.Println(strings.Join(parts, " "))
}
