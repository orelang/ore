// N-queens: counts the ways to place n queens on an n×n board, once by
// recursion over small arrays of the taken columns and diagonals, once by
// recursion over bitmasks.
package main

import (
	"fmt"
	"os"
	"strconv"
)

func place(row, n int, columns, down, up []bool) int {
	if row == n {
		return 1
	}
	count := 0
	for column := 0; column < n; column++ {
		d := row + column
		u := row - column + n - 1
		if columns[column] || down[d] || up[u] {
			continue
		}
		columns[column] = true
		down[d] = true
		up[u] = true
		count += place(row+1, n, columns, down, up)
		columns[column] = false
		down[d] = false
		up[u] = false
	}
	return count
}

func placeBits(all, columns, left, right int) int {
	if columns == all {
		return 1
	}
	count := 0
	free := all &^ (columns | left | right)
	for free != 0 {
		bit := free & -free
		free ^= bit
		count += placeBits(all, columns|bit, ((left|bit)<<1)&all, (right|bit)>>1)
	}
	return count
}

func main() {
	n := 13
	if len(os.Args) > 1 {
		if x, err := strconv.Atoi(os.Args[1]); err == nil {
			n = x
		}
	}
	columns := []bool{}
	down := []bool{}
	up := []bool{}
	for i := 0; i < n; i++ {
		columns = append(columns, false)
	}
	for i := 0; i < 2*n-1; i++ {
		down = append(down, false)
		up = append(up, false)
	}
	fmt.Println(n, place(0, n, columns, down, up), placeBits(1<<n-1, 0, 0, 0))
}
