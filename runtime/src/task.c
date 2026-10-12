// Green threads ("tasks") on several OS threads ("workers"), M:N like Go.
//
// Tasks run until they wait (on a channel, a timer or a select) or yield;
// any worker runs any runnable task. Every task, including the one running
// `main`, has its own mmap'ed stack with a guard page. The program ends when
// `main` returns.
//
// Garbage collection: each worker tells the GC the stack bottom of the task
// it runs (GC_set_stackbottom), and a push-other-roots hook scans the used
// part of every task that is not running. Switching stacks is not atomic, so
// a worker switches inside a read lock of `switch_lock`, which the GC takes
// for writing before it stops the world.
//
// Waking before sleeping: a task that waits holds a lock (of a channel, or
// of the scheduler) that its wakers need, and releases it only after it has
// left its stack, in the worker's scheduler loop (`park`).
//
// Network I/O: sockets are non-blocking. A task whose socket is not ready
// parks, and a poller thread (kqueue or epoll) makes it runnable when the
// socket is, so waiting on the network occupies no worker.

// POSIX and GNU declarations of glibc (clock_gettime, mmap flags, ...), hidden by -std=c11.
#define _GNU_SOURCE

#include "ore.h"

#include <alloca.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

// Boehm GC, declared here so that the runtime builds without its headers.
struct GC_stack_base {
  void *mem_base;
};
void *GC_get_my_stackbottom(struct GC_stack_base *sb);
void GC_set_stackbottom(void *thread, const struct GC_stack_base *sb);
int GC_get_stack_base(struct GC_stack_base *sb);
void GC_allow_register_threads(void);
int GC_register_my_thread(const struct GC_stack_base *sb);
void GC_push_all_eager(void *bottom, void *top);
typedef void (*GC_push_other_roots_proc)(void);
void GC_set_push_other_roots(GC_push_other_roots_proc proc);
GC_push_other_roots_proc GC_get_push_other_roots(void);
typedef void (*GC_on_collection_event_proc)(int event);
void GC_set_on_collection_event(GC_on_collection_event_proc proc);
typedef void *(*GC_fn_type)(void *data);
void *GC_call_with_alloc_lock(GC_fn_type fn, void *data);
void *GC_malloc_uncollectable(size_t size);
void GC_free(void *p);
enum { GC_EVENT_PRE_STOP_WORLD = 6, GC_EVENT_POST_START_WORLD = 9 };

// Context switching: saves callee-saved registers on the current stack,
// stores the stack pointer in *save, and resumes the stack `load`.
void ore_ctx_switch(void **save, void *load);
// First code of a new task: calls task_main with the task from a saved register.
void ore_task_trampoline(void);

#if defined(__APPLE__)
#define SYM(name) "_" #name
#else
#define SYM(name) #name
#endif

#if defined(__aarch64__)
__asm__(".text\n"
        ".p2align 2\n"
        ".globl " SYM(ore_ctx_switch) "\n" SYM(ore_ctx_switch) ":\n"
        "  sub sp, sp, #160\n"
        "  stp x19, x20, [sp, #0]\n"
        "  stp x21, x22, [sp, #16]\n"
        "  stp x23, x24, [sp, #32]\n"
        "  stp x25, x26, [sp, #48]\n"
        "  stp x27, x28, [sp, #64]\n"
        "  stp x29, x30, [sp, #80]\n"
        "  stp d8, d9, [sp, #96]\n"
        "  stp d10, d11, [sp, #112]\n"
        "  stp d12, d13, [sp, #128]\n"
        "  stp d14, d15, [sp, #144]\n"
        "  mov x2, sp\n"
        "  str x2, [x0]\n"
        "  mov sp, x1\n"
        "  ldp x19, x20, [sp, #0]\n"
        "  ldp x21, x22, [sp, #16]\n"
        "  ldp x23, x24, [sp, #32]\n"
        "  ldp x25, x26, [sp, #48]\n"
        "  ldp x27, x28, [sp, #64]\n"
        "  ldp x29, x30, [sp, #80]\n"
        "  ldp d8, d9, [sp, #96]\n"
        "  ldp d10, d11, [sp, #112]\n"
        "  ldp d12, d13, [sp, #128]\n"
        "  ldp d14, d15, [sp, #144]\n"
        "  add sp, sp, #160\n"
        "  ret\n"
        ".p2align 2\n"
        ".globl " SYM(ore_task_trampoline) "\n" SYM(ore_task_trampoline) ":\n"
        "  mov x0, x19\n"
        "  bl " SYM(ore_task_main) "\n"
        "  brk #0\n");
