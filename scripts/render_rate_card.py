#!/usr/bin/env python3
"""Render Vendor D's printed rate card, then make it look photographed on a phone at an angle.

Usage: render-rate-card.py <spec.json> <clean.png> <photo.png>

Step 1 renders a flat, crisp card (as if printed). Step 2 smudges the cells marked in the spec,
then applies perspective, rotation, uneven lighting, sensor noise, slight blur and JPEG artefacts.
Text edges therefore look printed-then-photographed, not drawn onto a skewed canvas.
"""
import json, sys, random
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(7)
np.random.seed(7)

spec = json.load(open(sys.argv[1]))
clean_path, photo_path = sys.argv[2], sys.argv[3]

W = 2100
SERIF_B = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
SANS_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
f_title = ImageFont.truetype(SERIF_B, 64)
f_sub = ImageFont.truetype(SANS, 30)
f_h = ImageFont.truetype(SANS_B, 32)
f_cell = ImageFont.truetype(SANS, 34)
f_small = ImageFont.truetype(SANS, 26)

def inr(n):
    s = f"{int(n):,}"
    return s

# ---------- layout ----------
rows = []  # (kind, text-per-column, smudge-cols)
rows.append(('section', ['Ocean freight – FCL (INR per container)', '', ''], []))
rows.append(('head', ['Route', "20'", "40'"], []))
for r in spec['fcl']:
    rows.append(('row', [r['route'], inr(r['p20']), inr(r['p40'])], [{'p20': 1, 'p40': 2}[s] for s in r.get('smudge', [])]))
rows.append(('section', ['Ocean freight – LCL (INR per w/m)', '', ''], []))
rows.append(('head', ['Route', 'Rate', ''], []))
for r in spec['lcl']:
    rows.append(('row', [r['route'], inr(r['price']), ''], [1] if r.get('smudge') else []))
rows.append(('section', ['Air freight (INR per kg chargeable, min. 100 kg)', '', ''], []))
rows.append(('head', ['Route', 'Rate', ''], []))
for r in spec['air']:
    rows.append(('row', [r['route'], inr(r['price']), ''], [1] if r.get('smudge') else []))

ROW_H = 58
TOP = 300
H = TOP + ROW_H * len(rows) + 260
img = Image.new('RGB', (W, H), (252, 251, 247))
d = ImageDraw.Draw(img)

# header
d.rectangle([0, 0, W, 18], fill=(24, 62, 99))
d.text((90, 60), spec['name'], font=f_title, fill=(24, 62, 99))
d.text((90, 145), 'Ocean & Air Rate Card  ·  ' + spec['validity'], font=f_sub, fill=(70, 70, 70))
d.text((90, 190), 'Prepared for: Category Buyer, Mumbai   |   Ref: SCFL/RC/2026-09', font=f_sub, fill=(70, 70, 70))
d.line([90, 245, W - 90, 245], fill=(24, 62, 99), width=3)

cols = [90, 1150, 1600, W - 90]  # x boundaries
y = TOP
smudge_boxes = []
for kind, cells, smudge in rows:
    if kind == 'section':
        d.rectangle([cols[0], y + 8, cols[-1], y + ROW_H - 4], fill=(230, 236, 243))
        d.text((cols[0] + 16, y + 14), cells[0], font=f_h, fill=(24, 62, 99))
    elif kind == 'head':
        d.line([cols[0], y + ROW_H - 2, cols[-1], y + ROW_H - 2], fill=(90, 90, 90), width=2)
        for i, t in enumerate(cells):
            if not t: continue
            x = cols[i] + 16
            if i > 0:
                x = cols[i + 1] - 16 - d.textlength(t, font=f_h)
            d.text((x, y + 12), t, font=f_h, fill=(40, 40, 40))
    else:
        d.line([cols[0], y + ROW_H - 1, cols[-1], y + ROW_H - 1], fill=(200, 200, 200), width=1)
        for i, t in enumerate(cells):
            if not t: continue
            x = cols[i] + 16
            if i > 0:
                x = cols[i + 1] - 16 - d.textlength(t, font=f_cell)
            d.text((x, y + 10), t, font=f_cell, fill=(30, 30, 30))
            if i in smudge:
                smudge_boxes.append((cols[i] + 8, y + 2, cols[i + 1] - 8, y + ROW_H - 4))
    y += ROW_H

y += 30
d.text((90, y), spec['basisNote'], font=f_small, fill=(60, 60, 60))
d.text((90, y + 40), 'Subject to space and equipment availability. E&OE.', font=f_small, fill=(60, 60, 60))
d.text((90, y + 110), 'For SeaCrest Freight & Logistics', font=f_small, fill=(60, 60, 60))
d.text((90, y + 145), 'Authorised signatory', font=f_small, fill=(120, 120, 120))
d.rectangle([0, H - 14, W, H], fill=(24, 62, 99))

