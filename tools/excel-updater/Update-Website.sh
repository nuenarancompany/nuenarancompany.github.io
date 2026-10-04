#!/usr/bin/env sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is required. See README.md.' >&2
  exit 1
fi
if [ ! -d node_modules/xlsx ]; then
  printf '%s\n' 'Dependencies are missing. Run: npm install' >&2
  exit 1
fi
if [ ! -f private-key-path.txt ]; then
  printf '%s\n' 'Private key path is not configured. See README.md.' >&2
  exit 1
fi
IFS= read -r key_file < private-key-path.txt
if [ ! -f "$key_file" ]; then
  printf '%s\n' 'Private Firebase key file was not found. See README.md.' >&2
  exit 1
fi
if [ "$#" -gt 0 ]; then
  workbook=$1
else
  printf 'Excel file path: '
  IFS= read -r workbook
fi
if [ ! -f "$workbook" ]; then
  printf 'Excel file not found: %s\n' "$workbook" >&2
  exit 2
fi
node updater.cjs --preview "$workbook" --key "$key_file"
printf 'Apply this preview now? Type Y to continue: '
IFS= read -r answer
if [ "$answer" = Y ] || [ "$answer" = y ]; then
  node updater.cjs --apply "$workbook" --key "$key_file"
fi
