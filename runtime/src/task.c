// Green threads ("tasks") on one OS thread: cooperative scheduling with a run
// queue and timers. Every task, including the one running `main`, has its own
// mmap'ed stack with a guard page. The program ends when `main` returns.
//
// The garbage collector scans the running task's stack as the thread stack
// (GC_set_stackbottom) and the used part of every suspended task's stack
// through a push-other-roots hook.

#include "ore.h"

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
void GC_push_all_eager(void *bottom, void *top);
typedef void (*GC_push_other_roots_proc)(void);
void GC_set_push_other_roots(GC_push_other_roots_proc proc);
GC_push_other_roots_proc GC_get_push_other_roots(void);
void *GC_malloc_uncollectable(size_t size);
void GC_free(void *p);

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
  /** The stack pointer while suspended. */
  void *sp;
  /** The mapping, its size, and the usable stack range [lo, hi). */
  u8 *map;
  size_t map_size;
  u8 *lo, *hi;
  ore_closure body;
  /** The shadow stack of debug frames while suspended. */
  ore_frame *top;
  int state;
  /** Next task in the run queue, a timer list or a wait queue. */
  ore_task *next;
  /** All live tasks, for the garbage collector. */
  ore_task *all_next, *all_prev;
  /** When a sleeping task wakes, in milliseconds. */
  i64 wake_at;
  /** For channel operations: the value being sent or received, and whether it succeeded. */
  void *slot;
  bool ok;
};

static ore_task *current;
static ore_task *main_task;
static void *scheduler_sp;
static struct GC_stack_base os_stack;
static ore_task *run_head, *run_tail;
static ore_task *timers;
static ore_task *all_tasks;
static GC_push_other_roots_proc previous_push;

#define MAIN_STACK_SIZE (8u << 20)
#define TASK_STACK_SIZE (256u << 10)

static i64 now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (i64)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

/** Pushes the used part of every suspended task's stack. */
static void push_task_stacks(void) {
  for (ore_task *t = all_tasks; t; t = t->all_next) {
    if (t != current && t->sp) GC_push_all_eager(t->sp, t->hi);
  }
  if (previous_push) previous_push();
}

static void enqueue(ore_task *t) {
  t->state = TASK_RUNNABLE;
  t->next = NULL;
  if (run_tail) run_tail->next = t;
  else run_head = t;
  run_tail = t;
}

static ore_task *dequeue(void) {
  ore_task *t = run_head;
  if (t) {
    run_head = t->next;
    if (!run_head) run_tail = NULL;
  }
  return t;
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

  t->all_next = all_tasks;
  if (all_tasks) all_tasks->all_prev = t;
  all_tasks = t;
  return t;
}

static void task_free(ore_task *t) {
  if (t->all_prev) t->all_prev->all_next = t->all_next;
  else all_tasks = t->all_next;
  if (t->all_next) t->all_next->all_prev = t->all_prev;
  munmap(t->map, t->map_size);
  GC_free(t);
}

/** Suspends the current task until something makes it runnable again. */
static void park(void) {
  ore_task *t = current;
  t->top = ore_rt_top;
  ore_ctx_switch(&t->sp, scheduler_sp);
  ore_rt_top = t->top;
}

void ore_task_main(ore_task *t) {
  ((void (*)(void *))t->body.fn)(t->body.env);
  if (t == main_task) {
    // The program ends with main, as in Go.
    fflush(stdout);
    exit(0);
  }
  t->state = TASK_DONE;
  park();
}

void ore_rt_spawn(ore_closure body) { enqueue(task_new(body, TASK_STACK_SIZE)); }

void ore_rt_yield(void) {
  enqueue(current);
  park();
}

void ore_rt_sleep(i64 ms) {
  ore_task *t = current;
  t->wake_at = now_ms() + (ms > 0 ? ms : 0);
  t->state = TASK_BLOCKED;
  ore_task **p = &timers;
  while (*p && (*p)->wake_at <= t->wake_at) p = &(*p)->next;
  t->next = *p;
  *p = t;
  park();
}

void ore_rt_task_block(void) {
  current->state = TASK_BLOCKED;
  park();
}

void *ore_rt_task_current(void) { return current; }

void ore_rt_task_wake(void *task) { enqueue(task); }

/** Moves tasks whose time has come from the timers to the run queue. */
static void wake_timers(void) {
  i64 now = now_ms();
  while (timers && timers->wake_at <= now) {
    ore_task *t = timers;
    timers = t->next;
    enqueue(t);
  }
}