img.save(clean_path)

# ---------- smudges: blur + ink/water blot, applied to the flat print ----------
for (x0, y0, x1, y1) in smudge_boxes:
    region = img.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(4.2))
    img.paste(region, (x0, y0))
    blot = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blot)
    cx, cy = (x1 - x0) * 0.62, (y1 - y0) * 0.5
    for k in range(9):
        rx, ry = random.uniform(60, 130), random.uniform(18, 34)
        ox, oy = random.uniform(-70, 70), random.uniform(-12, 12)
        bd.ellipse([cx + ox - rx, cy + oy - ry, cx + ox + rx, cy + oy + ry], fill=(55, 45, 40, random.randint(120, 190)))
    blot = blot.filter(ImageFilter.GaussianBlur(6))
    img.paste(blot, (x0, y0), blot)

# ---------- photograph it ----------
card = np.array(img)
ch, cw = card.shape[:2]

# desk background
bg_h, bg_w = int(ch * 1.28), int(cw * 1.32)
yy, xx = np.mgrid[0:bg_h, 0:bg_w]
base = np.stack([
    110 + 25 * np.sin(yy / 90.0) + xx * 0.01,
    78 + 18 * np.sin(yy / 90.0 + 1) + xx * 0.008,
    52 + 12 * np.sin(yy / 90.0 + 2),
], axis=-1)
grain = np.random.normal(0, 6, (bg_h, bg_w, 1))
bg = np.clip(base + grain, 0, 255).astype(np.uint8)

# perspective: card corners -> trapezoid, slightly rotated
mx, my = int(bg_w * 0.10), int(bg_h * 0.09)
src = np.float32([[0, 0], [cw, 0], [cw, ch], [0, ch]])
dst = np.float32([
    [mx + 140, my + 40],
    [mx + cw - 30, my + 10],
    [mx + cw + 60, my + ch - 70],
    [mx + 30, my + ch + 40],
])
M = cv2.getPerspectiveTransform(src, dst)
warped = cv2.warpPerspective(card, M, (bg_w, bg_h), borderValue=(0, 0, 0))
mask = cv2.warpPerspective(np.full((ch, cw), 255, np.uint8), M, (bg_w, bg_h))

# drop shadow under the card
shadow = cv2.GaussianBlur(mask, (0, 0), 25).astype(np.float32) / 255.0
shadow = np.roll(np.roll(shadow, 28, axis=0), 18, axis=1)
out = bg.astype(np.float32) * (1 - 0.55 * shadow[..., None])
m3 = (mask[..., None] / 255.0)
out = out * (1 - m3) + warped.astype(np.float32) * m3

# uneven lighting: brighter top-left, darker bottom-right, plus a soft glare band
gy, gx = np.mgrid[0:bg_h, 0:bg_w]
light = 1.12 - 0.42 * (gx / bg_w) * 0.7 - 0.30 * (gy / bg_h)
glare = np.exp(-(((gx - bg_w * 0.35) / (bg_w * 0.12)) ** 2 + ((gy - bg_h * 0.25) / (bg_h * 0.5)) ** 2)) * 0.10
out = out * (light + glare)[..., None]

# slight rotation of the whole frame
Mr = cv2.getRotationMatrix2D((bg_w / 2, bg_h / 2), -2.6, 1.0)
out = cv2.warpAffine(out, Mr, (bg_w, bg_h), borderMode=cv2.BORDER_REPLICATE)

# sensor noise, motion-ish blur, white balance shift
out += np.random.normal(0, 7, out.shape)
out = cv2.GaussianBlur(out, (0, 0), 1.1)
out[..., 0] *= 1.04  # warm
out[..., 2] *= 0.96
out = np.clip(out, 0, 255).astype(np.uint8)

# phone-ish resolution and JPEG artefacts, then save as PNG (the file the vendor "sent")
ph_w = 1600
ph = cv2.resize(out, (ph_w, int(bg_h * ph_w / bg_w)), interpolation=cv2.INTER_AREA)
ok, buf = cv2.imencode('.jpg', cv2.cvtColor(ph, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 62])
jpg = cv2.imdecode(buf, cv2.IMREAD_COLOR)
cv2.imwrite(photo_path, jpg)
print(json.dumps({'clean': clean_path, 'photo': photo_path, 'smudged_cells': len(smudge_boxes), 'photo_size': [jpg.shape[1], jpg.shape[0]]}))
