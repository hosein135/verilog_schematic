"""Serve the designer and compile CircuiTikZ to PDF.

    py serve.py
    Open http://127.0.0.1:8757/designer.html

The PDF button posts the CircuiTikZ source to /compile. Compilation uses
tectonic or pdflatex. If neither is on PATH, the first compile downloads
tectonic into tools/.
"""
import json
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / "tools"
PORT = 8757
TECTONIC_URL = (
    "https://github.com/tectonic-typesetting/tectonic/releases/download/"
    "tectonic%400.15.0/tectonic-0.15.0-x86_64-pc-windows-msvc.zip"
)


def engine():
    for name in ("tectonic", "pdflatex", "xelatex"):
        found = shutil.which(name)
        if found:
            return name, found
    local = TOOLS / "tectonic.exe"
    if local.exists():
        return "tectonic", str(local)
    return "", ""


def ensure_tectonic():
    kind, path = engine()
    if path:
        return kind, path
    TOOLS.mkdir(exist_ok=True)
    zip_path = TOOLS / "tectonic.zip"
    print("downloading tectonic...")
    urllib.request.urlretrieve(TECTONIC_URL, zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(TOOLS)
    exe = next(TOOLS.rglob("tectonic.exe"), None)
    if exe is None:
        raise RuntimeError("tectonic.exe was not in the download")
    if exe.parent != TOOLS:
        target = TOOLS / "tectonic.exe"
        shutil.move(str(exe), str(target))
        exe = target
    return "tectonic", str(exe)


def compile_tex(tex: bytes) -> bytes:
    kind, path = ensure_tectonic()
    with tempfile.TemporaryDirectory(prefix="circuitikz-") as folder:
        work = Path(folder)
        (work / "main.tex").write_bytes(tex)
        if kind == "tectonic":
            cmd = [path, "-o", str(work), str(work / "main.tex")]
        else:
            cmd = [path, "-interaction=nonstopmode", "-halt-on-error", "main.tex"]
        proc = subprocess.run(
            cmd,
            cwd=str(work),
            capture_output=True,
            text=True,
            timeout=180,
        )
        pdf = work / "main.pdf"
        if proc.returncode != 0 or not pdf.exists():
            log = (proc.stdout or "") + "\n" + (proc.stderr or "")
            raise RuntimeError(log.strip()[-4000:] or "LaTeX did not produce a PDF")
        return pdf.read_bytes()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/compile":
            self.send_error(404, "not found")
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        tex = self.rfile.read(length)
        try:
            pdf = compile_tex(tex)
        except Exception as exc:
            body = str(exc).encode("utf-8", "replace")
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(pdf)))
        self.end_headers()
        self.wfile.write(pdf)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"designer at http://127.0.0.1:{PORT}/designer.html", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
