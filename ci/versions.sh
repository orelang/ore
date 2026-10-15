#!/bin/sh
# The version of Ore is in compiler/package.json; the editor extensions carry
# the same one, so that a release vX.Y.Z ships them as X.Y.Z too.
#   ci/versions.sh                  checks that every file has the compiler's
#                                   version, and prints it
#   ci/versions.sh vX.Y.Z           checks that every file has X.Y.Z (the
#                                   release workflow, with its tag)
#   ci/versions.sh --set X.Y.Z      sets X.Y.Z in every file
# The files: compiler/package.json, editors/vscode/package.json and
# package-lock.json, editors/zed/extension.toml, Cargo.toml and Cargo.lock.
set -eu
cd "$(dirname "$0")/.."

# The version a file carries: the first `"version": "..."` of a JSON file
# (the top level's, in the files here), the `version = "..."` of a TOML file's
# top level or [package], and zed_ore's in Cargo.lock.
get() {
    case "$1" in
        *.json) sed -n 's/^  "version": "\(.*\)",*$/\1/p' "$1" | head -n 1 ;;
        *Cargo.lock) awk '/^name = "zed_ore"$/ { found = 1; next } found && /^version = / { gsub(/"/, "", $3); print $3; exit }' "$1" ;;
        *.toml) sed -n 's/^version = "\(.*\)"$/\1/p' "$1" | head -n 1 ;;
    esac
}

# Sets the version of a file, where get() reads it (and, in package-lock.json,
# the root package's too).
put() {
    file=$1
    version=$2
    case "$file" in
        *package-lock.json) awk -v v="$version" '
            !top && /^  "version": / { sub(/"[^"]*",$/, "\"" v "\","); top = 1 }
            /^    "": \{$/ { root = 1 }
            root && /^      "version": / { sub(/"[^"]*",$/, "\"" v "\","); root = 0 }
            { print }' "$file" ;;
        *.json) awk -v v="$version" '!done && /^  "version": / { sub(/"[^"]*",$/, "\"" v "\","); done = 1 } { print }' "$file" ;;
        *Cargo.lock) awk -v v="$version" '
            /^name = "zed_ore"$/ { found = 1 }
            found && /^version = / { $0 = "version = \"" v "\""; found = 0 }
            { print }' "$file" ;;
        *.toml) awk -v v="$version" '!done && /^version = / { $0 = "version = \"" v "\""; done = 1 } { print }' "$file" ;;
    esac > "$file.tmp"
    mv "$file.tmp" "$file"
}

files="compiler/package.json editors/vscode/package.json editors/vscode/package-lock.json
editors/zed/extension.toml editors/zed/Cargo.toml editors/zed/Cargo.lock"

case "${1:-}" in
    --set)
        version=${2:?usage: ci/versions.sh --set X.Y.Z}
        version=${version#v}
        echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "versions: $version is not X.Y.Z" >&2; exit 2; }
        for file in $files; do put "$file" "$version"; done
        ;;
    "") version=$(get compiler/package.json) ;;
    *) version=${1#v} ;;
esac

status=0
for file in $files; do
    actual=$(get "$file")
    if [ "$actual" != "$version" ]; then
        echo "versions: $file has ${actual:-no version}, not $version" >&2
        status=1
    fi
done
# package-lock.json carries the version twice: its root package's too.
root=$(awk '/^    "": \{$/ { root = 1 } root && /^      "version": / { gsub(/[",]/, "", $2); print $2; exit }' editors/vscode/package-lock.json)
if [ "$root" != "$version" ]; then
    echo "versions: editors/vscode/package-lock.json has $root for its root package, not $version" >&2
    status=1
fi
[ "$status" = 0 ] && echo "$version"
exit "$status"
