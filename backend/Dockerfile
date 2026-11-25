# ppCoffe 后端镜像
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=UTC

WORKDIR /app

# PyPI 源可配置：国内机器建议指向阿里云/清华镜像（实测快 10 倍以上）
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=""
ARG PIP_RETRIES=10
ARG PIP_TIMEOUT=120

# 依赖单独一层，改代码不会失效缓存
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --retries ${PIP_RETRIES} --timeout ${PIP_TIMEOUT} \
      -i ${PIP_INDEX_URL} \
      ${PIP_TRUSTED_HOST:+--trusted-host ${PIP_TRUSTED_HOST}} \
      -r requirements.txt

COPY . .

RUN mkdir -p /app/var/uploads

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health').read()"

CMD ["gunicorn", "-c", "gunicorn.conf.py", "wsgi:app"]
