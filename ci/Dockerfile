# A Linux environment for the test suite: LLVM's library and lld, which the
# compiler in Ore calls and links with (LLVM 19 or newer; 22 is Debian 13's
# newest), clang for the C sources of packages, OpenSSL 3 for ore:tls, and git
# and Bun, with which ci/bootstrap.sh builds its seed (the last commit with the
# compiler in TypeScript) until a release of ore exists.
FROM debian:13
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang llvm-22-dev lld-22 libssl3t64 git ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s bun-v1.3.14 >/dev/null
# llvm-config and ld.lld of LLVM 22.
ENV PATH=/usr/lib/llvm-22/bin:$PATH
WORKDIR /work
