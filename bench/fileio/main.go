// File I/O: writes n lines of comma-separated numbers to a file in a new
// temporary directory, reads the file back, parses the second number of each
// line and sums them, then removes the directory. The file is written and
// read whole, as in the Ore version.
package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

func check(err error) {
	if err != nil {
		panic(err)
	}
}

func main() {
	n := 3000000
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}

	dir, err := os.MkdirTemp("", "go-bench-fileio-")
	check(err)
	path := dir + "/numbers.csv"

	var out strings.Builder
	for i := 0; i < n; i++ {
		out.WriteString(strconv.Itoa(i))
		out.WriteByte(',')
		out.WriteString(strconv.Itoa((i * 7919) % 1000003))
		out.WriteByte('\n')
	}
	check(os.WriteFile(path, []byte(out.String()), 0o644))

	data, err := os.ReadFile(path)
	check(err)
	text := string(data)
	lines, sum := 0, 0
	for _, line := range strings.Split(text, "\n") {
		if len(line) == 0 {
			continue
		}
		lines++
		x, _ := strconv.Atoi(line[strings.IndexByte(line, ',')+1:])
		sum += x
	}
	check(os.RemoveAll(dir))
	fmt.Println(lines, len(text), sum)
}
