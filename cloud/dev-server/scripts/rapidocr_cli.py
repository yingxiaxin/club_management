#!/usr/bin/env python3
"""本地 RapidOCR CLI：读图片路径，输出 JSON（供 Node 调用）。"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "message": "usage: rapidocr_cli.py <image>"}))
        return 2
    img = Path(sys.argv[1])
    if not img.is_file():
        print(json.dumps({"ok": False, "message": f"file not found: {img}"}))
        return 1
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as err:
        print(json.dumps({"ok": False, "message": f"rapidocr_onnxruntime 未安装: {err}"}))
        return 1

    ocr = RapidOCR()
    result, elapse = ocr(str(img))
    items = []
    for entry in result or []:
        box, text, score = entry[0], entry[1], float(entry[2])
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        items.append(
            {
                "text": str(text or "").strip(),
                "score": score,
                "x0": min(xs),
                "x1": max(xs),
                "y0": min(ys),
                "y1": max(ys),
                "cx": sum(xs) / len(xs),
                "cy": sum(ys) / len(ys),
            }
        )
    print(
        json.dumps(
            {
                "ok": True,
                "provider": "rapidocr",
                "elapse": elapse,
                "items": items,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
