#!/bin/sh
# Installs ore, the compiler of the Ore language, on Linux or macOS:
#
#   curl -fsSL https://raw.githubusercontent.com/orelang/ore/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/orelang/ore/main/install.sh | sh -s -- --help
#
# It installs what linking programs needs from the system (the C library's
# start files on Linux, the Command Line Tools on macOS), downloads the latest
# release (or $ORE_VERSION, such as v0.1.0) of github.com/orelang/ore, checks
# it against the release's SHA256SUMS, unpacks it in ~/.ore/versions/<tag>
# ($ORE_HOME instead of ~/.ore), links ~/.ore/bin/ore to it and puts
# ~/.ore/bin in the PATH of bash, zsh and fish. A release carries its LLVM and
# lld. `ore update` later replaces it with the latest release.
#
# On a terminal it asks before replacing an installed ore, installing system
# packages or changing shell startup files; without one (CI, --yes) it does
# all of them, as it always did. Colors follow the rules of the `ore` command
# (compiler/src/cli/style.ore): NO_COLOR, FORCE_COLOR, COLORTERM, TERM.
set -eu

repo=${ORE_RELEASES:-orelang/ore}
home=${ORE_HOME:-$HOME/.ore}
tag=${ORE_VERSION:-}

# Whether an environment variable's value means yes.
truthy() {
    case ${1:-} in '' | 0 | false | no) return 1 ;; *) return 0 ;; esac
}
yes=
truthy "${ORE_YES:-}" && yes=1
verbose=
truthy "${ORE_VERBOSE:-}" && verbose=1
modify_path=1
truthy "${ORE_NO_MODIFY_PATH:-}" && modify_path=

usage() {
    cat <<EOF
Installs ore, the compiler of the Ore language, from github.com/$repo.

Usage:
  curl -fsSL https://raw.githubusercontent.com/orelang/ore/main/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/orelang/ore/main/install.sh | sh -s -- [options]

Options:
  --version <tag>     Install this release (such as v0.3.0) instead of the latest
  --home <dir>        Install in <dir> instead of ~/.ore (ore goes in <dir>/bin)
  -y, --yes           Ask nothing: replace, install and edit PATH as needed
  --no-modify-path    Leave shell startup files alone; print the line to add
  --verbose           Print the commands run and their output
  -h, --help          Print this help

Environment:
  ORE_VERSION, ORE_HOME, ORE_YES=1, ORE_NO_MODIFY_PATH=1, ORE_VERBOSE=1
                      The same as the options above
  ORE_RELEASES        The GitHub repository of the releases (default orelang/ore)
  NO_COLOR, FORCE_COLOR
                      Turn colors off, or on when the output is not a terminal

Without a terminal (CI, a pipe) it asks nothing and does what --yes does.
Homebrew installs ore too: brew install orelang/tap/ore
EOF
}

while [ $# -gt 0 ]; do
    case $1 in
        -y | --yes) yes=1 ;;
        --verbose) verbose=1 ;;
        --no-modify-path) modify_path= ;;
        --version) [ $# -gt 1 ] || { printf 'ore install: --version needs a tag, such as v0.3.0\n' >&2; exit 2; }; tag=$2; shift ;;
        --version=*) tag=${1#--version=} ;;
        --home) [ $# -gt 1 ] || { printf 'ore install: --home needs a directory\n' >&2; exit 2; }; home=$2; shift ;;
        --home=*) home=${1#--home=} ;;
        -h | --help) usage; exit 0 ;;
        *) printf 'ore install: unknown option %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done
