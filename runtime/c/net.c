// TCP on non-blocking sockets. An operation that would block parks its task
// until the poller sees the socket ready (ore_rt_net_wait), then retries.

// POSIX and GNU declarations of glibc (clock_gettime, mmap flags, ...), hidden by -std=c11.
#define _GNU_SOURCE

#include "ore.h"

#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

// Boehm GC, as in runtime.c.
void *GC_malloc_atomic(size_t size);

/** Memory for bytes, which the GC does not scan. Not zeroed. */
static u8 *alloc_bytes(i64 size) {
  u8 *p = GC_malloc_atomic(size > 0 ? (size_t)size : 1);
  if (!p) ore_rt_panic_cstr("out of memory");
  return p;
}

/** A NUL-terminated copy of a string, for C APIs. */
static char *c_string(ore_string s) {
  char *p = (char *)alloc_bytes(s.len + 1);
  memcpy(p, s.ptr, (size_t)s.len);
  p[s.len] = 0;
  return p;
}

static ore_string message(const char *what, int error) {
  char buf[256];
  int n = snprintf(buf, sizeof buf, "%s: %s", what, strerror(error));
  u8 *copy = alloc_bytes(n);
  memcpy(copy, buf, (size_t)n);
  return (ore_string){copy, n};
}

static ore_string lookup_message(int error) {
  char buf[256];
  int n = snprintf(buf, sizeof buf, "cannot resolve host: %s", gai_strerror(error));
  u8 *copy = alloc_bytes(n);
  memcpy(copy, buf, (size_t)n);
  return (ore_string){copy, n};
}

static pthread_once_t init_once = PTHREAD_ONCE_INIT;

/** A write to a closed socket reports EPIPE instead of killing the process. */
static void init(void) { signal(SIGPIPE, SIG_IGN); }

static void configure(int fd) {
  fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
  fcntl(fd, F_SETFD, FD_CLOEXEC);
#ifdef SO_NOSIGPIPE
  int one = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
}

/** Resolves a host and port; name lookup blocks, so another worker takes over meanwhile. */
static int resolve(ore_string host, i64 port, bool passive, struct addrinfo **out) {
  char service[16];
  snprintf(service, sizeof service, "%lld", (long long)port);
  struct addrinfo hints = {0};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  if (passive) hints.ai_flags = AI_PASSIVE;
  const char *name = host.len > 0 ? c_string(host) : NULL;
  ore_rt_blocking_enter();
  int error = getaddrinfo(name, service, &hints, out);
  ore_rt_blocking_exit();
  return error;
}

bool ore_rt_net_listen(ore_string host, i64 port, i64 *fd, ore_string *err) {
  pthread_once(&init_once, init);
  if (port < 0 || port > 65535) return *err = ORE_STR("listen: port out of range"), false;
  struct addrinfo *addresses;
  int error = resolve(host, port, true, &addresses);
  if (error) return *err = lookup_message(error), false;
  int saved = 0;
  for (struct addrinfo *a = addresses; a; a = a->ai_next) {
    int s = socket(a->ai_family, a->ai_socktype, a->ai_protocol);
    if (s < 0) {
      saved = errno;
      continue;
    }
    int one = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    if (bind(s, a->ai_addr, a->ai_addrlen) == 0 && listen(s, 128) == 0) {
      freeaddrinfo(addresses);
      configure(s);
      *fd = s;
      return true;
    }
    saved = errno;
    close(s);
  }
  freeaddrinfo(addresses);
  *err = message("listen", saved);
  return false;
}

bool ore_rt_net_connect(ore_string host, i64 port, i64 *fd, ore_string *err) {
  pthread_once(&init_once, init);
  if (port < 0 || port > 65535) return *err = ORE_STR("connect: port out of range"), false;
  struct addrinfo *addresses;
  int error = resolve(host, port, false, &addresses);
  if (error) return *err = lookup_message(error), false;
  int saved = 0;
  for (struct addrinfo *a = addresses; a; a = a->ai_next) {
    int s = socket(a->ai_family, a->ai_socktype, a->ai_protocol);
    if (s < 0) {
      saved = errno;
      continue;
    }
    configure(s);
    int result = connect(s, a->ai_addr, a->ai_addrlen);
    if (result < 0 && errno == EINPROGRESS) {
      ore_rt_net_wait(s, true);
      socklen_t len = sizeof saved;
      getsockopt(s, SOL_SOCKET, SO_ERROR, &saved, &len);
      result = saved == 0 ? 0 : -1;
    } else if (result < 0) {
      saved = errno;
    }
    if (result == 0) {
      freeaddrinfo(addresses);
      int one = 1;
      setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
      *fd = s;
      return true;
    }
    close(s);
  }
  freeaddrinfo(addresses);
  *err = message("connect", saved);
  return false;
}

bool ore_rt_net_accept(i64 listener, i64 *fd, ore_string *err) {
  for (;;) {
    int s = accept((int)listener, NULL, NULL);
    if (s >= 0) {
      configure(s);
      int one = 1;
      setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
      *fd = s;
      return true;
    }
    if (errno == EAGAIN || errno == EWOULDBLOCK) ore_rt_net_wait((int)listener, false);
    else if (errno != EINTR && errno != ECONNABORTED) return *err = message("accept", errno), false;
  }
}

bool ore_rt_net_read(i64 fd, i64 max, ore_string *data) {
  if (max <= 0) return *data = ORE_STR("read: the size must be positive"), false;
  u8 *buf = alloc_bytes(max);
  for (;;) {
    ssize_t n = recv((int)fd, buf, (size_t)max, 0);
    if (n >= 0) return *data = (ore_string){buf, n}, true;
    if (errno == EAGAIN || errno == EWOULDBLOCK) ore_rt_net_wait((int)fd, false);
    else if (errno != EINTR) return *data = message("read", errno), false;
  }
}

bool ore_rt_net_write(i64 fd, ore_string data, ore_string *err) {
#ifdef MSG_NOSIGNAL
  int flags = MSG_NOSIGNAL;
#else
  int flags = 0;
#endif
  i64 done = 0;
  while (done < data.len) {
    ssize_t n = send((int)fd, data.ptr + done, (size_t)(data.len - done), flags);
    if (n >= 0) done += n;
    else if (errno == EAGAIN || errno == EWOULDBLOCK) ore_rt_net_wait((int)fd, true);
    else if (errno != EINTR) return *err = message("write", errno), false;
  }
  return true;
}

void ore_rt_net_close(i64 fd) { close((int)fd); }

i64 ore_rt_net_port(i64 fd) {
  struct sockaddr_storage address;
  socklen_t len = sizeof address;
  if (getsockname((int)fd, (struct sockaddr *)&address, &len) < 0) return -1;
  if (address.ss_family == AF_INET6) return ntohs(((struct sockaddr_in6 *)&address)->sin6_port);
  return ntohs(((struct sockaddr_in *)&address)->sin_port);
}
