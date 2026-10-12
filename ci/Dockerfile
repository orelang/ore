# A Linux environment for the test suite: Bun and clang.
FROM oven/bun:1.3.14-debian
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
