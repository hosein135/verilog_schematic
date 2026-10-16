"""Embed the Icarus WASM toolchain and the schematic viewer into one HTML file."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
SHELL = ROOT / "shell.html"
SCHEM = ROOT / "schematic.js"
OUT = ROOT / "verilog.html"


def b64(path: pathlib.Path) -> str:
    raw = __import__("base64").b64encode(path.read_bytes()).decode("ascii")
    return "\n".join(raw[i : i + 120] for i in range(0, len(raw), 120))


def main() -> None:
    html = SHELL.read_text(encoding="utf-8")
    js = SCHEM.read_text(encoding="utf-8")
    if "</script>" in js.lower():
        raise SystemExit("schematic.js contains a script end tag")
    html = html.replace("@@SCHEMATIC_JS@@", js)
    for name in ("ivlpp", "ivl", "vvp"):
        html = html.replace(f"@@{name.upper()}_JS@@", b64(VENDOR / f"{name}.js"))
        html = html.replace(f"@@{name.upper()}_WASM@@", b64(VENDOR / f"{name}.wasm"))
    if "@@" in html:
        raise SystemExit("unreplaced placeholder in shell.html")
    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
