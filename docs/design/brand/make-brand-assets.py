"""Brand assets for Taamara Taamara from the supplied logo: a transparent lotus mark,
a cropped original lockup, and lotus-lattice pattern tiles (SVG)."""
import sys
import numpy as np
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
im = Image.open(SRC).convert('RGB')

# 1. Lotus mark: keep pixels that differ clearly from the cream background.
box = (222, 192, 646, 432)
crop = im.crop(box)
a = np.asarray(crop, np.float32)
bg = np.asarray(crop.filter(ImageFilter.GaussianBlur(40)), np.float32)
ref = np.array([226, 216, 176], np.float32)
dist = np.minimum(np.linalg.norm(a - bg, axis=2), np.linalg.norm(a - ref, axis=2))
alpha = np.clip((dist - 30) / 28, 0, 1)
alpha_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
rgba = crop.copy()
rgba.putalpha(alpha_img)
bbox = alpha_img.point(lambda v: 255 if v > 40 else 0).getbbox()
mark = rgba.crop(bbox)
mark = mark.resize((mark.width * 2, mark.height * 2), Image.LANCZOS)
mark.save(f'{OUT}/lotus-mark.png', optimize=True)
print('lotus-mark', mark.size)

# 2. The supplied logo, cropped to its circle, for the brand board.
logo = im.crop((150, 110, 730, 690))
logo.save(f'{OUT}/logo-supplied.png', optimize=True)
print('logo-supplied', logo.size)

# 3. Lotus lattice tiles: a small three-petal lotus repeated on a half-drop grid.
def lattice(stroke, opacity, size=56):
    s = size
    petal = (
        'M{cx} {top}c{w} {h1} {w} {h2} 0 {h3}c-{w} -{h4} -{w} -{h5} 0 -{h3}z'
    )
    def lotus(cx, cy, k=1.0):
        top = cy - 9 * k
        p1 = f'M{cx} {top:.1f}c{3.2*k:.1f} {4*k:.1f} {3.2*k:.1f} {10.5*k:.1f} 0 {14*k:.1f}c-{3.2*k:.1f} -{3.5*k:.1f} -{3.2*k:.1f} -{10*k:.1f} 0 -{14*k:.1f}z'
        p2 = f'M{cx} {cy+5*k:.1f}c-{5*k:.1f} 0 -{9.5*k:.1f} -{3.5*k:.1f} -{10.5*k:.1f} -{9*k:.1f}c{5*k:.1f} 0 {9.5*k:.1f} {3.5*k:.1f} {10.5*k:.1f} {9*k:.1f}z'
        p3 = f'M{cx} {cy+5*k:.1f}c{5*k:.1f} 0 {9.5*k:.1f} -{3.5*k:.1f} {10.5*k:.1f} -{9*k:.1f}c-{5*k:.1f} 0 -{9.5*k:.1f} {3.5*k:.1f} -{10.5*k:.1f} {9*k:.1f}z'
        return p1 + p2 + p3
    d = lotus(s / 4, s / 4 + 2) + lotus(3 * s / 4, 3 * s / 4 + 2)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{s}" height="{s}" viewBox="0 0 {s} {s}">'
            f'<path d="{d}" fill="none" stroke="{stroke}" stroke-opacity="{opacity}" stroke-width="1.1" stroke-linejoin="round"/></svg>')

open(f'{OUT}/lattice-on-plum.svg', 'w').write(lattice('#F6EFE0', 0.13))
open(f'{OUT}/lattice-on-cream.svg', 'w').write(lattice('#861A41', 0.09))
print('lattice tiles written')
