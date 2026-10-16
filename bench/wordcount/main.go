// Word count: generates a text of made-up words, splits it into lines and
// words, counts them in a map and prints the ten most frequent.
package main

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

func main() {
	n := 2000000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	// Words of one to three syllables, picked by a Lehmer generator.
	syllables := []string{"ka", "lo", "mi", "ne", "ru", "so", "ti", "va"}
	seed := 42
	var text strings.Builder
	for i := 0; i < n; i++ {
		seed = (seed * 48271) % 2147483647
		word := syllables[(seed>>2)%8]
		if seed%3 > 0 {
			word += syllables[(seed>>5)%8]
		}
		if seed%3 > 1 {
			word += syllables[(seed>>8)%8]
		}
		if i > 0 {
			if i%10 == 0 {
				text.WriteString("\n")
			} else {
				text.WriteString(" ")
			}
		}
		text.WriteString(word)
	}

	counts := make(map[string]int)
	for _, line := range strings.Split(text.String(), "\n") {
		for _, word := range strings.Split(line, " ") {
			counts[word]++
		}
	}

	// The most frequent first, ties in alphabetical order.
	type entry struct {
		word  string
		count int
	}
	entries := make([]entry, 0, len(counts))
	for word, count := range counts {
		entries = append(entries, entry{word, count})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].count != entries[j].count {
			return entries[i].count > entries[j].count
		}
		return entries[i].word < entries[j].word
	})
	top := []string{}
	for i := 0; i < 10 && i < len(entries); i++ {
		top = append(top, entries[i].word+":"+strconv.Itoa(entries[i].count))
	}
	fmt.Println(n, len(counts), strings.Join(top, " "))
}
