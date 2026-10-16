// Binary trees from the Computer Language Benchmarks Game: allocates many
// short-lived trees and one long-lived tree, and checks them by counting nodes.
package main

import (
	"fmt"
	"os"
	"strconv"
)

type Node struct {
	left, right *Node
}

func create(depth int) *Node {
	if depth == 0 {
		return &Node{}
	}
	return &Node{create(depth - 1), create(depth - 1)}
}

func check(node *Node) int {
	if node.left == nil || node.right == nil {
		return 1
	}
	return 1 + check(node.left) + check(node.right)
}

func main() {
	n := 16
	if len(os.Args) > 1 {
		n, _ = strconv.Atoi(os.Args[1])
	}
	minDepth := 4
	maxDepth := n
	if maxDepth < minDepth+2 {
		maxDepth = minDepth + 2
	}

	stretchDepth := maxDepth + 1
	fmt.Printf("stretch tree of depth %d\t check: %d\n", stretchDepth, check(create(stretchDepth)))

	longLived := create(maxDepth)
	for depth := minDepth; depth <= maxDepth; depth += 2 {
		iterations := 1 << (maxDepth - depth + minDepth)
		sum := 0
		for i := 0; i < iterations; i++ {
			sum += check(create(depth))
		}
		fmt.Printf("%d\t trees of depth %d\t check: %d\n", iterations, depth, sum)
	}
	fmt.Printf("long lived tree of depth %d\t check: %d\n", maxDepth, check(longLived))
}