case $tag in [0-9]*) tag=v$tag ;; esac
case $home in /*) ;; *) home=$(pwd)/$home ;; esac

# --- Output -------------------------------------------------------------------

# How many colors a stream shows (0 none, 1 the 16 basic, 2 xterm's 256, 3 any),
# as `ore` finds it; the result goes in $level.
color_level() {
    level=0
    [ -n "${NO_COLOR:-}" ] && return
    forced=
    case ${FORCE_COLOR:-} in '' | 0 | false) ;; *) forced=1 ;; esac
    if [ -z "$forced" ] && ! [ -t "$1" ]; then return; fi
    case ${FORCE_COLOR:-} in 1 | 2 | 3) level=$FORCE_COLOR; return ;; esac
    if [ "${TERM:-}" = dumb ] && [ -z "$forced" ]; then return; fi
    case ${COLORTERM:-} in truecolor | 24bit) level=3; return ;; esac
    case ${TERM:-} in *256color*) level=2; return ;; esac
    level=1
}

esc=$(printf '\033')
# The escape sequence that sets a color at a level: 24-bit, the nearest of
# xterm's 256 (as style.ore picks it), or the basic color of the same role.
sgr() { # level r;g;b 256 basic
    case $1 in
        3) printf '%s[38;2;%sm' "$esc" "$2" ;;
        2) printf '%s[38;5;%sm' "$esc" "$3" ;;
        *) printf '%s[%sm' "$esc" "$4" ;;
    esac
}
# Sets <prefix>accent, dim, code, ok, err, warn, bold, off (color), nobold for a stream.
set_colors() { # prefix fd
    color_level "$2"
    if [ "$level" = 0 ]; then
        for v in accent dim code ok err warn bold off nobold; do eval "$1$v="; done
        return
    fi
    eval "$1accent=\$(sgr $level '201;161;139' 180 33)" # Oxide
    eval "$1dim=\$(sgr $level '126;143;149' 245 90)"    # Slate
    eval "$1code=\$(sgr $level '169;119;93' 137 36)"    # keyword copper
    eval "$1ok=\$(sgr $level '143;174;139' 108 32)"
    eval "$1err=\$(sgr $level '217;102;91' 167 31)"
    eval "$1warn=\$(sgr $level '221;182;107' 179 33)"
    eval "$1bold=\"\${esc}[1m\" $1nobold=\"\${esc}[22m\" $1off=\"\${esc}[39m\""
}
set_colors o_ 1
set_colors e_ 2

# Marks: Unicode when the locale is UTF-8, ASCII otherwise.
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *UTF-8* | *utf-8* | *UTF8* | *utf8*)
        m_go='→' m_ok='✓' m_no='✗' m_warn='!' m_link='→' frames='⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏' fill='━' empty='─' dots='…' ;;
    *) m_go='>' m_ok='+' m_no='x' m_warn='!' m_link='->' frames='| / - \' fill='#' empty='-' dots='...' ;;
esac

# Live output (a spinner and lines rewritten in place) on a terminal, unless verbose.
live=
[ -t 1 ] && [ -z "$verbose" ] && [ "${TERM:-}" != dumb ] && live=1
# Questions only with a terminal to read the answer from.
interactive=
if [ -z "$yes" ] && [ -t 1 ] && (: </dev/tty) 2>/dev/null; then interactive=1; fi
tick=0.1
sleep 0.1 2>/dev/null || tick=1

# A path with ~ for the home directory, for reading.
pretty() {
    case $1 in "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;; *) printf '%s' "$1" ;; esac
}
say() { printf '%s\n' "$*"; }
# A raw detail, shown with --verbose.
detail() { [ -z "$verbose" ] || printf '    %s%s%s\n' "$o_dim" "$*" "$o_off"; }

step=0
steps=6
cr=
[ -n "$live" ] && cr="$(printf '\r')${esc}[K"
# A step's line: its mark, its number and its text.
line() { # mark color text
    printf '%s  %s%s%s %s%d/%d%s %s' "$cr" "$2" "$1" "$o_off" "$o_dim" "$step" "$steps" "$o_off" "$3"
}
begin() { step=$((step + 1)); line "$m_go" "$o_accent" "$*"; [ -n "$live" ] || printf '\n'; }
ok() { line "$m_ok" "$o_ok" "$*"; printf '\n'; }
note() { line "$m_warn" "$o_warn" "$*"; printf '\n'; }

work=
pid=
cleanup() {
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
    [ -n "$live" ] && printf '%s[?25h' "$esc"
    [ -n "$work" ] && rm -rf "$work"
    return 0
}
trap cleanup EXIT
trap 'cleanup; printf "\n"; exit 130' INT TERM

# Stops with what failed, why, and what to do: the second and further
# arguments are lines under the first.
die() {
    [ -n "$live" ] && printf '\r%s[K' "$esc"
    if [ "$step" -gt 0 ]; then
        printf '  %s%s%s %s%d/%d%s %s%s%s\n' "$e_err" "$m_no" "$e_off" "$e_dim" "$step" "$steps" "$e_off" "$e_bold" "$1" "$e_nobold" >&2
    else
        printf '  %s%s%s %s%s%s\n' "$e_err" "$m_no" "$e_off" "$e_bold" "$1" "$e_nobold" >&2
    fi
    shift
    for l in "$@"; do printf '    %s\n' "$l" >&2; done
    if [ -n "$verbose" ] && [ -n "$work" ] && [ -s "$work/log" ]; then
        printf '\n    %sLast output:%s\n' "$e_dim" "$e_off" >&2
        tail -n 15 "$work/log" | sed 's/^/      /' >&2
    fi
    printf '\n    %sRetry with details:%s curl -fsSL https://raw.githubusercontent.com/orelang/ore/main/install.sh | sh -s -- --verbose\n' "$e_dim" "$e_off" >&2
    printf '    %sReport it:%s https://github.com/orelang/ore/issues\n' "$e_dim" "$e_off" >&2
    exit 1
}

# Asks a yes/no question on the terminal; without one, the answer is the default.
ask() { # question default(y|n)
    if [ -z "$interactive" ]; then [ "$2" = y ]; return; fi
    if [ "$2" = y ]; then hint='[Y/n]'; else hint='[y/N]'; fi
    printf '%s  %s?%s %s %s%s%s ' "$cr" "$o_accent" "$o_off" "$1" "$o_dim" "$hint" "$o_off"
    answer=
    read -r answer </dev/tty || answer=
    case $answer in
        [yY]*) return 0 ;;
        [nN]*) return 1 ;;
        *) [ "$2" = y ] ;;
    esac
}

# Runs a command, its output in the log (or on the screen with --verbose),
# with a spinner after the step's text on a terminal. With $progress_file and
# $progress_total set, the spinner shows how much of the file is there.
progress_file=
progress_total=
run() { # text command...
    text=$1
    shift
    if [ -n "$verbose" ]; then
        printf '    %s$ %s%s\n' "$o_dim" "$*" "$o_off"
        "$@"
        return
    fi
    if [ -z "$live" ]; then
        "$@" >>"$work/log" 2>&1
        return
    fi
    "$@" >>"$work/log" 2>&1 &
    pid=$!
    printf '%s[?25l' "$esc"
    set -- $frames
    n=$#
    i=0
    while kill -0 "$pid" 2>/dev/null; do
        i=$((i % n + 1))
        eval "frame=\${$i}"
        extra=
        if [ -n "$progress_file" ]; then
            have=0
            [ -f "$progress_file" ] && have=$(wc -c <"$progress_file")
            extra=$(awk -v h="$have" -v t="${progress_total:-0}" -v f="$fill" -v e="$empty" \
                -v a="$o_accent" -v d="$o_dim" -v o="$o_off" '
                function size(b) { return b >= 1048576 ? sprintf("%.1f MB", b / 1048576) : sprintf("%d KB", b / 1024) }
                BEGIN {
                    if (t <= 0) { printf "  %s", size(h); exit }
                    w = 20; k = int(w * h / t); if (k > w) k = w
                    bar = ""; for (j = 0; j < k; j++) bar = bar f
                    rest = ""; for (j = k; j < w; j++) rest = rest e
                    printf "  %s%s%s%s%s  %s / %s  %d%%", a, bar, d, rest, o, size(h), size(t), 100 * h / t
                }')
        fi
        printf '\r%s[K  %s%s%s %s%d/%d%s %s%s' "$esc" "$o_accent" "$frame" "$o_off" "$o_dim" "$step" "$steps" "$o_off" "$text" "$extra"
        sleep "$tick"
    done
    printf '%s[?25h' "$esc"
    status=0
    wait "$pid" || status=$?
    pid=
    return "$status"
}

# Why curl failed, in words, from the last line of the log.
curl_reason() {
    last=$(grep 'curl: (' "$work/log" 2>/dev/null | tail -n 1)
    case $last in
        *'error: 404'*) printf 'not found (HTTP 404)' ;;
        *'error: 403'* | *'error: 429'*) printf 'GitHub refused the request (rate limit?); wait a little and try again' ;;
        *'(6)'*) printf 'cannot resolve the host: are you offline, or behind a proxy?' ;;
        *'(7)'*) printf 'cannot connect: are you offline, or behind a proxy?' ;;
        *'(28)'*) printf 'the connection timed out' ;;
        *'(35)'* | *'(60)'*) printf 'the TLS connection failed (certificates, or a proxy?)' ;;
        '') printf 'curl failed' ;;
        *) printf '%s' "${last#*curl: }" ;;
    esac
}

size() {
    awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.1f MB", b / 1048576; else if (b >= 1024) printf "%d KB", b / 1024; else printf "%d bytes", b }'
}

# --- Platform -----------------------------------------------------------------

printf '\n  %s{%s%sOre%s%s}%s %sinstaller%s\n\n' "$o_accent" "$o_off" "$o_bold" "$o_nobold" "$o_accent" "$o_off" "$o_dim" "$o_off"

case "$(uname -s)" in
    Linux) os=linux os_name=Linux ;;
    Darwin) os=darwin os_name=macOS ;;
    *) die "Unsupported system: $(uname -s)" "ore runs on Linux and macOS." ;;
esac
case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) die "Unsupported machine: $(uname -m)" "Releases are built for amd64 (x86_64) and arm64 (aarch64)." ;;
esac
# The Linux releases are built with glibc 2.35 (Ubuntu 22.04) and need it or
# newer; musl (Alpine) has no glibc at all.
if [ "$os" = linux ]; then
    need=35 needed="2.35 or newer (Ubuntu 22.04, Debian 12, RHEL 10 and later)"
    glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')
    [ -n "$glibc" ] || die "This system's C library is not glibc" \
        "ore is built for glibc $needed; musl systems such as Alpine are not supported."
    if ! printf '%s\n' "$glibc" | awk -F. -v need="$need" '{ exit !($1 > 2 || ($1 == 2 && $2 >= need)) }'; then
        die "glibc $glibc is too old" \
            "ore needs glibc $needed. glibc comes with the system: upgrade it, or use a newer image."
    fi
fi
command -v curl >/dev/null || die "curl is needed" "Install curl with your package manager, then run this again."
command -v tar >/dev/null || die "tar is needed" "Install tar with your package manager, then run this again."
work=$(mktemp -d)
: >"$work/log"

# --- The release --------------------------------------------------------------

if [ -z "$tag" ]; then
    latest="latest release"
    if [ -n "$live" ]; then
        printf '  %s%s%s Finding the latest release of %s%s' "$o_accent" "$m_go" "$o_off" "$repo" "$dots"
    else
        printf '  %s%s%s Finding the latest release of %s\n' "$o_accent" "$m_go" "$o_off" "$repo"
    fi
    detail "GET https://api.github.com/repos/$repo/releases/latest"
    if curl -fsSL "https://api.github.com/repos/$repo/releases/latest" >"$work/release.json" 2>>"$work/log"; then
        tag=$(sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' "$work/release.json" | head -1)
    fi
    if [ -z "$tag" ]; then
        # Without the API (a rate limit): the page of the latest release redirects to its tag.
        detail "GET https://github.com/$repo/releases/latest (redirect)"
        effective=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest" 2>>"$work/log") || effective=
        case $effective in */releases/tag/*) tag=${effective##*/} ;; esac
    fi
    [ -n "$tag" ] || die "Cannot find the latest release of $repo" "Why: $(curl_reason)" \
        "Releases: https://github.com/$repo/releases (pick one with --version <tag>)"
    if [ -n "$live" ]; then printf '\r%s[K' "$esc"; else printf '\n'; fi
