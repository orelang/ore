// Channels: a pipeline of three goroutines. A producer sends the numbers 1..n,
// a stage squares them modulo a prime and a consumer sums what arrives, each
// hop through a buffered channel.
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

	numbers := make(chan int, 100)
	squares := make(chan int, 100)
	go func() {
		for i := 1; i <= n; i++ {
			numbers <- i
		}
		close(numbers)
	}()
	go func() {
		for v := range numbers {
			squares <- (v * v) % 1000003
		}
		close(squares)
	}()
	count := 0
	sum := 0
	for v := range squares {
		count++
		sum += v
	}
	fmt.Println(count, sum)
}
