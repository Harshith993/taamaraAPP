"""Renders atmospheric event-light imagery (out-of-focus string lights, marigold bokeh,
stage wash) and a paper texture for the Taamara direction mockups."""
import math
import random
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]


def gradient(w, h, top, bottom):
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    arr = (1 - t) * np.array(top, np.float32) + t * np.array(bottom, np.float32)
    return np.repeat(arr, w, axis=1)


def layer_add(acc, discs, blur):
    h, w, _ = acc.shape
    img = Image.new('RGB', (w, h), (0, 0, 0))
    d = ImageDraw.Draw(img)
    for x, y, r, col, a in discs:
        c = tuple(int(max(0, min(255, ci * a))) for ci in col)
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    acc += np.asarray(img, dtype=np.float32)


def finish(acc, path, vignette=0.55, grain=3.0, seed=1, exposure=1.35):
    h, w, _ = acc.shape
    x = acc / 255.0
    y = 1 - np.exp(-exposure * x)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rr = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    y *= (1 - vignette * np.clip(rr - 0.35, 0, 1) ** 1.6)[:, :, None]
    rng = np.random.default_rng(seed)
    y = y * 255 + rng.normal(0, grain, y.shape)
    Image.fromarray(np.clip(y, 0, 255).astype(np.uint8)).save(path, quality=86, optimize=True, progressive=True)
    print('wrote', path)


def string_lights(acc, rng, *, n, y_range, sag_range, spacing, r, alpha, cols, blur, jitter=0.0, glow=None):
    h, w, _ = acc.shape
    for _ in range(n):
        y0 = rng.uniform(*y_range) * h
        sag = rng.uniform(*sag_range) * h
        xc = rng.uniform(0.25, 0.75) * w
        half = rng.uniform(0.6, 1.0) * w
        discs, glows = [], []
        x = -spacing * rng.random()
        while x < w + spacing:
            y = y0 + sag * (1 - ((x - xc) / half) ** 2) + rng.uniform(-jitter, jitter)
            col = cols[rng.randrange(len(cols))]
            rad = r * rng.uniform(0.85, 1.15)
            discs.append((x, y, rad, col, alpha * rng.uniform(0.7, 1.1)))
            if glow:
                glows.append((x, y, rad * glow[0], col, glow[1]))
            x += spacing * rng.uniform(0.9, 1.1)
        if glows:
            layer_add(acc, glows, blur=max(6, r * glow[0] * 0.6))
        layer_add(acc, discs, blur=blur)


WARM = [(255, 196, 120), (255, 176, 92), (255, 218, 160), (255, 160, 70)]
PINK = [(255, 120, 170), (240, 90, 150), (255, 160, 200)]

# 1. Night garden: warm string lights over a deep pond-teal night.
rng = random.Random(7)
W, H = 2400, 1400
acc = gradient(W, H, (6, 22, 22), (14, 30, 28))
layer_add(acc, [(rng.uniform(0, W), rng.uniform(0.45, 1.0) * H, rng.uniform(70, 150), PINK[rng.randrange(3)], 0.10) for _ in range(10)], blur=30)
string_lights(acc, rng, n=4, y_range=(0.05, 0.25), sag_range=(0.06, 0.16), spacing=70, r=3, alpha=1.0, cols=WARM, blur=1.2, glow=(7, 0.22))
string_lights(acc, rng, n=3, y_range=(0.15, 0.55), sag_range=(0.10, 0.22), spacing=150, r=34, alpha=0.42, cols=WARM, blur=2.5, jitter=6)
string_lights(acc, rng, n=2, y_range=(0.30, 0.70), sag_range=(0.12, 0.25), spacing=260, r=75, alpha=0.20, cols=WARM, blur=4, jitter=12)
finish(acc, f'{OUT}/night-garden.jpg', seed=7)