else
    latest="requested"
fi
name=ore-$tag-$os-$arch
base=https://github.com/$repo/releases/download/$tag

# What is installed now, if anything: <home>/bin/ore links to ../versions/<tag>/bin/ore.
current=
if [ -L "$home/bin/ore" ] || [ -e "$home/bin/ore" ]; then
    target=$(readlink "$home/bin/ore" 2>/dev/null || true)
    case $target in ../versions/*/bin/ore) current=${target#../versions/} current=${current%/bin/ore} ;; *) current=unknown ;; esac
fi

label() { printf '  %s%-9s%s %s\n' "$o_dim" "$1" "$o_off" "$2"; }
if [ "$current" = unknown ]; then current_name="the ore in $(pretty "$home/bin")"; else current_name="ore $current"; fi
label Version "$o_bold$tag$o_nobold $o_dim($latest)$o_off"
label Platform "$os_name $arch $o_dim($os-$arch)$o_off"
label Into "$o_code$(pretty "$home/bin/ore")$o_off ${o_dim}(the release in $(pretty "$home/versions/$tag"))$o_off"
label From "$o_dim$base/$name.tar.gz$o_off"
if [ -n "$current" ]; then
    if [ "$current" = "$tag" ]; then label Installed "$current ${o_dim}(the same; it is installed again)$o_off"
    elif [ "$current" = unknown ]; then label Installed "$(pretty "$home/bin/ore") ${o_dim}(replaced by $tag)$o_off"
    else label Installed "$current ${o_dim}(replaced by $tag; kept in $(pretty "$home/versions/$current"))$o_off"
    fi
fi
printf '\n'

if [ -n "$current" ]; then
    if [ "$current" = "$tag" ]; then question="ore $tag is installed already. Install it again"
    else question="Replace $current_name with $tag"
    fi
    if ! ask "$question" y; then
        printf '\n  Nothing changed.\n\n'
        exit 0
    fi
fi

# Root's commands: through sudo unless the script already runs as root.
as_root() {
    if [ "$(id -u)" = 0 ]; then "$@"
    elif command -v sudo >/dev/null; then sudo "$@"
    else die "Root is needed to run: $*" "Run it as root, then run this again."
    fi
}

# --- 1. What linking needs from the system ------------------------------------

if [ "$os" = linux ]; then
    begin "Checking the C library's start files (crt1.o)"
    # glibc's start files (crt1.o), which every executable is linked with.
    found=
    for dir in /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib64 /usr/lib; do
        [ -f "$dir/crt1.o" ] && found=$dir && break
    done
    if [ -n "$found" ]; then
        ok "The C library's start files are there $o_dim($found/crt1.o)$o_off"
    else
        if command -v apt-get >/dev/null; then pm=apt-get pkg=libc6-dev
        elif command -v dnf >/dev/null; then pm=dnf pkg=glibc-devel
        elif command -v yum >/dev/null; then pm=yum pkg=glibc-devel
        elif command -v zypper >/dev/null; then pm=zypper pkg=glibc-devel
        elif command -v pacman >/dev/null; then pm=pacman pkg=glibc
        elif command -v apk >/dev/null; then die "Alpine (musl) is not supported" "ore links programs with glibc."
        else die "The C library's development files are missing" "ore links programs with crt1.o: install your distribution's glibc development package, then run this again."
        fi
        [ -n "$live" ] && printf '\n'
        ask "Install $pkg with $pm (it needs root, through sudo)" y ||
            die "The C library's development files are missing" "ore links programs with crt1.o. Install $pkg, then run this again."
        if [ "$(id -u)" != 0 ]; then say "    ${o_dim}sudo may ask for your password$o_off"; fi
        # No spinner: sudo may ask for a password.
        live_was=$live
        live=
        case $pm in
            apt-get) run "" as_root apt-get update -qq && run "" as_root apt-get install -y -qq libc6-dev ;;
            dnf | yum) run "" as_root "$pm" install -y -q glibc-devel ;;
            zypper) run "" as_root zypper --non-interactive install glibc-devel ;;
            pacman) run "" as_root pacman -S --noconfirm --needed glibc ;;
        esac || die "Installing $pkg with $pm failed" "Install it yourself, then run this again."
        live=$live_was
        ok "Installed $pkg with $pm"
    fi
else
    begin "Checking the Command Line Tools (the macOS SDK)"
    # The macOS SDK, which ore links against.
    if xcrun --show-sdk-path >/dev/null 2>&1; then
        ok "The Command Line Tools are there"
    else
        [ -n "$live" ] && printf '\n'
        ask "Install the Command Line Tools (a dialog of macOS opens)" y ||
            die "The Command Line Tools are missing" "ore links programs against the macOS SDK. Run: xcode-select --install"
        xcode-select --install >/dev/null 2>&1 || true
        [ -z "$live" ] && say "    Waiting for the Command Line Tools to be installed (a dialog opened)$dots"
        wait_sdk() { until xcrun --show-sdk-path >/dev/null 2>&1; do sleep 5; done; }
        run "Waiting for the installation of the Command Line Tools (finish it in the dialog)$dots" wait_sdk
        ok "Installed the Command Line Tools"
    fi
fi

# --- 2. OpenSSL 3, for programs that import ore:tls ---------------------------

# Programs that import ore:tls link with OpenSSL 3; others do not need it, so
# without it ore is installed all the same.
begin "Checking OpenSSL 3 (for ore:tls)"
if [ "$os" = linux ]; then
    found=
    for dir in /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /lib/x86_64-linux-gnu /lib/aarch64-linux-gnu /usr/lib64 /lib64 /usr/lib /lib; do
        [ -f "$dir/libssl.so.3" ] && found=$dir && break
    done
    if [ -n "$found" ]; then
        ok "OpenSSL 3 is there $o_dim($found/libssl.so.3)$o_off"
    else
        pm= pkg=
        if command -v apt-get >/dev/null; then pm=apt-get pkg=libssl3
        elif command -v dnf >/dev/null; then pm=dnf pkg=openssl-libs
        elif command -v yum >/dev/null; then pm=yum pkg=openssl-libs
        elif command -v zypper >/dev/null; then pm=zypper pkg=libopenssl3
        elif command -v pacman >/dev/null; then pm=pacman pkg=openssl
        fi
        [ -n "$live" ] && printf '\n'
        if [ -n "$pm" ] && ask "Install $pkg with $pm, for programs that import ore:tls (it needs root, through sudo)" y; then
            if [ "$(id -u)" != 0 ]; then say "    ${o_dim}sudo may ask for your password$o_off"; fi
            live_was=$live
            live=
            if case $pm in
                apt-get) run "" as_root apt-get update -qq && run "" as_root apt-get install -y -qq libssl3 ;;
                dnf | yum) run "" as_root "$pm" install -y -q openssl-libs ;;
                zypper) run "" as_root zypper --non-interactive install libopenssl3 ;;
                pacman) run "" as_root pacman -S --noconfirm --needed openssl ;;
            esac; then
                live=$live_was
                ok "Installed $pkg with $pm"
            else
                live=$live_was
                note "Installing $pkg with $pm failed: programs that import ore:tls will not link until OpenSSL 3 is installed"
            fi
        else
            note "OpenSSL 3 (libssl.so.3) is missing: programs that import ore:tls will not link until it is installed"
        fi
    fi
else
    if [ -f /opt/homebrew/opt/openssl@3/lib/libssl.3.dylib ] || [ -f /usr/local/opt/openssl@3/lib/libssl.3.dylib ]; then
        ok "OpenSSL 3 is there $o_dim(Homebrew's openssl@3)$o_off"
    elif command -v brew >/dev/null; then
        [ -n "$live" ] && printf '\n'
        if ask "Install openssl@3 with Homebrew, for programs that import ore:tls" y; then
            if run "Installing openssl@3 with Homebrew$dots" brew install openssl@3; then
                ok "Installed openssl@3 with Homebrew"
            else
                note "Installing openssl@3 failed: programs that import ore:tls will not link until it is installed"
            fi
        else
            note "openssl@3 is missing: programs that import ore:tls will not link until it is (brew install openssl@3)"
        fi
    else
        note "OpenSSL 3 is missing: programs that import ore:tls need Homebrew's openssl@3 (https://brew.sh, then brew install openssl@3)"
    fi
fi

# --- 3. Download --------------------------------------------------------------

begin "Downloading $name.tar.gz"
# Its size (and whether it is there) from a HEAD request, for the progress.
code=$(curl -sSLI -o "$work/head" -w '%{http_code}' "$base/$name.tar.gz" 2>>"$work/log") || code=
total=
case $code in
    200) total=$(tr -d '\r' <"$work/head" | awk 'tolower($1) == "content-length:" { n = $2 } END { print n }') ;;
    404) die "There is no $tag release for $os-$arch" "Not found: $base/$name.tar.gz" \
        "Releases: https://github.com/$repo/releases" ;;
esac
[ "$total" = 0 ] && total=
[ -n "$live" ] || [ -z "$total" ] || say "    $(size "$total") to download$dots"
progress_file=$work/$name.tar.gz progress_total=$total
run "Downloading" curl -fsSL -o "$work/$name.tar.gz" "$base/$name.tar.gz" ||
    die "Downloading $name.tar.gz failed" "Why: $(curl_reason)" "URL: $base/$name.tar.gz"
progress_file= progress_total=
ok "Downloaded $name.tar.gz $o_dim($(size "$(wc -c <"$work/$name.tar.gz")"))$o_off"

# --- 4. Checksum --------------------------------------------------------------

begin "Checking it against the release's SHA256SUMS"
run "Checking it against the release's SHA256SUMS" curl -fsSL -o "$work/SHA256SUMS" "$base/SHA256SUMS" ||
    die "Downloading SHA256SUMS failed" "Why: $(curl_reason)" "URL: $base/SHA256SUMS"
expected=$(grep "  $name.tar.gz\$" "$work/SHA256SUMS" | cut -d' ' -f1) || expected=
if command -v sha256sum >/dev/null; then actual=$(sha256sum "$work/$name.tar.gz" | cut -d' ' -f1)
else actual=$(shasum -a 256 "$work/$name.tar.gz" | cut -d' ' -f1)
fi
detail "expected $expected"
detail "actual   $actual"
[ -n "$expected" ] || die "SHA256SUMS of $tag has no sum for $name.tar.gz" "URL: $base/SHA256SUMS"
[ "$expected" = "$actual" ] || die "$name.tar.gz does not match its SHA-256 sum" \
    "Expected $expected" "Got      $actual" "The download is damaged or was altered on the way; try again."
ok "The SHA-256 sum matches $o_dim(${actual%"${actual#????????????}"}$dots)$o_off"

# --- 5. Install ---------------------------------------------------------------

begin "Unpacking into $(pretty "$home/versions/$tag")"
mkdir -p "$home/versions" "$home/bin" 2>>"$work/log" ||
    die "Cannot create $home" "Why: $(tail -n 1 "$work/log")" "Pick another directory with --home <dir>."
run "Unpacking into $(pretty "$home/versions/$tag")" tar -xzf "$work/$name.tar.gz" -C "$work" ||
    die "Unpacking $name.tar.gz failed" "The archive may be damaged; try again."
[ -d "$work/$name" ] || die "$name.tar.gz has no $name directory" "The release is not laid out as this script expects."
rm -rf "$home/versions/$tag"
mv "$work/$name" "$home/versions/$tag"
rm -f "$home/bin/ore.next"
ln -s "../versions/$tag/bin/ore" "$home/bin/ore.next"
mv -f "$home/bin/ore.next" "$home/bin/ore"
detail "$home/bin/ore -> ../versions/$tag/bin/ore"
runs=$("$home/bin/ore" version 2>>"$work/log") ||
    die "The installed ore does not run" "Why: $(tail -n 1 "$work/log")" "Binary: $home/versions/$tag/bin/ore"
ok "Installed ore $runs in $o_code$(pretty "$home/bin/ore")$o_off $o_dim$m_link versions/$tag$o_off"

# --- 6. PATH ------------------------------------------------------------------

begin "Checking PATH"
[ -n "$live" ] && printf '\r%s[K' "$esc"
line="export PATH=\"$home/bin:\$PATH\""
# The startup files that do not put <home>/bin in PATH yet: those of bash and
# zsh when they exist or are the login shell, .profile, and fish's conf.d.
todo=
for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    case "$rc" in
        */.zshrc) [ -f "$rc" ] || [ "$(basename "${SHELL:-}")" = zsh ] || continue ;;
        */.bashrc) [ -f "$rc" ] || [ "$(basename "${SHELL:-}")" = bash ] || continue ;;
    esac
    grep -qs "$home/bin" "$rc" || todo="$todo $rc"
