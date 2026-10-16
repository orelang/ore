// Tasks: starts n goroutines that each compute a little, waits for all of
// them and adds up their results.
package main

import (
	"fmt"
	"os"
	"strconv"
	"sync"
)

func work(i int) int {
	x := i
	for k := 0; k < 100; k++ {
		x = (x*31 + k) % 1000003
	}
	return x
}

func main() {
	n := 100000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	results := make([]int, 0)
	for i := 0; i < n; i++ {
		results = append(results, 0)
	}
	var group sync.WaitGroup
	for i := 0; i < n; i++ {
		group.Add(1)
		go func() {
			results[i] = work(i)
			group.Done()
		}()
	}
	group.Wait()
	sum := 0
	for _, r := range results {
		sum += r
	}
	fmt.Println(n, sum)
}
