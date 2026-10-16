# Standard modules

Besides the built-in namespaces, which every module sees (`console`,
`process`, `fs`, `time` and the others, see
[built-in namespaces](02-types.md#built-in-namespaces)), the standard
library has modules that a program imports by an `ore:` name. They are
embedded in the compiler and written in Ore (`runtime/std`):

| Module | Contents | Described in |
| --- | --- | --- |
| `ore:test` | `test`, `describe`, the hooks and `expect`, for `ore test` | [Tests](08-tests.md) |
| `ore:sync` | `Mutex` and `WaitGroup` | [Concurrency](06-concurrency.md) |
| `ore:net` | TCP: `listen`, `connect`, `Listener` and `Conn` | [Concurrency](06-concurrency.md) |
| `ore:tls` | TLS over TCP, from the system's OpenSSL 3: `connect`, `createServer`, `Connection` and `Server` | [below](#oretls) |
| `ore:crypto` | SHA-256 and random UUIDs | [below](#orecrypto) |
| `ore:path` | file paths, as Node's `node:path` | [below](#orepath) |

```ts
import { join } from "ore:path"
import { randomUUIDv7 } from "ore:crypto"

console.log(join("out", "..", "logs", `${randomUUIDv7()}.txt`))
```

## ore:crypto

- `sha256(data)` is the SHA-256 digest (FIPS 180-4) of the UTF-8 bytes of a
  string, as 64 lowercase hexadecimal characters: `sha256("abc")` is
  `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`.
- `new Sha256()` is an incremental hasher: `update(data)` adds a string and
  returns the hasher, and `hex()` gives the digest of everything added, so
  `new Sha256().update(a).update(b).hex()` equals `sha256(a + b)`.
- `randomUUIDv4()` is a random UUID of version 4 (RFC 9562): 122 random
  bits, written as `xxxxxxxx-xxxx-4xxx-Vxxx-xxxxxxxxxxxx` in lowercase
  hexadecimal, where `V` is `8`, `9`, `a` or `b`.
- `randomUUIDv7()` is a UUID of version 7: the Unix time in milliseconds
  (48 bits), then 12 bits of the time within the millisecond, then 62
  random bits. UUIDs of version 7 sort by the time they were made, as text
  too, and those made by one process increase strictly: one made in the
  same tick of the clock as the one before takes the next value of the
  timestamp.
- The random bits come from the system's secure random number generator
  (`getentropy`). The global `crypto` has both functions too, beside
  `getRandomValues` (see [random values and timing](02-types.md#random-values-and-timing)).

## ore:tls

TLS 1.2 and 1.3 over TCP, with the system's OpenSSL 3 (libssl and
libcrypto). As in `ore:net`, a task waiting for the network parks without
occupying an OS thread: the sockets are non-blocking, and when OpenSSL needs
the socket to be readable or writable first, the task waits on the network
poller and tries again.

```ts
import { connect, createServer } from "ore:tls"

const conn = connect({ host: "example.com", port: 443, alpnProtocols: ["http/1.1"] })
if (conn instanceof Error) process.panic(conn.message)
conn.write("GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n")
console.log(conn.readAll())
conn.close()
```

- `connect(options)` connects and completes the handshake, returning a
  `Connection` or an `Error`. The options (`ConnectOptions`): `host` (a name
  or an IP address) and `port`; `servername`, the name sent with SNI and
  checked against the certificate (`host` when left out; no SNI is sent for
  an IP address); `ca`, certificates in PEM to trust instead of the
  system's; `rejectUnauthorized` (true when left out), whether a certificate
  that does not verify fails the connection; `alpnProtocols`, the protocols
  to offer with ALPN, preferred first.
- The certificate must chain to a trusted one and name the host: its
  subject alternative names are checked as OpenSSL's `X509_check_host` and
  `X509_check_ip_asc` do (a wildcard only as a whole label, `*.example.com`).
  Errors read as Node's: the message of OpenSSL's verification error, such as
  `unable to get local issuer certificate`, `unable to verify the first
  certificate`, `self-signed certificate` or `certificate has expired`, and
  for a name that does not match, `Hostname/IP does not match certificate's
  altnames: Host: example.com. is not in the cert's altnames: DNS:localhost,
  IP Address:127.0.0.1` (`IP: ... is not in the cert's list: ...` for an
  address). Other failures carry OpenSSL's error, as
  `handshake: error:0A00010B:SSL routines::wrong version number`.
- A `Connection` has `read(max?)`, `readAll()`, `write(data)` and `close()`,
  as `ore:net`'s `Conn`, and `handshake()`; `alpnProtocol`, the protocol
  ALPN agreed on or null; `authorized`, whether the peer's certificate
  verified, and `authorizationError`, why it did not (with
  `rejectUnauthorized: false`). `close()` sends TLS's close_notify. A peer
  that closes the socket without it ends the stream as well (`read` gives
  `""`), as HTTP needs. One task at a time may use a connection.
- `createServer(options)` makes a `Server` from `cert`, the certificate in
  PEM followed by its intermediate certificates if any, and `key`, its
  private key in PEM; `alpnProtocols` are the protocols the server speaks,
  preferred first, and a client that offers ALPN but none of them is refused
  (the alert `no_application_protocol`). `server.listen(port, host?)` listens
  (port 0 picks a free one, then in `server.port`; the host is 127.0.0.1 by
  default, `""` for every interface), `server.accept()` waits for a
  connection, and `server.close()` stops listening. An accepted connection
  does its handshake when it is first read or written, or by `handshake()`,
  so that a slow client does not hold up the next.
- Clients and servers negotiate TLS 1.2 or 1.3, never older versions.

The trusted certificates are those of OpenSSL's default paths
(`SSL_CTX_set_default_verify_paths`), read once by the first `connect`
without `ca`; `$SSL_CERT_FILE` and `$SSL_CERT_DIR` replace them. On Linux they
are the distribution's (`/etc/ssl/certs`, from the package ca-certificates).
On macOS, OpenSSL is Homebrew's `openssl@3`, whose default file
(`$(brew --prefix)/etc/openssl@3/cert.pem`) Homebrew's ca-certificates keeps
up to date, with the roots of the system's keychain added.

Only a program that imports `ore:tls` links with OpenSSL; `ore` itself does
not. On Linux the program links with the files of the run-time package,
`libssl.so.3` and `libcrypto.so.3` (Debian and Ubuntu: `libssl3`, or
`libssl3t64`), and loads them when it runs; the development package is not
needed. On macOS it links with Homebrew's `openssl@3`
(`brew install openssl@3`, in `/opt/homebrew/opt/openssl@3` or
`/usr/local/opt/openssl@3`; `$LIBRARY_PATH` may name another directory) and
loads it from there when it runs. `install.sh` offers to install them.

## ore:path

The functions of Node's `node:path` with POSIX semantics (`path.posix`),
giving the same results as Node:

| Export | Meaning |
| --- | --- |
| `sep`, `delimiter` | `"/"`, and `":"` as in `PATH` |
| `normalize(path)` | resolves `.` and `..` and collapses repeated slashes, keeping a trailing one: `normalize("a//b/../c/")` is `"a/c/"`; `""` is `"."` |
| `join(...paths)` | the non-empty paths joined with `/` and normalized; `"."` when all are empty |
| `resolve(...paths)` | an absolute path: the paths from right to left are prepended until one is absolute, then the working directory; normalized, without a trailing slash except for the root |
| `relative(from, to)` | the path from `from` to `to`, both resolved first; `""` when they are the same |
| `dirname(path)` | the directory, without trailing slashes: `"."` for a bare name, `"/"` for the root |
| `basename(path, suffix?)` | the last segment, ignoring trailing slashes, without `suffix` when it ends with it |
| `extname(path)` | the extension of the last segment from its last `.`, such as `".ore"`; `""` for none or a leading dot |
| `isAbsolute(path)` | whether the path starts with `/` |

Paths are strings of bytes. `/` and `.` are ASCII, so they never occur
inside a UTF-8 character, and the results equal Node's for any text.