done
fish_conf=
if command -v fish >/dev/null; then
    conf=$HOME/.config/fish/conf.d/ore.fish
    [ -f "$conf" ] || { fish_conf=$conf; todo="$todo $conf"; }
fi
in_path=
case ":${PATH:-}:" in *":$home/bin:"*) in_path=1 ;; esac

added=
if [ -z "$todo" ]; then
    ok "PATH has $(pretty "$home/bin") in your shells' startup files"
else
    names=
    for rc in $todo; do names="$names${names:+, }$(pretty "$rc")"; done
    if [ -n "$modify_path" ] && ask "Add $(pretty "$home/bin") to PATH in $names" y; then
        for rc in $todo; do
            if [ "$rc" = "$fish_conf" ]; then
                mkdir -p "$(dirname "$rc")"
                printf 'fish_add_path %s\n' "$home/bin" >"$rc"
            else
                printf '\n# ore\n%s\n' "$line" >>"$rc"
            fi
            detail "added to $rc"
        done
        added=$names
        ok "Added $(pretty "$home/bin") to PATH in $names"
    else
        if [ -n "$modify_path" ]; then why="as you asked"; else why="--no-modify-path"; fi
        note "PATH is left as it is $o_dim($why); the line to add is below$o_off"
    fi
fi

# Another ore that comes first in PATH (Homebrew's, an older copy) would hide this one.
other=$(command -v ore 2>/dev/null || true)
if [ -n "$other" ] && [ "$other" != "$home/bin/ore" ]; then
    other_version=$("$other" version 2>/dev/null || echo "?")
    if [ -n "$in_path" ]; then
        say "    $o_warn$m_warn$o_off Another ore comes first in PATH: $o_code$(pretty "$other")$o_off $o_dim($other_version)$o_off"
        case $other in
            */Cellar/* | */homebrew/* | */linuxbrew/*) say "      It is Homebrew's: ${o_code}brew uninstall ore$o_off removes it (or keep that one: brew upgrade ore)" ;;
            *) say "      Remove it, or put $(pretty "$home/bin") before its directory in PATH." ;;
        esac
    fi
fi

# --- Summary ------------------------------------------------------------------

printf '\n  %s%s%s %sore %s is installed.%s\n\n' "$o_ok" "$m_ok" "$o_off" "$o_bold" "$tag" "$o_nobold"
if [ -z "$in_path" ]; then
    if [ -z "$todo" ] || [ -n "$added" ]; then
        say "  Open a new shell, or run this to use ore in this one:"
        say "    $o_code$line$o_off"
    else
        say "  Add this line to your shell's startup file ($names), and run it to use ore now:"
        say "    $o_code$line$o_off"
        [ -z "$fish_conf" ] || say "    ${o_dim}fish:$o_off ${o_code}fish_add_path $home/bin$o_off"
    fi
    say ""
fi
say "  ${o_bold}Next:$o_nobold"
say "    ${o_accent}ore version$o_off                $o_dim# $runs$o_off"
say "    ${o_accent}ore help$o_off                   $o_dim# the commands$o_off"
say "    ${o_code}echo 'console.log(\"Hello, Ore\")' > hello.ore && ore run hello.ore$o_off"
say ""
say "  ${o_dim}Update:$o_off    ${o_accent}ore update$o_off"
if [ -n "$added" ]; then
    say "  ${o_dim}Uninstall:$o_off rm -rf $(pretty "$home"), and the \"# ore\" lines in $added"
else
    say "  ${o_dim}Uninstall:$o_off rm -rf $(pretty "$home"), and the \"# ore\" lines in your shell's startup files"
fi
say "  ${o_dim}Docs:$o_off      https://github.com/$repo"
say ""
exit 0
