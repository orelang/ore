// Sort: sorts pseudo-random integers and then a fifth as many strings with
// the built-in sort, and prints checksums of the sorted orders.
package main

import (
	"fmt"
	"os"
	"slices"
	"strconv"
)

// A 32-bit xorshift generator, the same in every language.
var state uint32 = 2463534242

func next() int {
	state ^= state << 13
	state ^= state >> 17
	state ^= state << 5
	return int(state >> 1)
}

func main() {
	n := 5000000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	numbers := []int{}
	for i := 0; i < n; i++ {
		numbers = append(numbers, next())
	}
	slices.Sort(numbers)
	sum := 0
	for _, x := range numbers {
		sum = (sum*31 + x) % 1000000007
	}

	words := []string{}
	for i := 0; i < n/5; i++ {
		words = append(words, "w"+strconv.Itoa(next()))
	}
	slices.Sort(words)
	hash := 0
	for _, w := range words {
		hash = (hash*31 + len(w)*256 + int(w[len(w)-1])) % 1000000007
	}

	fmt.Println(sum, hash, words[0], words[len(words)-1])
}