#define FRAME_SIZE 160
#elif defined(__x86_64__)
__asm__(".text\n"
        ".globl " SYM(ore_ctx_switch) "\n" SYM(ore_ctx_switch) ":\n"
        "  pushq %rbp\n"
        "  pushq %rbx\n"
        "  pushq %r12\n"
        "  pushq %r13\n"
        "  pushq %r14\n"
        "  pushq %r15\n"
        "  movq %rsp, (%rdi)\n"
        "  movq %rsi, %rsp\n"
        "  popq %r15\n"
        "  popq %r14\n"
        "  popq %r13\n"
        "  popq %r12\n"
        "  popq %rbx\n"
        "  popq %rbp\n"
        "  ret\n"
        ".globl " SYM(ore_task_trampoline) "\n" SYM(ore_task_trampoline) ":\n"
        "  movq %rbx, %rdi\n"
        "  call " SYM(ore_task_main) "\n"
        "  ud2\n");
#else
#error "green threads support arm64 and x86_64"
#endif

typedef struct ore_task ore_task;

enum { TASK_RUNNABLE, TASK_BLOCKED, TASK_DONE };

struct ore_task {
  /** The stack pointer while not running. */
  void *sp;
  /** The mapping, its size, and the usable stack range [lo, hi). */
  u8 *map;
  size_t map_size;
  u8 *lo, *hi;
  ore_closure body;
  /** The shadow stack of debug frames while not running. */
  ore_frame *top;
  int state;
  /** Whether a worker runs the task: its stack is then scanned as the worker's. */
  bool running;
  /** Next task in the run queue or the timers. */
  ore_task *next;
  /** All live tasks, for the garbage collector. */
  ore_task *all_next, *all_prev;
  /** When a sleeping task wakes, in milliseconds. */
  i64 wake_at;
  /** The select the task waits in, if any, so that a timer can time it out. */
  struct select_state *select;
};

/** A select in progress: which case fired, or none yet. Claimed atomically by its first waker. */
typedef struct select_state {
  _Atomic i64 fired;
} select_state;

enum { SELECT_WAITING = -1, SELECT_TIMEOUT = -2 };

// Per worker.
static _Thread_local ore_task *current;
static _Thread_local void *scheduler_sp;
static _Thread_local void *gc_thread;
static _Thread_local struct GC_stack_base os_stack;
/** What to do once the current task has left its stack: release a lock, requeue it. */
static _Thread_local void (*after_park)(void *);
static _Thread_local void *after_park_arg;

// The scheduler: run queue, timers and workers, under `sched_lock`.
static pthread_mutex_t sched_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t sched_cond = PTHREAD_COND_INITIALIZER;
static ore_task *run_head, *run_tail;
static ore_task *timers;
static int workers, idle_workers, blocking_workers, max_workers;
/** Tasks parked until a socket is ready: not a deadlock while there are any. */
static int net_waiters;
static ore_task *main_task;

/** All live tasks; changed only with the GC's allocation lock held. */
static ore_task *all_tasks;
static GC_push_other_roots_proc previous_push;
static pthread_rwlock_t switch_lock = PTHREAD_RWLOCK_INITIALIZER;

#define MAIN_STACK_SIZE (8u << 20)
#define TASK_STACK_SIZE (256u << 10)

static i64 now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (i64)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

// ---------------------------------------------------------------------------
// Garbage collection

/** Pushes the used part of every task's stack that no worker is running. */
static void push_task_stacks(void) {
  for (ore_task *t = all_tasks; t; t = t->all_next) {
    if (!t->running && t->sp) GC_push_all_eager(t->sp, t->hi);
  }
  if (previous_push) previous_push();
}

/** Keeps the GC from stopping the world while a worker is between two stacks. */
static void on_collection_event(int event) {
  if (event == GC_EVENT_PRE_STOP_WORLD) pthread_rwlock_wrlock(&switch_lock);
  else if (event == GC_EVENT_POST_START_WORLD) pthread_rwlock_unlock(&switch_lock);
}

