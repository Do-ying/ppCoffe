#!/usr/bin/env python3
"""ppCoffe H5 静态站点服务器（零依赖，仅用标准库）。

用途：在没有 Docker、没有 nginx 的机器上直接托管 Taro 打包出的 H5 产物。

    python3 serve_h5.py --root /path/to/dist-h5 --port 8081

设计要点：

* Taro H5 默认使用 **hash 路由**（``location.hash``），所以不需要
  SPA fallback 的 rewrite 规则 —— 任意路径找不到文件时返回 404 即可。
* 显式设置正确的 ``Content-Type``；``.js`` / ``.css`` 必须带正确的
  MIME，否则浏览器会拒绝执行脚本。
* 带 ETag 与 ``Last-Modified``，支持条件请求，避免重复传输。
* 静态文件一律 ``Cache-Control: public, max-age=...``；HTML 不缓存，
  保证发版后前端立刻生效。
"""

from __future__ import annotations

import argparse
import hashlib
import os
import posixpath
import sys
from email.utils import formatdate, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

#: 常见静态资源的 MIME 映射（补充 mimetypes 数据库里缺失的项）
EXTRA_MIME = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def guess_type(path: Path) -> str:
    """按扩展名推断 Content-Type。"""
    suffix = path.suffix.lower()
    if suffix in EXTRA_MIME:
        return EXTRA_MIME[suffix]
    import mimetypes

    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


class H5Handler(BaseHTTPRequestHandler):
    """静态文件处理器。"""

    server_version = "ppCoffeH5/1.0"
    protocol_version = "HTTP/1.1"

    root: Path
    #: 静态资源缓存秒数（HTML 始终不缓存）
    cache_seconds: int = 31536000

    # ------------------------------------------------------------------
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(
            "[%s] %s - %s\n" % (formatdate(usegmt=True), self.address_string(), fmt % args)
        )

    # ------------------------------------------------------------------
    def _resolve(self, url_path: str) -> Path | None:
        """把 URL 路径安全地映射到磁盘文件，阻止目录穿越。"""
        path = unquote(urlparse(url_path).path)
        # 归一化，去掉 .. 等成分
        path = posixpath.normpath(path)
        parts = [p for p in path.split("/") if p and p not in (".", "..")]
        candidate = self.root.joinpath(*parts)

        # 越界保护：解析后必须仍在 root 之内
        try:
            candidate.resolve().relative_to(self.root.resolve())
        except (ValueError, OSError):
            return None
        return candidate

    def _etag(self, path: Path, st) -> str:
        h = hashlib.md5(f"{path}:{st.st_mtime}:{st.st_size}".encode()).hexdigest()
        return f'"{h}"'

    # ------------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        self._serve(body=True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._serve(body=False)

    # ------------------------------------------------------------------
    def _serve(self, body: bool) -> None:
        target = self._resolve(self.path)

        if target is None or not target.exists():
            self._error(404, "Not Found")
            return

        if target.is_dir():
            index = target / "index.html"
            if not index.exists():
                self._error(404, "Not Found")
                return
            target = index

        try:
            st = target.stat()
            content = target.read_bytes() if body else b""
        except OSError:
            self._error(500, "Internal Server Error")
            return

        etag = self._etag(target, st)
        last_mod = formatdate(st.st_mtime, usegmt=True)

        # 条件请求
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        is_html = target.suffix.lower() in (".html", "")
        self.send_response(200)
        self.send_header("Content-Type", guess_type(target))
        self.send_header("Content-Length", str(st.st_size))
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", last_mod)
        # HTML 不缓存，保证发版立即生效；静态资源长缓存
        self.send_header(
            "Cache-Control",
            "no-cache, must-revalidate" if is_html else f"public, max-age={self.cache_seconds}",
        )
        self.end_headers()
        if body:
            self.wfile.write(content)

    def _error(self, code: int, message: str) -> None:
        payload = message.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="ppCoffe H5 静态服务器")
    parser.add_argument("--root", required=True, help="H5 产物目录")
    parser.add_argument("--port", type=int, default=8081, help="监听端口")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址")
    parser.add_argument(
        "--cache-seconds", type=int, default=31536000, help="静态资源缓存秒数"
    )
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        print(f"错误：目录不存在 {root}", file=sys.stderr)
        return 1

    H5Handler.root = root
    H5Handler.cache_seconds = args.cache_seconds

    server = ThreadingHTTPServer((args.host, args.port), H5Handler)
    server.daemon_threads = True
    print(f"ppCoffe H5 服务已启动：http://{args.host}:{args.port}  (root={root})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
