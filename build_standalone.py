"""Embed the Icarus WASM toolchain for offline VCD generation.

vendor/*.js and vendor/*.wasm become engine.js, which designer.html loads
when you press Generate. verilog.html and shell.html open the designer.
Icarus Verilog is GPL-2.0-or-later.
"""
import base64
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
ENGINE = ROOT / "engine.js"
REDIRECT = ROOT / "verilog.html"

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verilog Schematic</title>
<script>
location.replace("designer.html" + (location.search || "") + (location.hash || ""));
</script>
</head>
<body>
<p><a href="designer.html">Open the designer</a></p>
</body>
</html>
"""


def main() -> None:
    engines = {}
    for name in ("ivlpp", "ivl", "vvp"):
        engines[name] = {
            "js": base64.b64encode((VENDOR / f"{name}.js").read_bytes()).decode("ascii"),
            "wasm": base64.b64encode((VENDOR / f"{name}.wasm").read_bytes()).decode("ascii"),
        }
    header = (
        "/* Icarus Verilog (GPL-2.0-or-later), embedded for offline simulation.\n"
        "   https://github.com/steveicarus/iverilog\n"
        "   Built by build_standalone.py from vendor/. */\n"
    )
    ENGINE.write_text(
        header + "window.VSCH_ENGINE=" + json.dumps(engines, separators=(",", ":")) + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    REDIRECT.write_text(PAGE, encoding="utf-8", newline="\n")
    print(f"wrote {ENGINE} ({ENGINE.stat().st_size} bytes)")
    print(f"wrote {REDIRECT} ({REDIRECT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
