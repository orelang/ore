// Tasks: submits n tasks that each compute a little, waits for all of them and
// adds up their results.
//
// C has no lightweight tasks and a thread per task would measure the kernel,
// so the tasks run on the usual fixed thread pool: one worker per online CPU
// taking tasks from a growable queue guarded by a mutex and a condition
// variable. Waiting for them is a counter with its own condition variable, as
// a WaitGroup would be.
#define _DEFAULT_SOURCE
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

typedef struct {
    void (*run)(long);
    long arg;
} Task;

typedef struct {
    Task *tasks;
    long head, count, capacity;
    bool stopping;
    pthread_mutex_t lock;
    pthread_cond_t ready;
    long pending;
    pthread_cond_t idle;
} Pool;

static Pool pool = {
    .lock = PTHREAD_MUTEX_INITIALIZER,
    .ready = PTHREAD_COND_INITIALIZER,
    .idle = PTHREAD_COND_INITIALIZER,
};

static void submit(void (*run)(long), long arg) {
    pthread_mutex_lock(&pool.lock);
    if (pool.count == pool.capacity) {
        long capacity = pool.capacity == 0 ? 64 : pool.capacity * 2;
        Task *tasks = malloc(capacity * sizeof(Task));
        for (long i = 0; i < pool.count; i++) tasks[i] = pool.tasks[(pool.head + i) % pool.capacity];
        free(pool.tasks);
        pool.tasks = tasks;
        pool.head = 0;
        pool.capacity = capacity;
    }
    pool.tasks[(pool.head + pool.count) % pool.capacity] = (Task){run, arg};
    pool.count++;
    pool.pending++;
    pthread_cond_signal(&pool.ready);
    pthread_mutex_unlock(&pool.lock);
}

static void *worker(void *arg) {
    (void)arg;
    pthread_mutex_lock(&pool.lock);
    for (;;) {
        while (pool.count == 0 && !pool.stopping) pthread_cond_wait(&pool.ready, &pool.lock);
        if (pool.count == 0) break;
        Task task = pool.tasks[pool.head];
        pool.head = (pool.head + 1) % pool.capacity;
        pool.count--;
        pthread_mutex_unlock(&pool.lock);
        task.run(task.arg);
        pthread_mutex_lock(&pool.lock);
        if (--pool.pending == 0) pthread_cond_broadcast(&pool.idle);
    }
    pthread_mutex_unlock(&pool.lock);
    return NULL;
}

// Waits until every submitted task has run.
static void waitAll(void) {
    pthread_mutex_lock(&pool.lock);
    while (pool.pending > 0) pthread_cond_wait(&pool.idle, &pool.lock);
    pthread_mutex_unlock(&pool.lock);
}

static long *results;

static long work(long i) {
    long x = i;
    for (long k = 0; k < 100; k++) x = (x * 31 + k) % 1000003;
    return x;
}

static void compute(long i) {
    results[i] = work(i);
}

int main(int argc, char **argv) {
    long n = argc > 1 ? atol(argv[1]) : 100000;

    long threads = sysconf(_SC_NPROCESSORS_ONLN);
    if (threads < 1) threads = 1;
    pthread_t *workers = malloc(threads * sizeof(pthread_t));
    for (long i = 0; i < threads; i++) pthread_create(&workers[i], NULL, worker, NULL);

    results = calloc(n, sizeof(long));
    for (long i = 0; i < n; i++) submit(compute, i);
    waitAll();
    long sum = 0;
    for (long i = 0; i < n; i++) sum += results[i];
    printf("%ld %ld\n", n, sum);

    pthread_mutex_lock(&pool.lock);
    pool.stopping = true;
    pthread_cond_broadcast(&pool.ready);
    pthread_mutex_unlock(&pool.lock);
    for (long i = 0; i < threads; i++) pthread_join(workers[i], NULL);
    free(workers);
    free(results);
    free(pool.tasks);
    return 0;
}
