"""数据库增量迁移。

计划书第七节第 1 步：「现有数据库使用增量迁移，``manage.py init-db`` 的建表逻辑
不足以更新既有表。」

迁移约定：
- **只增不删**：新增列一律可空，旧数据原样保留
- **幂等**：可重复执行，已迁移过的库直接跳过
- **不猜类型**：旧豆子的 ``kind`` 保持 NULL（前端显示「待确认类型」），
  由用户确认后写入 —— 迁移**不自动**把旧豆子标成成品豆或生豆

用法：
    python manage.py migrate
"""

from __future__ import annotations

from typing import Any, Dict, List

from sqlalchemy import inspect, text

from ..extensions import db

__all__ = ["run_migrations", "migrate"]

#: 新增列定义：表名 → [(列名, DDL 类型, 注释)]
_ADDED_COLUMNS: Dict[str, List[tuple]] = {
    "beans": [
        ("kind", "VARCHAR(24)", "豆子类型 purchased_roasted/green，NULL 表示待确认"),
        ("purchase_cost_cents", "INTEGER", "实付豆款(分)，NULL 表示未填写采购价"),
    ],
    "roasts": [
        ("roast_level", "VARCHAR(32)", "每炉烘焙度"),
    ],
}


def _existing_columns(table: str) -> set:
    inspector = inspect(db.engine)
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def _add_column(table: str, column: str, ddl_type: str, comment: str) -> bool:
    """加一列（幂等）。返回是否真的执行了。"""
    if column in _existing_columns(table):
        return False
    # MySQL 的 COMMENT 语法；SQLite 不支持，用 ALTER TABLE ADD COLUMN 忽略注释
    dialect = db.engine.dialect.name
    if dialect == "mysql":
        ddl = (
            f"ALTER TABLE `{table}` ADD COLUMN `{column}` {ddl_type} "
            f"COMMENT '{comment}'"
        )
    else:
        ddl = f"ALTER TABLE `{table}` ADD COLUMN `{column}` {ddl_type}"
    db.session.execute(text(ddl))
    db.session.commit()
    return True


def _create_missing_tables() -> List[str]:
    """建缺失的表（rest_events 是本次新增的表）。"""
    # 显式导入全部模型 —— create_all 只认识已注册的模型，
    # 而注册发生在 api 模块被导入时，迁移可能先于它执行。
    from .. import models  # noqa: F401

    inspector = inspect(db.engine)
    before = set(inspector.get_table_names())
    db.create_all()
    after = set(inspect(db.engine).get_table_names())
    return sorted(after - before)


def run_migrations() -> Dict[str, Any]:
    """执行全部增量迁移，返回变更摘要。"""
    added: List[str] = []
    skipped: List[str] = []
    created_tables: List[str] = []

    # 1) 新增缺失的表
    created_tables = _create_missing_tables()

    # 2) 新增缺失的列
    for table, columns in _ADDED_COLUMNS.items():
        for column, ddl_type, comment in columns:
            if _add_column(table, column, ddl_type, comment):
                added.append(f"{table}.{column}")
            else:
                skipped.append(f"{table}.{column}")

    return {
        "addedColumns": added,
        "skippedColumns": skipped,
        "createdTables": created_tables,
    }


def migrate() -> None:
    """迁移入口（manage.py migrate）。"""
    from .. import create_app

    app = create_app()
    with app.app_context():
        summary = run_migrations()

    print("✅ 迁移完成")
    if summary["createdTables"]:
        print(f"   新建表：{', '.join(summary['createdTables'])}")
    if summary["addedColumns"]:
        print(f"   新增列：{', '.join(summary['addedColumns'])}")
    if summary["skippedColumns"]:
        print(f"   已存在（跳过）：{', '.join(summary['skippedColumns'])}")
    if not (summary["createdTables"] or summary["addedColumns"]):
        print("   数据库已是最新，无需变更")
    print()
    print("ℹ️  旧豆子的类型保持为空，前端会显示「待确认类型」；")
    print("   确认类型后可在豆子编辑页选择，类型一旦确认且已有业务记录即锁定。")
