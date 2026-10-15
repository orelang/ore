#!/bin/sh
# Packs a bootstrapped `ore` as a self-contained release archive:
#   ci/package.sh <tag> <ore-binary> <out-dir>
# writes <out-dir>/ore-<tag>-<os>-<arch>.tar.gz, which unpacks into
#
#   ore-<tag>-<os>-<arch>/bin/ore
#   ore-<tag>-<os>-<arch>/lib/ore/ld.lld (ld64.lld on macOS)   found by `ore`
#   ore-<tag>-<os>-<arch>/lib/*.so|*.dylib                   libLLVM and what it needs
#
# The libraries `ore` and lld load, except the system's (glibc's on Linux,
# /usr/lib and /System on macOS), are copied into lib/, and the binaries find
# them relative to themselves ($ORIGIN with patchelf on Linux, @rpath with
# install_name_tool on macOS, then signed again). Needs lld beside the LLVM
# that `ore` links (ld.lld or ld64.lld in PATH or `llvm-config --bindir`).
set -eu
tag=$1
binary=$2
out=$3
case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
name=ore-$tag-$os-$arch
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
root=$work/$name
mkdir -p "$root/bin" "$root/lib/ore" "$out"
cp "$binary" "$root/bin/ore"
linker=ld.lld
[ "$os" = darwin ] && linker=ld64.lld
lld=$(command -v "$linker" || true)
[ -n "$lld" ] || lld=$(llvm-config --bindir)/$linker
[ -x "$lld" ] || { echo "package: $linker not found" >&2; exit 1; }
cp "$lld" "$root/lib/ore/$linker"
cp README.md LICENSE-MIT LICENSE-APACHE "$root/"

# A system library stays where the system has it.
system() {
    case "$1" in
        */libc.so* | */libm.so* | */libpthread.so* | */libdl.so* | */librt.so* | */ld-linux* | */linux-vdso*) true ;;
        /usr/lib/* | /System/*) [ "$os" = darwin ] ;;
        *) false ;;
    esac
}

# The libraries a file loads that are not the system's: paths, one per line.
deps() {
    if [ "$os" = darwin ]; then
        otool -L "$1" | tail -n +2 | awk '{print $1}' | while read -r lib; do
            case "$lib" in
                @rpath/*) for dir in "$(brew --prefix llvm)/lib" "$(brew --prefix lld)/lib"; do
                    [ -f "$dir/${lib#@rpath/}" ] && echo "$dir/${lib#@rpath/}" && break
                done ;;
                *) system "$lib" || echo "$lib" ;;
            esac
        done
    else
        ldd "$1" | awk '/=>/ {print $3}' | while read -r lib; do
            [ -n "$lib" ] && ! system "$lib" && echo "$lib"
        done
    fi
}

# Copies the libraries of every file into lib/, transitively.
pending="$root/bin/ore $root/lib/ore/$linker"
seen=" "
while [ -n "$pending" ]; do
    next=""
    for file in $pending; do
        for lib in $(deps "$file"); do
            base=$(basename "$lib")
            case "$seen" in *" $base "*) continue ;; esac
            seen="$seen$base "
            cp -L "$lib" "$root/lib/$base"
            chmod u+w "$root/lib/$base"
            next="$next $root/lib/$base"
        done
    done
    pending=$next
done

# Each binary and library finds the copies relative to itself.
if [ "$os" = darwin ]; then
    rewrite() {
        file=$1
        otool -L "$file" | tail -n +2 | awk '{print $1}' | while read -r lib; do
            base=$(basename "$lib")
            [ -f "$root/lib/$base" ] && install_name_tool -change "$lib" "@rpath/$base" "$file" 2>/dev/null || true
        done
    }
    for lib in "$root"/lib/*.dylib; do
        [ -f "$lib" ] || continue
        install_name_tool -id "@rpath/$(basename "$lib")" "$lib"
        rewrite "$lib"
        install_name_tool -add_rpath @loader_path "$lib" 2>/dev/null || true
    done
    rewrite "$root/bin/ore"
    install_name_tool -add_rpath @executable_path/../lib "$root/bin/ore"
    rewrite "$root/lib/ore/$linker"
    install_name_tool -add_rpath @executable_path/.. "$root/lib/ore/$linker" 2>/dev/null || true
    for file in "$root"/lib/*.dylib "$root/bin/ore" "$root/lib/ore/$linker"; do
        [ -f "$file" ] && codesign -f -s - "$file" 2>/dev/null
    done
else
    command -v patchelf >/dev/null || { echo "package: patchelf is needed" >&2; exit 1; }
    patchelf --set-rpath '$ORIGIN/../lib' "$root/bin/ore"
    patchelf --set-rpath '$ORIGIN/..' "$root/lib/ore/$linker"
    for lib in "$root"/lib/*.so*; do
        [ -f "$lib" ] && patchelf --set-rpath '$ORIGIN' "$lib"
    done
fi

# The archive works without the LLVM it was built with: check it runs.
"$root/bin/ore" version >/dev/null
tar -czf "$out/$name.tar.gz" -C "$work" "$name"
echo "$out/$name.tar.gz"
