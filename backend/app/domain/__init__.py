"""domain 层：与前端 ``src/domain/`` 一一对应的纯函数算法。

这一层不依赖 Flask / SQLAlchemy，可单独测试，
后端与前端对同一输入必须产出完全一致的数值。
"""

from __future__ import annotations

__all__ = [
    "compat",
    "curve",
    "diagnosis",
    "flavor",
    "interpolate",
    "methods",
    "roast",
]
