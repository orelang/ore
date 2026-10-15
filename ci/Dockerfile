# A Linux environment for the test suite: Bun, clang (for the TypeScript
# compiler and the C sources of packages), and LLVM's library and lld for the
# compiler in Ore, which calls LLVM's C API and links with ld.lld. LLVM 19 is
# the oldest it supports; 22 is Debian 13's newest.
FROM oven/bun:1.3.14-debian
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang llvm-22-dev lld-22 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# llvm-config and ld.lld of LLVM 22.
ENV PATH=/usr/lib/llvm-22/bin:$PATH
WORKDIR /work
