// Strings: builds a long string by concatenation and by joining parts, then
// splits, scans and searches it.
package main

import (
	"fmt"
	"os"
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

	// Concatenation, one small piece at a time.
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteString(fmt.Sprintf("%d,", i%1000))
	}
	text := b.String()

	// Joining parts made by formatting and methods.
	parts := make([]string, 0)
	for i := 0; i < n; i++ {
		parts = append(parts, strings.ToUpper(fmt.Sprintf("item-%d", i)))
	}
	joined := strings.Join(parts, ";")

	// Counting: separators by splitting, a byte by scanning, a word by searching.
	fields := len(strings.Split(text, ","))
	sevens := 0
	for i := 0; i < len(joined); i++ {
		if joined[i] == '7' {
			sevens++
		}
	}
	items := 0
	at := strings.Index(joined, "ITEM-9")
	for at >= 0 {
		items++
		next := strings.Index(joined[at+1:], "ITEM-9")
		if next < 0 {
			break
		}
		at += 1 + next
	}
	fmt.Println(len(text), len(joined), fields, sevens, items)
}
