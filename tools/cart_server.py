#!/usr/bin/env python3
"""Share a folder of .p8 / .p8.png carts with the FAKE-08 TV app over the LAN.

    python3 tools/cart_server.py <carts_dir> [--port 8808]

Layout, one folder per game, the same as the PICO8/ folder on a USB drive:

    <carts_dir>/<Game title>/<cart>.p8.png
    <carts_dir>/<Game title>/carts/<companion>.p8.png   (loaded by the game)

Endpoints:
    GET /index.json         {"files": [{"path": "Celeste/15133.p8.png", "mtime": 1790000000.0, "size": 12345}, ...]}
    GET /files/<path>       the file itself

The TV polls /index.json every few seconds, downloads what changed, and
restarts a running cart when its files change. Only .p8 and .p8.png files are
served. CORS is open so the app, whose origin is its own package, can read it.
"""
import argparse
import json
import os
import socket
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CART_SUFFIXES = (".p8", ".p8.png")


def list_carts(root):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith(".") or not name.lower().endswith(CART_SUFFIXES):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if "/" not in rel:
                continue  # carts must be inside a game folder
            st = os.stat(full)
            files.append({"path": rel, "mtime": st.st_mtime, "size": st.st_size})
    return files


def lan_address():
    """The address other machines on the LAN reach this one at."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))  # no packet is sent for UDP connect
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(BaseHTTPRequestHandler):
    """Only /index.json and /files/<cart> exist; nothing else is served."""
    root = "."

    def _reply(self, status, body, content_type, send_body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def _handle(self, send_body):
        path = urllib.parse.urlparse(self.path).path
        if path == "/index.json":
            body = json.dumps({"files": list_carts(self.root)}).encode()
            self._reply(200, body, "application/json", send_body)
            return
        if path.startswith("/files/"):
            rel = urllib.parse.unquote(path[len("/files/"):])
            root = os.path.realpath(self.root)
            full = os.path.realpath(os.path.join(root, rel))
            if full.startswith(root + os.sep) and full.lower().endswith(CART_SUFFIXES) and os.path.isfile(full):
                with open(full, "rb") as f:
                    self._reply(200, f.read(), "application/octet-stream", send_body)
                return
        self._reply(404, b"not found\n", "text/plain", send_body)

    def do_GET(self):
        self._handle(True)

    def do_HEAD(self):
        self._handle(False)

    def log_message(self, fmt, *args):
        line = fmt % args
        if "/index.json" not in line:  # the TV polls it every few seconds
            sys.stderr.write("%s %s\n" % (self.address_string(), line))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("carts_dir", help="folder with one subfolder per game")
    ap.add_argument("--port", type=int, default=8808)
    args = ap.parse_args()

    Handler.root = os.path.abspath(args.carts_dir)
    games = {f["path"].split("/", 1)[0] for f in list_carts(Handler.root)}
    print("Serving %d games from %s" % (len(games), Handler.root), flush=True)
    print("TV app PC address: http://%s:%d" % (lan_address(), args.port), flush=True)
    ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
