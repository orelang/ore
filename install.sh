#!/bin/sh
# Installs ore, the compiler of the Ore language, on Linux or macOS:
#
#   curl -fsSL https://raw.githubusercontent.com/orelang/ore/main/install.sh | sh
#
# It installs what linking programs needs from the system (the C library's
# start files on Linux, the Command Line Tools on macOS), downloads the latest
# release (or $ORE_VERSION, such as v0.1.0) of github.com/orelang/ore, checks
# it against the release's SHA256SUMS, unpacks it in ~/.ore/versions/<tag>
# ($ORE_HOME instead of ~/.ore), links ~/.ore/bin/ore to it and puts
# ~/.ore/bin in the PATH of bash, zsh and fish. A release carries its LLVM and
# lld. `ore update` later replaces it with the latest release.
set -eu

repo=${ORE_RELEASES:-orelang/ore}
home=${ORE_HOME:-$HOME/.ore}

say() { printf '%s\n' "$*"; }
fail() { printf 'ore install: %s\n' "$*" >&2; exit 1; }

# Root's commands: through sudo unless the script already runs as root.
as_root() {
    if [ "$(id -u)" = 0 ]; then "$@"
    elif command -v sudo >/dev/null; then sudo "$@"
    else fail "needs root to run: $*"
    fi
}

case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "unsupported system $(uname -s): ore runs on Linux and macOS" ;;
esac
case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "unsupported machine $(uname -m)" ;;
esac
command -v curl >/dev/null || fail "curl is needed"
command -v tar >/dev/null || fail "tar is needed"

# What linking needs from the system.
if [ "$os" = linux ]; then
    # glibc's start files (crt1.o), which every executable is linked with.
    found=
    for dir in /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib64 /usr/lib; do
        [ -f "$dir/crt1.o" ] && found=$dir && break
    done
    if [ -z "$found" ]; then
        say "installing the C library's development files"
        if command -v apt-get >/dev/null; then as_root apt-get update -qq && as_root apt-get install -y -qq libc6-dev >/dev/null
        elif command -v dnf >/dev/null; then as_root dnf install -y -q glibc-devel
        elif command -v yum >/dev/null; then as_root yum install -y -q glibc-devel
        elif command -v zypper >/dev/null; then as_root zypper --non-interactive install glibc-devel
        elif command -v pacman >/dev/null; then as_root pacman -S --noconfirm --needed glibc
        elif command -v apk >/dev/null; then fail "Alpine (musl) is not supported: ore links with glibc"
        else fail "install your C library's development files (crt1.o), then run this again"
        fi
    fi
else
    # The macOS SDK, which ore links against.
    if ! xcrun --show-sdk-path >/dev/null 2>&1; then
        say "installing the Command Line Tools (a dialog opens; the installation continues once they are installed)"
        xcode-select --install >/dev/null 2>&1 || true
        until xcrun --show-sdk-path >/dev/null 2>&1; do sleep 5; done
    fi
fi

# The release.
tag=${ORE_VERSION:-}
if [ -z "$tag" ]; then
    tag=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$tag" ] || fail "no release of $repo yet"
fi
name=ore-$tag-$os-$arch
base=https://github.com/$repo/releases/download/$tag
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
say "downloading $name"
curl -fsSL -o "$work/$name.tar.gz" "$base/$name.tar.gz" || fail "$tag has no release for $os-$arch"
curl -fsSL -o "$work/SHA256SUMS" "$base/SHA256SUMS" || fail "$tag has no SHA256SUMS"
expected=$(grep "  $name.tar.gz\$" "$work/SHA256SUMS" | cut -d' ' -f1)
if command -v sha256sum >/dev/null; then actual=$(sha256sum "$work/$name.tar.gz" | cut -d' ' -f1)
else actual=$(shasum -a 256 "$work/$name.tar.gz" | cut -d' ' -f1)
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "$name.tar.gz does not match its SHA-256 sum"

mkdir -p "$home/versions" "$home/bin"
tar -xzf "$work/$name.tar.gz" -C "$work"
rm -rf "$home/versions/$tag"
mv "$work/$name" "$home/versions/$tag"
ln -s "../versions/$tag/bin/ore" "$home/bin/ore.next"
mv -f "$home/bin/ore.next" "$home/bin/ore"

# The PATH, in the startup files of the shells there are.
line="export PATH=\"$home/bin:\$PATH\""
added=
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    case "$rc" in
        */.zshrc) [ -f "$rc" ] || [ "$(basename "${SHELL:-}")" = zsh ] || continue ;;
        */.bashrc) [ -f "$rc" ] || [ "$(basename "${SHELL:-}")" = bash ] || continue ;;
    esac
    if ! grep -qs "$home/bin" "$rc"; then
        printf '\n# ore\n%s\n' "$line" >>"$rc"
        added="$added $rc"
    fi
done
if command -v fish >/dev/null; then
    conf=$HOME/.config/fish/conf.d/ore.fish
    if [ ! -f "$conf" ]; then
        mkdir -p "$(dirname "$conf")"
        printf 'fish_add_path %s\n' "$home/bin" >"$conf"
        added="$added $conf"
    fi
fi

say "ore $tag installed: $home/bin/ore"
"$home/bin/ore" version >/dev/null || fail "the installed ore does not run"
[ -n "$added" ] && say "added $home/bin to PATH in$added; open a new shell, or run: $line"
exit 0
