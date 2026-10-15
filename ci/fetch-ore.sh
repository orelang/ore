#!/bin/sh
# Downloads a released `ore` for this machine from GitHub and prints its path:
#   ORE=$(ci/fetch-ore.sh [vX.Y.Z|latest]) ci/bootstrap.sh
# The archive is checked against the release's SHA256SUMS. Releases need
# LLVM's library and lld installed (see the README). Exits 1 when there is no
# such release, or none for this platform.
set -e
version=${1:-latest}
repo=${ORE_RELEASES:-orelang/ore}
case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "fetch-ore: unsupported system $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=amd64 ;;
    *) echo "fetch-ore: unsupported machine $(uname -m)" >&2; exit 1 ;;
esac
if [ "$version" = latest ]; then
    version=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$version" ] || { echo "fetch-ore: no release of $repo yet" >&2; exit 1; }
fi
dir=${ORE_CACHE:-$HOME/.cache/ore}/releases/$version
name=ore-$version-$os-$arch
if [ ! -x "$dir/$name/bin/ore" ]; then
    mkdir -p "$dir"
    base=https://github.com/$repo/releases/download/$version
    curl -fsSL -o "$dir/$name.tar.gz" "$base/$name.tar.gz" || { echo "fetch-ore: no $name in $version" >&2; exit 1; }
    curl -fsSL -o "$dir/SHA256SUMS" "$base/SHA256SUMS"
    expected=$(grep " $name.tar.gz\$" "$dir/SHA256SUMS" | cut -d' ' -f1)
    actual=$( (sha256sum "$dir/$name.tar.gz" 2>/dev/null || shasum -a 256 "$dir/$name.tar.gz") | cut -d' ' -f1)
    [ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "fetch-ore: checksum mismatch for $name" >&2; exit 1; }
    tar -xzf "$dir/$name.tar.gz" -C "$dir"
fi
echo "$dir/$name/bin/ore"
