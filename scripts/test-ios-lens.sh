#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
binary="$(mktemp "${TMPDIR:-/tmp}/anny-ios-protocol.XXXXXX")"
trap 'rm -f "$binary"' EXIT
"${CXX:-c++}" -std=c++20 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer -g \
  __tests__/ios/lens-protocol.cpp -o "$binary"
"$binary"
