// Regular expressions: generates a log of n lines, then counts the lines
// that match a few patterns, collects every match of a global one and
// rewrites the dates of the whole text with groups.
package main

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

func main() {
	n := 100000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	lines := make([]string, 0)
	for i := 0; i < n; i++ {
		month := fmt.Sprintf("%02d", i%12+1)
		day := fmt.Sprintf("%02d", i%28+1)
		lines = append(lines, fmt.Sprintf("user%d@host%d.example.com GET /page/%d 2024-%s-%s status %d", i, i%97, i%1000, month, day, 200+(i*7)%4*100))
	}
	text := strings.Join(lines, "\n")

	// Per line: a test, an anchored pattern with alternation, a match with groups.
	errors := regexp.MustCompile(`status 5\d\d$`)
	pages := regexp.MustCompile(`^user\d*7@host(1|2|3)\d?\.`)
	page := regexp.MustCompile(`GET /page/(\d+)`)
	failed := 0
	chosen := 0
	total := 0
	for _, line := range lines {
		if errors.MatchString(line) {
			failed++
		}
		if pages.MatchString(line) {
			chosen++
		}
		if m := page.FindStringSubmatch(line); m != nil {
			x, _ := strconv.Atoi(m[1])
			total += x
		}
	}

	// Over the whole text: every address, and the dates rewritten.
	addresses := len(regexp.MustCompile(`\w+@\w+\.example\.com`).FindAllString(text, -1))
	rewritten := regexp.MustCompile(`(\d{4})-(\d\d)-(\d\d)`).ReplaceAllString(text, "$3.$2.$1")
	words := len(regexp.MustCompile(`\s+`).Split(text, -1))
	fmt.Println(failed, chosen, total, addresses, len(rewritten), words, rewritten[len(rewritten)-40:])
}