static void entry_body(void *env) { ((void (*)(void))env)(); }

void ore_rt_run_main(void (*entry)(void)) {
  GC_get_my_stackbottom(&os_stack);
  previous_push = GC_get_push_other_roots();
  GC_set_push_other_roots(push_task_stacks);
  main_task = task_new((ore_closure){(void *)entry_body, (void *)entry}, MAIN_STACK_SIZE);
  enqueue(main_task);

  for (;;) {
    wake_timers();
    ore_task *t = dequeue();
    if (!t) {
      if (!timers) {
        current = main_task;
        ore_rt_top = main_task->top;
        ore_rt_panic_cstr("all tasks are asleep - deadlock!");
      }
      i64 wait = timers->wake_at - now_ms();
      if (wait > 0) nanosleep(&(struct timespec){wait / 1000, (wait % 1000) * 1000000}, NULL);
      continue;
    }
    current = t;
    ore_rt_top = t->top;
    GC_set_stackbottom(NULL, &(struct GC_stack_base){t->hi});
    void *sp = t->sp;
    ore_ctx_switch(&scheduler_sp, sp);
    GC_set_stackbottom(NULL, &os_stack);
    current = NULL;
    if (t->state == TASK_DONE) task_free(t);
  }
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
  ore_waiter *next;
};

static void wait_push(ore_waiter **queue, ore_waiter *w) {
  w->next = NULL;
  while (*queue) queue = &(*queue)->next;
  *queue = w;
}

static ore_waiter *wait_pop(ore_waiter **queue) {
  ore_waiter *w = *queue;
  if (w) *queue = w->next;
  return w;
}

ore_chan *ore_rt_chan_new(i64 elem_size, i64 cap) {
  if (cap < 0) ore_rt_panic_cstr("negative channel capacity");
  ore_chan *c = ore_rt_alloc(sizeof(ore_chan));
  c->elem_size = elem_size;
  c->cap = cap;
  c->buf = ore_rt_alloc(elem_size * (cap > 0 ? cap : 1));
  return c;
}

static void *slot_at(ore_chan *c, i64 i) { return c->buf + ((c->head + i) % c->cap) * c->elem_size; }

void ore_rt_chan_send(ore_chan *c, const void *value) {
  if (c->closed) ore_rt_panic_cstr("send on closed channel");
  ore_waiter *r = wait_pop(&c->receivers);
  if (r) {
    // A receiver is waiting: hand the value over directly.
    memcpy(r->slot, value, (size_t)c->elem_size);
    r->ok = true;
    enqueue(r->task);
    return;
  }
  if (c->len < c->cap) {
    memcpy(slot_at(c, c->len++), value, (size_t)c->elem_size);
    return;
  }
  ore_waiter w = {current, (void *)value, false, NULL};
  wait_push(&c->senders, &w);
  current->state = TASK_BLOCKED;
  park();
  if (!w.ok) ore_rt_panic_cstr("send on closed channel");
}

bool ore_rt_chan_recv(ore_chan *c, void *out) {
  if (c->len > 0) {
    memcpy(out, slot_at(c, 0), (size_t)c->elem_size);
    c->head = (c->head + 1) % c->cap;
    c->len--;
    // A waiting sender's value takes the freed place.
    ore_waiter *s = wait_pop(&c->senders);
    if (s) {
      memcpy(slot_at(c, c->len++), s->slot, (size_t)c->elem_size);
      s->ok = true;
      enqueue(s->task);
    }
    return true;
  }
  ore_waiter *s = wait_pop(&c->senders);
  if (s) {
    memcpy(out, s->slot, (size_t)c->elem_size);
    s->ok = true;
    enqueue(s->task);
    return true;
  }
  if (c->closed) {
    memset(out, 0, (size_t)c->elem_size);
    return false;
  }
  ore_waiter w = {current, out, false, NULL};
  wait_push(&c->receivers, &w);
  current->state = TASK_BLOCKED;
  park();
  if (!w.ok) memset(out, 0, (size_t)c->elem_size);
  return w.ok;
}

void ore_rt_chan_close(ore_chan *c) {
  if (c->closed) ore_rt_panic_cstr("close of closed channel");
  c->closed = true;
  for (ore_waiter *w; (w = wait_pop(&c->receivers));) enqueue(w->task);
  for (ore_waiter *w; (w = wait_pop(&c->senders));) enqueue(w->task);
}
