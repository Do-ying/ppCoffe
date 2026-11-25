#!/usr/bin/env python3
"""
生成 TabBar 图标（线稿仪表风格，81x81，透明底）

风格与设计令牌一致：细线条、单色描边、无填充。
- 首页：仪表盘弧线 + 指针
- 记录：注水曲线
- 豆库：咖啡豆
- 曲线：坐标轴 + 上升折线

用法：python3 scripts/gen-tabbar-icons.py
"""

import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'tabbar')
SIZE = 81
NORMAL = (105, 114, 108, 255)   # #69726C
ACTIVE = (127, 209, 193, 255)    # #7FD1C1
W = 5


def canvas(color):
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def draw_home(d, color):
    """仪表盘：半圆弧 + 指针 + 底座"""
    d.arc([12, 18, 69, 75], start=180, end=360, fill=color, width=W)
    d.line([12, 56, 69, 56], fill=color, width=W)
    d.line([40, 56, 56, 32], fill=color, width=W)
    d.ellipse([34, 50, 46, 62], outline=color, width=W)


def draw_log(d, color):
    """记录：注水曲线 + 基准线"""
    d.line([12, 62, 69, 62], fill=color, width=W)
    pts = [(14, 56), (26, 44), (36, 50), (48, 30), (60, 38), (69, 22)]
    d.line(pts, fill=color, width=W, joint='curve')


def draw_bean(d, color):
    """豆库：咖啡豆（椭圆 + 中缝）"""
    d.ellipse([20, 14, 61, 67], outline=color, width=W)
    d.arc([30, 22, 52, 60], start=90, end=300, fill=color, width=W)


def draw_curve(d, color):
    """曲线：坐标轴 + 上升折线"""
    d.line([14, 14, 14, 66], fill=color, width=W)
    d.line([14, 66, 70, 66], fill=color, width=W)
    pts = [(20, 56), (32, 44), (42, 50), (54, 28), (66, 20)]
    d.line(pts, fill=color, width=W, joint='curve')


ICONS = {
    'home': draw_home,
    'log': draw_log,
    'bean': draw_bean,
    'curve': draw_curve,
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, fn in ICONS.items():
        for suffix, color in (('normal', NORMAL), ('active', ACTIVE)):
            img, d = canvas(color)
            fn(d, color)
            path = os.path.join(OUT_DIR, f'{name}-{suffix}.png')
            img.save(path, 'PNG')
            print(f'  ✓ {os.path.relpath(path, os.path.dirname(__file__))}')
    print('\nTabBar 图标生成完成\n')


if __name__ == '__main__':
    main()
