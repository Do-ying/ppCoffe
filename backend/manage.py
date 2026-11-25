"""命令行工具。

    python manage.py init-db       # 建表
    python manage.py migrate       # 增量迁移（给既有库补新列 / 新表）
    python manage.py seed          # 灌入演示数据
    python manage.py run           # 本地起服务
    python manage.py export-openapi  # 导出 OpenAPI 3.1 文档
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402


def cmd_init_db() -> None:
    app = create_app()
    with app.app_context():
        db.create_all()
        print("✅ 数据表已创建")


def cmd_seed() -> None:
    app = create_app()
    with app.app_context():
        db.create_all()
        from app.seed.seed_data import seed_demo_data

        result = seed_demo_data()
        print(f"✅ 演示数据已写入：{result}")


def cmd_migrate() -> None:
    """增量迁移：给既有库补新表 / 新列。"""
    from app.services.migrations import migrate

    migrate()


def cmd_run() -> None:
    app = create_app()
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    print(f"🚀 ppCoffe API 运行中： http://{host}:{port}{app.config['API_PREFIX']}")
    app.run(host=host, port=port, debug=app.config.get("DEBUG", False))


def cmd_export_openapi() -> None:
    from app.openapi import build_spec

    app = create_app()
    with app.app_context():
        spec = build_spec()
    target = BACKEND_ROOT / "openapi.json"
    import json

    target.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ OpenAPI 文档已导出：{target}")


COMMANDS = {
    "init-db": cmd_init_db,
    "migrate": cmd_migrate,
    "seed": cmd_seed,
    "run": cmd_run,
    "export-openapi": cmd_export_openapi,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print("用法: python manage.py <" + " | ".join(COMMANDS) + ">")
        raise SystemExit(1)
    COMMANDS[sys.argv[1]]()


if __name__ == "__main__":
    main()
