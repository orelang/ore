// Channels: a pipeline of three threads. A producer sends the numbers 1..n,
// a stage squares them modulo a prime and a consumer sums what arrives, each
// hop through a buffered channel.
//
// C has no channels, so each one is the usual bounded queue: a ring buffer of
// 100 values guarded by a mutex, with one condition variable for "not empty"
// and one for "not full", and a closed flag that ends the receiver's loop once
// the buffer is drained. Each stage is a plain pthread.
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

#define CAPACITY 100

typedef struct {
    long buffer[CAPACITY];
    int head, count;
    bool closed;
    pthread_mutex_t lock;
    pthread_cond_t notEmpty, notFull;
} Channel;

static void channelInit(Channel *c) {
    c->head = c->count = 0;
    c->closed = false;
    pthread_mutex_init(&c->lock, NULL);
    pthread_cond_init(&c->notEmpty, NULL);
    pthread_cond_init(&c->notFull, NULL);
}

static void channelSend(Channel *c, long value) {
    pthread_mutex_lock(&c->lock);
    while (c->count == CAPACITY) pthread_cond_wait(&c->notFull, &c->lock);
    c->buffer[(c->head + c->count) % CAPACITY] = value;
    c->count++;
    pthread_cond_signal(&c->notEmpty);
    pthread_mutex_unlock(&c->lock);
}

// Receives a value into *value; returns false when the channel is closed and empty.
static bool channelReceive(Channel *c, long *value) {
    pthread_mutex_lock(&c->lock);
    while (c->count == 0 && !c->closed) pthread_cond_wait(&c->notEmpty, &c->lock);
    if (c->count == 0) {
        pthread_mutex_unlock(&c->lock);
        return false;
    }
    *value = c->buffer[c->head];
    c->head = (c->head + 1) % CAPACITY;
    c->count--;
    pthread_cond_signal(&c->notFull);
    pthread_mutex_unlock(&c->lock);
    return true;
}

static void channelClose(Channel *c) {
    pthread_mutex_lock(&c->lock);
    c->closed = true;
    pthread_cond_broadcast(&c->notEmpty);
    pthread_mutex_unlock(&c->lock);
}

static long n = 1000000;
static Channel numbers, squares;

static void *produce(void *arg) {
    (void)arg;
    for (long i = 1; i <= n; i++) channelSend(&numbers, i);
    channelClose(&numbers);
    return NULL;
}

static void *square(void *arg) {
    (void)arg;
    long v;
    while (channelReceive(&numbers, &v)) channelSend(&squares, (v * v) % 1000003);
    channelClose(&squares);
    return NULL;
}

int main(int argc, char **argv) {
    if (argc > 1) n = atol(argv[1]);
    channelInit(&numbers);
    channelInit(&squares);
    pthread_t producer, stage;
    pthread_create(&producer, NULL, produce, NULL);
    pthread_create(&stage, NULL, square, NULL);
    long count = 0, sum = 0, v;
    while (channelReceive(&squares, &v)) {
        count++;
        sum += v;
    }
    pthread_join(producer, NULL);
    pthread_join(stage, NULL);
    printf("%ld %ld\n", count, sum);
    return 0;
}
