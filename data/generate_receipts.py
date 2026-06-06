#!/usr/bin/env python3
"""Render a synthetic receipt (NOT real) and degraded variants to test the
receipt-extraction flow and its confidence gating."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

os.makedirs("data/receipts", exist_ok=True)

LINES = [
    ("AL-FATAH SUPERSTORE", "title"),
    ("Gulberg III, Lahore", "small"),
    ("Tel: 042-111-555-666", "small"),
    ("Date: 14/03/2025  Time: 18:42", "small"),
    ("-" * 34, "mono"),
    ("Milk 1L x2                 560", "mono"),
    ("Whole Wheat Bread          150", "mono"),
    ("Eggs (dozen)               420", "mono"),
    ("Cooking Oil 5L           2,900", "mono"),
    ("Basmati Rice 5kg         1,850", "mono"),
    ("Chicken 1kg                850", "mono"),
    ("-" * 34, "mono"),
    ("SUBTOTAL                 6,730", "mono"),
    ("TOTAL            Rs      6,730", "bold"),
    ("CASH                     7,000", "mono"),
    ("CHANGE                     270", "mono"),
    ("-" * 34, "mono"),
    ("   Thank you for shopping!", "small"),
]

def load(name, size):
    for p in (f"/usr/share/fonts/truetype/dejavu/{name}",):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

fonts = {
    "title": load("DejaVuSans-Bold.ttf", 26),
    "bold": load("DejaVuSansMono-Bold.ttf", 20),
    "mono": load("DejaVuSansMono.ttf", 18),
    "small": load("DejaVuSans.ttf", 16),
}

W, H = 480, 720
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
y = 30
for text, kind in LINES:
    f = fonts[kind]
    w = d.textlength(text, font=f)
    x = (W - w) / 2 if kind in ("title", "small") else 60
    d.text((x, y), text, fill="black", font=f)
    y += 34 if kind == "title" else 28

img.save("data/receipts/receipt_clear.png")
img.filter(ImageFilter.GaussianBlur(3)).save("data/receipts/receipt_blurry.png")
img.rotate(18, expand=True, fillcolor="white").save("data/receipts/receipt_rotated.png")
img.crop((0, 0, W, int(H * 0.62))).save("data/receipts/receipt_cutoff.png")
print("wrote 4 receipt images to data/receipts/")
