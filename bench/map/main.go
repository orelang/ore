// Maps: inserts, looks up and deletes integer and string keys, then iterates
// over what is left.
package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	n := 1000000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	// Integer keys, spread out; half of the lookups miss.
	numbers := make(map[int]int)
	for i := 0; i < n; i++ {
		numbers[i*7] = i
	}
	hits, sum := 0, 0
	for i := 0; i < 2*n; i++ {
		if _, ok := numbers[i*7]; ok {
			hits++
		}
		sum += numbers[i*7]
	}
	for i := 0; i < n; i += 2 {
		delete(numbers, i*7)
	}
	for k, v := range numbers {
		sum += k + v
	}

	// String keys built from numbers; a third of them deleted.
	names := make(map[string]int)
	for i := 0; i < n; i++ {
		names["key-"+strconv.Itoa(i)] = i
	}
	for i := 0; i < n; i++ {
		if v, ok := names["key-"+strconv.Itoa(i*3)]; ok {
			sum += v
		} else {
			sum += 1
		}
	}
	for i := 0; i < n; i += 3 {
		delete(names, "key-"+strconv.Itoa(i))
	}
	for k, v := range names {
		sum += len(k) + v
	}

	fmt.Println(hits, len(numbers), len(names), sum)
}