# 2. Sangeet stage: pink wash with gold bokeh.
rng = random.Random(21)
W, H = 1600, 1100
acc = gradient(W, H, (34, 8, 26), (18, 6, 20))
layer_add(acc, [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(120, 260), PINK[rng.randrange(3)], 0.16) for _ in range(9)], blur=40)
string_lights(acc, rng, n=3, y_range=(0.05, 0.4), sag_range=(0.05, 0.2), spacing=110, r=26, alpha=0.45, cols=WARM, blur=2, jitter=10)
string_lights(acc, rng, n=3, y_range=(0.1, 0.5), sag_range=(0.05, 0.15), spacing=48, r=2.5, alpha=1.0, cols=WARM, blur=1, glow=(6, 0.2))
finish(acc, f'{OUT}/sangeet-stage.jpg', seed=21)

# 3. Marigold: dense out-of-focus orange and gold garlands on deep maroon.
rng = random.Random(33)
W, H = 1600, 1100
acc = gradient(W, H, (40, 10, 8), (24, 6, 6))
MARI = [(255, 150, 20), (255, 182, 40), (240, 120, 10), (255, 205, 80)]
for k in range(5):
    x0 = rng.uniform(0.05, 0.95) * W
    discs = []
    for j in range(46):
        y = j * (H / 40) + rng.uniform(-8, 8)
        x = x0 + math.sin(j * 0.5 + k) * 14 + rng.uniform(-10, 10)
        discs.append((x, y, rng.uniform(26, 40), MARI[rng.randrange(4)], rng.uniform(0.35, 0.6)))
    layer_add(acc, discs, blur=3 + k)
layer_add(acc, [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(60, 120), MARI[rng.randrange(4)], 0.12) for _ in range(14)], blur=18)
finish(acc, f'{OUT}/marigold.jpg', seed=33)

# 4. Dawn shoot: soft sunrise glow for a pre-wedding shoot cover.
rng = random.Random(44)
W, H = 1600, 1100
acc = gradient(W, H, (52, 70, 104), (236, 160, 120))
layer_add(acc, [(W * 0.68, H * 0.78, 180, (255, 210, 150), 0.55)], blur=90)
layer_add(acc, [(rng.uniform(0, W), rng.uniform(0.5, 1) * H, rng.uniform(20, 60), (255, 225, 190), 0.12) for _ in range(18)], blur=6)
sil = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(sil)
base = int(H * 0.86)
d.rectangle([0, base, W, H], fill=255)
x = 0
while x < W:
    tw = rng.randint(60, 140)
    th = rng.randint(30, 110)
    d.rectangle([x, base - th, x + tw, base], fill=255)
    for m in range(x, x + tw, 22):
        d.rectangle([m, base - th - 14, m + 11, base - th], fill=255)
    x += tw + rng.randint(0, 40)
sil = np.asarray(sil.filter(ImageFilter.GaussianBlur(1.2)), np.float32)[:, :, None] / 255
acc = acc * (1 - sil * 0.93) + np.array((30, 20, 30), np.float32) * sil * 0.93
finish(acc, f'{OUT}/dawn-fort.jpg', vignette=0.35, seed=44, exposure=1.1)

# 5. Paper grain tile (seamless) for the stationery direction.
rng = np.random.default_rng(5)
S = 512
noise = rng.normal(0, 1, (S, S)).astype(np.float32)
f = np.fft.fft2(noise)
fy = np.fft.fftfreq(S)[:, None]
fx = np.fft.fftfreq(S)[None, :]
fibres = np.real(np.fft.ifft2(f * np.exp(-((fx * 40) ** 2 + (fy * 140) ** 2))))
fine = np.real(np.fft.ifft2(f * np.exp(-((fx * 220) ** 2 + (fy * 220) ** 2))))
tex = fibres / (fibres.std() + 1e-6) * 2.2 + fine / (fine.std() + 1e-6) * 1.4
base = np.array((250, 244, 241), np.float32)
img = base[None, None, :] + tex[:, :, None] * np.array((1.0, 1.0, 1.0), np.float32)
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(f'{OUT}/paper.png', optimize=True)
print('wrote paper.png')
