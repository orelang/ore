// Startup: hello world, printed n times. With the default of one line, the
// time is that of starting the process and the runtime and exiting.
package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	n := 1
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	for i := 0; i < n; i++ {
		fmt.Println("hello, world")
	}
}
