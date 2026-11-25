"""gunicorn 配置。

    gunicorn -c gunicorn.conf.py wsgi:app
"""

from __future__ import annotations

import multiprocessing
import os

bind = os.getenv("GUNICORN_BIND", "0.0.0.0:8000")
workers = int(os.getenv("GUNICORN_WORKERS", max(2, multiprocessing.cpu_count() * 2 + 1)))
worker_class = "gthread"
threads = int(os.getenv("GUNICORN_THREADS", "4"))
worker_connections = 1000

# 曲线点较多，请求体可能偏大
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))
graceful_timeout = 30
keepalive = 5

max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = 100

accesslog = "-" if not os.getenv("GUNICORN_ACCESS_LOG") else os.getenv("GUNICORN_ACCESS_LOG")
errorlog = "-"
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "info")

preload_app = True
