#!/usr/bin/env bash
# Serve the schematic designer and the CircuiTikZ PDF compiler.
#   ./run.sh
# Then open http://127.0.0.1:8757/designer.html
set -euo pipefail

cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  set -- python3
elif command -v python >/dev/null 2>&1; then
  set -- python
elif command -v py >/dev/null 2>&1; then
  set -- py -3
else
  echo "Python 3 is required to run serve.py." >&2
  exit 1
fi

url="http://127.0.0.1:8757/designer.html"
echo "Schematic designer: $url"
echo "Verilog viewer:     http://127.0.0.1:8757/verilog.html"
echo "Press Ctrl+C to stop."

(
  sleep 0.7
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url"
  elif command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v cygstart >/dev/null 2>&1; then
    cygstart "$url"
  elif command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe //c start "" "$url"
  fi
) >/dev/null 2>&1 &

exec "$@" serve.py
