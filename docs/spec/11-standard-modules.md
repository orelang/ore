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
