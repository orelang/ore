// Binary trees from the Computer Language Benchmarks Game: allocates many
// short-lived trees and one long-lived tree, and checks them by counting nodes.
// Each tree is allocated with malloc and freed after it is checked.
#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    struct Node *left, *right;
} Node;

static Node *create(int depth) {
    Node *node = malloc(sizeof *node);
    if (depth == 0) {
        node->left = node->right = NULL;
    } else {
        node->left = create(depth - 1);
        node->right = create(depth - 1);
    }
    return node;
}

static long check(const Node *node) {
    if (node->left == NULL || node->right == NULL) return 1;
    return 1 + check(node->left) + check(node->right);
}

static void destroy(Node *node) {
    if (node->left != NULL) destroy(node->left);
    if (node->right != NULL) destroy(node->right);
    free(node);
}

int main(int argc, char **argv) {
    int n = argc > 1 ? atoi(argv[1]) : 16;
    int minDepth = 4;
    int maxDepth = n;
    if (maxDepth < minDepth + 2) maxDepth = minDepth + 2;

    int stretchDepth = maxDepth + 1;
    Node *stretch = create(stretchDepth);
    printf("stretch tree of depth %d\t check: %ld\n", stretchDepth, check(stretch));
    destroy(stretch);

    Node *longLived = create(maxDepth);
    for (int depth = minDepth; depth <= maxDepth; depth += 2) {
        long iterations = 1L << (maxDepth - depth + minDepth);
        long sum = 0;
        for (long i = 0; i < iterations; i++) {
            Node *tree = create(depth);
            sum += check(tree);
            destroy(tree);
        }
        printf("%ld\t trees of depth %d\t check: %ld\n", iterations, depth, sum);
    }
    printf("long lived tree of depth %d\t check: %ld\n", maxDepth, check(longLived));
    destroy(longLived);
    return 0;
}