static void *link_task(void *data) {
  ore_task *t = data;
  t->all_next = all_tasks;
  if (all_tasks) all_tasks->all_prev = t;
  all_tasks = t;
  return NULL;
}

static void *unlink_task(void *data) {
  ore_task *t = data;
  if (t->all_prev) t->all_prev->all_next = t->all_next;
  else all_tasks = t->all_next;
  if (t->all_next) t->all_next->all_prev = t->all_prev;
  return NULL;
}

// ---------------------------------------------------------------------------
// Tasks

/** Makes a task runnable; the caller holds `sched_lock`. */
static void enqueue_locked(ore_task *t) {
  t->state = TASK_RUNNABLE;
  t->next = NULL;
  if (run_tail) run_tail->next = t;
  else run_head = t;
  run_tail = t;
  pthread_cond_signal(&sched_cond);
}

static void enqueue(ore_task *t) {
  pthread_mutex_lock(&sched_lock);
  enqueue_locked(t);
  pthread_mutex_unlock(&sched_lock);
}

void ore_task_main(ore_task *t);

static ore_task *task_new(ore_closure body, size_t stack_size) {
  ore_task *t = GC_malloc_uncollectable(sizeof(ore_task));
  memset(t, 0, sizeof *t);
  size_t page = (size_t)sysconf(_SC_PAGESIZE);
  t->map_size = stack_size + page;
  t->map = mmap(NULL, t->map_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
  if (t->map == MAP_FAILED) ore_rt_panic_cstr("cannot allocate a task stack");
  // The lowest page faults on stack overflow.
  mprotect(t->map, page, PROT_NONE);
  t->lo = t->map + page;
  t->hi = t->map + t->map_size;
  t->body = body;

  // An initial frame that the context switch "returns" through into the trampoline.
  u8 *top = (u8 *)((uintptr_t)t->hi & ~(uintptr_t)15);
#if defined(__aarch64__)
  void **frame = (void **)(top - FRAME_SIZE);
  memset(frame, 0, FRAME_SIZE);
  frame[0] = t;                                // x19
  frame[11] = (void *)ore_task_trampoline;     // x30
#else
  void **frame = (void **)(top - 8 - 7 * 8);
  memset(frame, 0, 8 * 8);
  frame[4] = t;                                // rbx
  frame[6] = (void *)ore_task_trampoline;      // return address
#endif
  t->sp = frame;
  GC_call_with_alloc_lock(link_task, t);
  return t;
}

static void task_free(ore_task *t) {
  GC_call_with_alloc_lock(unlink_task, t);
  munmap(t->map, t->map_size);
  GC_free(t);
}

/**
 * Suspends the current task. Once it has left its stack, the worker calls
 * `then(arg)`: typically releasing the lock that a waker of the task needs.
 */
static void park(void (*then)(void *), void *arg) {
  ore_task *t = current;
  t->top = ore_rt_top;
  after_park = then;
  after_park_arg = arg;
  pthread_rwlock_rdlock(&switch_lock);
  GC_set_stackbottom(gc_thread, &os_stack);
  t->running = false;
  ore_ctx_switch(&t->sp, scheduler_sp);
  // Resumed, maybe by another worker, which took the switch lock to get here.
  pthread_rwlock_unlock(&switch_lock);
  ore_rt_top = t->top;
}

static void unlock_mutex(void *m) { pthread_mutex_unlock(m); }

void ore_task_main(ore_task *t) {
  pthread_rwlock_unlock(&switch_lock);
  ((void (*)(void *))t->body.fn)(t->body.env);
  if (t == main_task) {
    // The program ends with main, as in Go.
    fflush(stdout);
    exit(0);
  }
  t->state = TASK_DONE;
  park(NULL, NULL);
}

void ore_rt_spawn(ore_closure body) { enqueue(task_new(body, TASK_STACK_SIZE)); }

static void requeue(void *t) { enqueue(t); }

void ore_rt_yield(void) { park(requeue, current); }

/** Inserts a task into the timers by wake time; the caller holds `sched_lock`. */
static void add_timer_locked(ore_task *t) {
  ore_task **p = &timers;
  while (*p && (*p)->wake_at <= t->wake_at) p = &(*p)->next;
  t->next = *p;
  *p = t;
  pthread_cond_signal(&sched_cond);
}

static void timers_remove_locked(ore_task *t) {
  for (ore_task **p = &timers; *p; p = &(*p)->next) {
    if (*p == t) {
      *p = t->next;
      return;
    }
  }
}

void ore_rt_sleep(i64 ms) {
  ore_task *t = current;
  t->wake_at = now_ms() + (ms > 0 ? ms : 0);
  t->state = TASK_BLOCKED;
  pthread_mutex_lock(&sched_lock);
  add_timer_locked(t);
  park(unlock_mutex, &sched_lock);
}

void *ore_rt_task_current(void) { return current; }

static void *worker_main(void *arg);

/** Starts another worker thread; the caller holds `sched_lock`. */
static void add_worker_locked(void) {
  pthread_t thread;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  if (pthread_create(&thread, &attr, worker_main, NULL) == 0) workers++;
  pthread_attr_destroy(&attr);
}

void ore_rt_blocking_enter(void) {
  pthread_mutex_lock(&sched_lock);
  blocking_workers++;
  // Other tasks keep running on another worker while this one blocks.
  if (run_head && idle_workers == 0 && workers < max_workers) add_worker_locked();
  pthread_mutex_unlock(&sched_lock);
}

void ore_rt_blocking_exit(void) {
  pthread_mutex_lock(&sched_lock);
  blocking_workers--;
  pthread_mutex_unlock(&sched_lock);
}

/** Moves tasks whose time has come from the timers to the run queue; the caller holds `sched_lock`. */
static void wake_timers_locked(void) {
  i64 now = now_ms();
  while (timers && timers->wake_at <= now) {
    ore_task *t = timers;
    timers = t->next;
    // A task waiting in a select wakes for its timeout unless a channel case fired first.
    if (t->select) {
      i64 waiting = SELECT_WAITING;
      if (!atomic_compare_exchange_strong(&t->select->fired, &waiting, SELECT_TIMEOUT)) continue;
    }
    enqueue_locked(t);
  }
}

/** The next task to run, waiting for one; panics when every task waits forever. */
static ore_task *next_task(void) {
  pthread_mutex_lock(&sched_lock);
  for (;;) {
    wake_timers_locked();
    ore_task *t = run_head;
    if (t) {
      run_head = t->next;
      if (!run_head) run_tail = NULL;
      pthread_mutex_unlock(&sched_lock);
      return t;
    }
    if (!timers && blocking_workers == 0 && net_waiters == 0 && idle_workers == workers - 1) {
      pthread_mutex_unlock(&sched_lock);
      current = main_task;
      ore_rt_top = main_task->top;
      ore_rt_panic_cstr("all tasks are asleep - deadlock!");
    }
    idle_workers++;
    if (timers) {
      i64 wait = timers->wake_at - now_ms();
      if (wait < 0) wait = 0;
      struct timespec deadline;
      clock_gettime(CLOCK_REALTIME, &deadline);
      deadline.tv_sec += wait / 1000;
      deadline.tv_nsec += (wait % 1000) * 1000000;
      if (deadline.tv_nsec >= 1000000000) {
        deadline.tv_sec++;
        deadline.tv_nsec -= 1000000000;
      }
      pthread_cond_timedwait(&sched_cond, &sched_lock, &deadline);
    } else {
      pthread_cond_wait(&sched_cond, &sched_lock);
    }
    idle_workers--;
  }
}

/** A worker: runs tasks until the program ends. */
static void schedule(void) {
  for (;;) {
    ore_task *t = next_task();
    current = t;
    ore_rt_top = t->top;
    pthread_rwlock_rdlock(&switch_lock);
    GC_set_stackbottom(gc_thread, &(struct GC_stack_base){t->hi});
    t->running = true;
    ore_ctx_switch(&scheduler_sp, t->sp);
    // The task parked or ended, holding the switch lock.
    pthread_rwlock_unlock(&switch_lock);
    current = NULL;
    void (*then)(void *) = after_park;
    after_park = NULL;
    if (then) then(after_park_arg);
    if (t->state == TASK_DONE) task_free(t);
  }
}

static void *worker_main(void *arg) {
  (void)arg;
  struct GC_stack_base sb;
  GC_get_stack_base(&sb);
  GC_register_my_thread(&sb);
  gc_thread = GC_get_my_stackbottom(&os_stack);
  schedule();
  return NULL;
}

static void entry_body(void *env) { ((void (*)(void))env)(); }

void ore_rt_run_main(void (*entry)(void)) {
  GC_allow_register_threads();
  gc_thread = GC_get_my_stackbottom(&os_stack);
  previous_push = GC_get_push_other_roots();
  GC_set_push_other_roots(push_task_stacks);
  GC_set_on_collection_event(on_collection_event);

  // Workers: ORE_THREADS, or one per CPU. Blocking calls may add more.
  long cpus = sysconf(_SC_NPROCESSORS_ONLN);
  const char *configured = getenv("ORE_THREADS");
  int count = configured ? atoi(configured) : (int)(cpus > 0 ? cpus : 1);
  if (count < 1) count = 1;
  max_workers = count + 64;

  main_task = task_new((ore_closure){(void *)entry_body, (void *)entry}, MAIN_STACK_SIZE);
  pthread_mutex_lock(&sched_lock);
  workers = 1;
  enqueue_locked(main_task);
  for (int i = 1; i < count; i++) add_worker_locked();
  pthread_mutex_unlock(&sched_lock);
  schedule();
}

// ---------------------------------------------------------------------------
// Network polling

#if defined(__APPLE__) || defined(__FreeBSD__)
#include <sys/event.h>
#define ORE_KQUEUE 1
#else
#include <sys/epoll.h>
#endif

static int poll_fd = -1;
static pthread_once_t poll_once = PTHREAD_ONCE_INIT;

/** Makes the tasks whose sockets are ready runnable. */
static void *poller_main(void *arg) {
  (void)arg;
  for (;;) {
#ifdef ORE_KQUEUE
    struct kevent events[64];
    int n = kevent(poll_fd, NULL, 0, events, 64, NULL);
#else
    struct epoll_event events[64];
    int n = epoll_wait(poll_fd, events, 64, -1);
#endif
    if (n <= 0) continue;
    pthread_mutex_lock(&sched_lock);
    for (int i = 0; i < n; i++) {
#ifdef ORE_KQUEUE
      ore_task *t = events[i].udata;
#else
      ore_task *t = events[i].data.ptr;
#endif
      net_waiters--;
      enqueue_locked(t);
    }
    pthread_mutex_unlock(&sched_lock);
  }
  return NULL;
}

static void poll_init(void) {
#ifdef ORE_KQUEUE
  poll_fd = kqueue();
#else
  poll_fd = epoll_create1(EPOLL_CLOEXEC);
#endif
  if (poll_fd < 0) ore_rt_panic_cstr("cannot create the network poller");
  pthread_t thread;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  if (pthread_create(&thread, &attr, poller_main, NULL) != 0) ore_rt_panic_cstr("cannot start the network poller");
  pthread_attr_destroy(&attr);
}

typedef struct {
  int fd;
  bool write;
  ore_task *task;
} poll_wait;

/** Registers a parked task for one readiness event of its socket; runs after it left its stack. */
static void register_wait(void *arg) {
  poll_wait *w = arg;
  ore_task *t = w->task;
#ifdef ORE_KQUEUE
  struct kevent change;
  EV_SET(&change, w->fd, w->write ? EVFILT_WRITE : EVFILT_READ, EV_ADD | EV_ONESHOT, 0, 0, t);
  int failed = kevent(poll_fd, &change, 1, NULL, 0, NULL) < 0;
#else
  struct epoll_event event = {.events = (w->write ? EPOLLOUT : EPOLLIN) | EPOLLONESHOT, .data.ptr = t};
  int failed = epoll_ctl(poll_fd, EPOLL_CTL_MOD, w->fd, &event) < 0 && epoll_ctl(poll_fd, EPOLL_CTL_ADD, w->fd, &event) < 0;
#endif
  // The task retries its operation, which reports the error.
  if (failed) {
    pthread_mutex_lock(&sched_lock);
    net_waiters--;
    enqueue_locked(t);
    pthread_mutex_unlock(&sched_lock);
  }
}

void ore_rt_net_wait(int fd, bool write) {
  pthread_once(&poll_once, poll_init);
  poll_wait w = {fd, write, current};
  pthread_mutex_lock(&sched_lock);
  net_waiters++;
  pthread_mutex_unlock(&sched_lock);
  park(register_wait, &w);
}

// ---------------------------------------------------------------------------
// Channels

/** A task waiting in a channel queue, in the task's own stack frame. */
struct ore_waiter {
  ore_task *task;
  /** The value to send, or where to put the received value. */
  void *slot;
  /** Whether the operation completed with a value (false when the channel closed). */
  bool ok;
  /** For a select: its state and the index of this case. */
  select_state *select;
  i64 index;
  ore_waiter *next;
};

static void wait_push(ore_waiter **queue, ore_waiter *w) {
  w->next = NULL;
  while (*queue) queue = &(*queue)->next;
  *queue = w;
}

static void wait_remove(ore_waiter **queue, ore_waiter *w) {
  for (; *queue; queue = &(*queue)->next) {
    if (*queue == w) {
      *queue = w->next;
      return;
    }
  }
}

/** Whether a waiter belongs to a select that another case already completed. */
static bool stale(ore_waiter *w) { return w->select && atomic_load(&w->select->fired) != SELECT_WAITING; }

/** Takes the first waiter that can still complete, claiming its select; drops stale ones. */
static ore_waiter *wait_take(ore_waiter **queue) {
  for (ore_waiter *w; (w = *queue);) {
    *queue = w->next;
    if (w->select) {
      i64 waiting = SELECT_WAITING;
      if (!atomic_compare_exchange_strong(&w->select->fired, &waiting, w->index)) continue;
      // This case fired; the select stops waiting on its timer.
      pthread_mutex_lock(&sched_lock);
      timers_remove_locked(w->task);
      pthread_mutex_unlock(&sched_lock);
    }
    return w;
  }
  return NULL;
}

static bool has_waiter(ore_waiter *queue) {
  for (; queue; queue = queue->next) if (!stale(queue)) return true;
  return false;
}

/** Completes a waiter's operation and makes its task runnable. */
static void wake(ore_waiter *w, bool ok) {
  w->ok = ok;
  enqueue(w->task);
}

ore_chan *ore_rt_chan_new(i64 elem_size, i64 cap) {
  if (cap < 0) ore_rt_panic_cstr("negative channel capacity");
  ore_chan *c = ore_rt_alloc(sizeof(ore_chan));
  c->elem_size = elem_size;
  c->cap = cap;
  c->buf = ore_rt_alloc(elem_size * (cap > 0 ? cap : 1));
  c->lock = ore_rt_alloc(sizeof(pthread_mutex_t));
  pthread_mutex_init(c->lock, NULL);
  return c;
}

static void *slot_at(ore_chan *c, i64 i) { return c->buf + ((c->head + i) % c->cap) * c->elem_size; }

/** Whether a receive would complete now; the caller holds the channel's lock. */
static bool can_recv(ore_chan *c) { return c->len > 0 || has_waiter(c->senders) || c->closed; }

/** Sends without waiting; the caller holds the lock and checked that it can. */
static void send_now(ore_chan *c, const void *value) {
  ore_waiter *r = wait_take(&c->receivers);
  if (r) {
    memcpy(r->slot, value, (size_t)c->elem_size);
    wake(r, true);
  } else {
    memcpy(slot_at(c, c->len++), value, (size_t)c->elem_size);
  }
}

/** Receives without waiting; the caller holds the lock and checked can_recv. False once closed and empty. */
static bool recv_now(ore_chan *c, void *out) {
  if (c->len > 0) {
    memcpy(out, slot_at(c, 0), (size_t)c->elem_size);
    c->head = (c->head + 1) % c->cap;
    c->len--;
    // A waiting sender's value takes the freed place.
    ore_waiter *s = wait_take(&c->senders);
    if (s) {
      memcpy(slot_at(c, c->len++), s->slot, (size_t)c->elem_size);
      wake(s, true);
    }
    return true;
  }
  ore_waiter *s = wait_take(&c->senders);
  if (s) {
    memcpy(out, s->slot, (size_t)c->elem_size);
    wake(s, true);
    return true;
  }
  memset(out, 0, (size_t)c->elem_size);
  return false;
}

void ore_rt_chan_send(ore_chan *c, const void *value) {
  pthread_mutex_lock(c->lock);
  if (c->closed) {
    pthread_mutex_unlock(c->lock);
    ore_rt_panic_cstr("send on closed channel");
  }
  if (has_waiter(c->receivers) || c->len < c->cap) {
    send_now(c, value);
    pthread_mutex_unlock(c->lock);
    return;
  }
  ore_waiter w = {current, (void *)value, false, NULL, 0, NULL};
  wait_push(&c->senders, &w);
  current->state = TASK_BLOCKED;
  park(unlock_mutex, c->lock);
  if (!w.ok) ore_rt_panic_cstr("send on closed channel");
}

bool ore_rt_chan_recv(ore_chan *c, void *out) {
  pthread_mutex_lock(c->lock);
  if (can_recv(c)) {
    bool ok = recv_now(c, out);
    pthread_mutex_unlock(c->lock);
    return ok;
  }
  ore_waiter w = {current, out, false, NULL, 0, NULL};
  wait_push(&c->receivers, &w);
  current->state = TASK_BLOCKED;
  park(unlock_mutex, c->lock);
  if (!w.ok) memset(out, 0, (size_t)c->elem_size);
  return w.ok;
}

void ore_rt_chan_close(ore_chan *c) {
  pthread_mutex_lock(c->lock);
  if (c->closed) {
    pthread_mutex_unlock(c->lock);
    ore_rt_panic_cstr("close of closed channel");
  }
  c->closed = true;
  for (ore_waiter *w; (w = wait_take(&c->receivers));) {
    memset(w->slot, 0, (size_t)c->elem_size);
    wake(w, false);
  }
  for (ore_waiter *w; (w = wait_take(&c->senders));) wake(w, false);
  pthread_mutex_unlock(c->lock);
}

// ---------------------------------------------------------------------------
// Select

enum { CASE_RECV, CASE_SEND, CASE_AFTER };

struct ore_select_case {
  int kind;
  ore_chan *chan;
  i64 ms;
  /** The value to send, or the received value. */
  void *buf;
  /** Whether a receive got a value (false when the channel closed). */
  bool ok;
  ore_closure handler;
  /** Calls the handler of a receive case with the value. */
  void (*dispatch)(ore_select_case *c);
};

ore_select_case *ore_rt_case_recv(ore_chan *c, ore_closure handler, void (*dispatch)(ore_select_case *)) {
  ore_select_case *s = ore_rt_alloc(sizeof(ore_select_case));
  *s = (ore_select_case){CASE_RECV, c, 0, ore_rt_alloc(c->elem_size), false, handler, dispatch};
  return s;
}

ore_select_case *ore_rt_case_send(ore_chan *c, const void *value, ore_closure handler) {
  ore_select_case *s = ore_rt_alloc(sizeof(ore_select_case));
  *s = (ore_select_case){CASE_SEND, c, 0, ore_rt_alloc(c->elem_size), false, handler, NULL};
  memcpy(s->buf, value, (size_t)c->elem_size);
  return s;
}

ore_select_case *ore_rt_case_after(i64 ms, ore_closure handler) {
  ore_select_case *s = ore_rt_alloc(sizeof(ore_select_case));
  *s = (ore_select_case){CASE_AFTER, NULL, ms, NULL, false, handler, NULL};
  return s;
}

void *ore_rt_case_value(ore_select_case *c, bool *ok) {
  *ok = c->ok;
  return c->buf;
}

ore_closure ore_rt_case_handler(ore_select_case *c) { return c->handler; }

static void run_case(ore_select_case *c) {
  if (c->kind == CASE_RECV) c->dispatch(c);
  else ((void (*)(void *))c->handler.fn)(c->handler.env);
}

/** The channel locks of a select, sorted and without duplicates so that they lock in one order. */
typedef struct {
  pthread_mutex_t **locks;
  i64 count;
} lock_set;

static int compare_locks(const void *a, const void *b) {
  uintptr_t x = (uintptr_t) * (pthread_mutex_t *const *)a, y = (uintptr_t) * (pthread_mutex_t *const *)b;
  return x < y ? -1 : x > y;
}

static void lock_all(lock_set *s) {
  for (i64 i = 0; i < s->count; i++) pthread_mutex_lock(s->locks[i]);
}

static void unlock_all(void *arg) {
  lock_set *s = arg;
  for (i64 i = s->count - 1; i >= 0; i--) pthread_mutex_unlock(s->locks[i]);
}

/** After a select's task has left its stack: start its timeout, then release the channel locks. */
typedef struct {
  lock_set *locks;
  ore_task *timed;
} park_select;

static void time_and_unlock(void *arg) {
  park_select *p = arg;
  if (p->timed) {
    pthread_mutex_lock(&sched_lock);
    add_timer_locked(p->timed);
    pthread_mutex_unlock(&sched_lock);
  }
  unlock_all(p->locks);
}

void ore_rt_select(ore_array *cases, ore_closure otherwise) {
  i64 n = cases->len;
  ore_select_case **cs = cases->data;
  lock_set locks = {alloca((size_t)(n > 0 ? n : 1) * sizeof(pthread_mutex_t *)), 0};
  for (i64 k = 0; k < n; k++) {
    if (cs[k]->kind != CASE_AFTER) locks.locks[locks.count++] = cs[k]->chan->lock;
  }
  qsort(locks.locks, (size_t)locks.count, sizeof(pthread_mutex_t *), compare_locks);
  i64 unique = 0;
  for (i64 i = 0; i < locks.count; i++) {
    if (unique == 0 || locks.locks[i] != locks.locks[unique - 1]) locks.locks[unique++] = locks.locks[i];
  }
  locks.count = unique;
  lock_all(&locks);

  // A case that can proceed now, starting at a random one for fairness.
  i64 start = n > 0 ? (i64)(ore_rt_random() * (f64)n) : 0;
  for (i64 k = 0; k < n; k++) {
    ore_select_case *c = cs[(start + k) % n];
    if (c->kind == CASE_RECV && can_recv(c->chan)) {
      c->ok = recv_now(c->chan, c->buf);
      unlock_all(&locks);
      return run_case(c);
    }
    if (c->kind == CASE_SEND) {
      if (c->chan->closed) {
        unlock_all(&locks);
        ore_rt_panic_cstr("send on closed channel");
      }
      if (has_waiter(c->chan->receivers) || c->chan->len < c->chan->cap) {
        send_now(c->chan, c->buf);
        unlock_all(&locks);
        return run_case(c);
      }
    }
    if (c->kind == CASE_AFTER && c->ms <= 0) {
      unlock_all(&locks);
      return run_case(c);
    }
  }
  if (otherwise.fn) {
    unlock_all(&locks);
    return ((void (*)(void *))otherwise.fn)(otherwise.env);
  }

  // Wait on every channel and on the earliest timeout at once.
  select_state state = {SELECT_WAITING};
  ore_waiter *waiters = alloca((size_t)(n > 0 ? n : 1) * sizeof(ore_waiter));
  ore_select_case *timeout = NULL;
  for (i64 k = 0; k < n; k++) {
    ore_select_case *c = cs[k];
    if (c->kind == CASE_AFTER) {
      if (!timeout || c->ms < timeout->ms) timeout = c;
      continue;
    }
    waiters[k] = (ore_waiter){current, c->buf, false, &state, k, NULL};
    wait_push(c->kind == CASE_RECV ? &c->chan->receivers : &c->chan->senders, &waiters[k]);
  }
  ore_task *t = current;
  t->select = &state;
  if (timeout) t->wake_at = now_ms() + timeout->ms;
  t->state = TASK_BLOCKED;
  // The channel locks are held until the task has left its stack and its timer
  // is set, so no case can fire before.
  park_select p = {&locks, timeout ? t : NULL};
  park(time_and_unlock, &p);

  // Woken by one case or by the timeout; leave the other queues.
  lock_all(&locks);
  t->select = NULL;
  for (i64 k = 0; k < n; k++) {
    ore_select_case *c = cs[k];
    if (c->kind != CASE_AFTER) wait_remove(c->kind == CASE_RECV ? &c->chan->receivers : &c->chan->senders, &waiters[k]);
  }
  unlock_all(&locks);
  i64 fired = atomic_load(&state.fired);
  if (fired == SELECT_TIMEOUT) return run_case(timeout);
  ore_select_case *c = cs[fired];
  if (c->kind == CASE_SEND && !waiters[fired].ok) ore_rt_panic_cstr("send on closed channel");
  c->ok = waiters[fired].ok;
  run_case(c);
}
