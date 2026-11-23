#!/usr/bin/env python3
"""Đổi dashboard.src.css (px, khung 1920) thành dashboard.css (rem; 1rem = 16px tại 1920)."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / 'renderer'
src = (root / 'dashboard.src.css').read_text(encoding='utf8')
def cv(m):
    v = float(m.group(1))
    return '0' if v == 0 else ('%.4f' % (v / 16)).rstrip('0').rstrip('.') + 'rem'
out = re.sub(r'(?<![\w.#-])(-?\d*\.?\d+)px', cv, src)
(root / 'dashboard.css').write_text(out, encoding='utf8')
print('ok', len(out))
