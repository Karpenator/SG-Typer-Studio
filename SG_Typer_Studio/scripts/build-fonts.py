#!/usr/bin/env python3
# Builds Wildjess webfonts from source TTF files supplied by the font owner and
# adds the glyphs Spanish and French lines need but the font lacks (á í ó ú ü ñ,
# their capitals, ¿ ¡ œ « » – —), composed from its own letters and accents.
# Needs fonttools and brotli:  python3 scripts/build-fonts.py /path/to/licensed/source-fonts
import math
import os
import sys
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

SOURCES = {"wildjess-normal": "wildjess normal.ttf", "wildjess-italic": "WILDI.TTF", "wildjess-bolditalic": "WILDBI.TTF"}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "fonts")
SOURCE_DIR = os.path.expanduser(sys.argv[1]) if len(sys.argv) > 1 else None
if not SOURCE_DIR:
    raise SystemExit("Usage: python3 scripts/build-fonts.py /path/to/licensed/source-fonts")

# new character: (base character, character whose accent is borrowed, the letter under that accent)
ACCENTED = {
    "á": ("a", "é", "e"), "í": ("ı", "é", "e"), "ó": ("o", "é", "e"), "ú": ("u", "é", "e"),
    "ü": ("u", "ö", "o"),
    "Á": ("A", "é", "e"), "É": ("E", "é", "e"), "Í": ("I", "é", "e"), "Ó": ("O", "é", "e"), "Ú": ("U", "é", "e"), "Ç": ("C", "ç", "c"),
}


def outline(font, glyph):
    pen = DecomposingRecordingPen(font.getGlyphSet())
    font.getGlyphSet()[glyph].draw(pen)
    return pen.value


def bounds(font, glyph):
    pen = BoundsPen(font.getGlyphSet())
    font.getGlyphSet()[glyph].draw(pen)
    return pen.bounds


def contours(value):
    out, current = [], []
    for op, args in value:
        current.append((op, args))
        if op in ("closePath", "endPath"):
            out.append(current)
            current = []
    return out


def replay(pen, parts, matrix=(1, 0, 0, 1, 0, 0)):
    target = TransformPen(pen, matrix)
    for op, args in parts:
        getattr(target, op)(*args)


def contour_bounds(contour):
    xs, ys = [], []
    for op, args in contour:
        for point in args:
            if point:
                xs.append(point[0])
                ys.append(point[1])
    return min(xs), min(ys), max(xs), max(ys)


def accent_of(font, cmap, source, plain):
    """The contours of `source` that are not its letter: the highest (or, for ç, the lowest) ones."""
    parts = contours(outline(font, cmap[ord(source)]))
    letter = bounds(font, cmap[ord(plain)])
    if source == "ç":
        return [c for c in parts if contour_bounds(c)[1] < letter[1] - 4]
    return [c for c in parts if contour_bounds(c)[1] > letter[3] * 0.72 and contour_bounds(c)[3] > letter[3] + 4]


def tilde_wave(width, cap):
    """A tilde as one closed contour: a sine wave with some thickness, its foot on y = 0."""
    span, rise, thick = width * 0.72, cap * 0.11, cap * 0.1
    steps = 28
    top = [(span * i / steps, rise * (1 + math.sin(2 * math.pi * i / steps + 0.3)) + thick) for i in range(steps + 1)]
    low = [(x + thick * 0.15, y - thick) for x, y in reversed(top)]
    points = [(round(x), round(y)) for x, y in top + low]
    return [("moveTo", (points[0],))] + [("lineTo", (point,)) for point in points[1:]] + [("closePath", ())]


def add_glyph(font, cmap, char, name, width, draw):
    pen = TTGlyphPen(font.getGlyphSet())
    draw(pen)
    font["glyf"][name] = pen.glyph()
    font["hmtx"][name] = (width, 0)
    font.setGlyphOrder(font.getGlyphOrder() + [name] if name not in font.getGlyphOrder() else font.getGlyphOrder())
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[ord(char)] = name
    cmap[ord(char)] = name


def build(key, filename):
    font = TTFont(os.path.join(SOURCE_DIR, filename))
    cmap = font.getBestCmap()
    if ord("ı") not in cmap and ord("i") in cmap:
        # A dotless i: the i's body without its dot
        parts = contours(outline(font, cmap[ord("i")]))
        body = min(parts, key=lambda c: contour_bounds(c)[1])
        add_glyph(font, cmap, "ı", "dotlessi.add", font["hmtx"][cmap[ord("i")]][0], lambda pen: replay(pen, body))
    for char, (base, source, plain) in ACCENTED.items():
        if ord(char) in cmap or ord(base) not in cmap or ord(source) not in cmap:
            continue
        accent = accent_of(font, cmap, source, plain)
        if not accent:
            continue
        base_name = cmap[ord(base)]
        base_box = bounds(font, base_name)
        ax0 = min(contour_bounds(c)[0] for c in accent)
        ax1 = max(contour_bounds(c)[2] for c in accent)
        ay0 = min(contour_bounds(c)[1] for c in accent)
        plain_box = bounds(font, cmap[ord(plain)])
        dx = (base_box[0] + base_box[2]) / 2 - (ax0 + ax1) / 2
        dy = 0 if char == "Ç" else (base_box[3] - plain_box[3]) + (0 if base_box[3] <= plain_box[3] + 8 else 0)
        if char == "Ç":
            dy = base_box[1] - plain_box[1]
        base_parts = outline(font, base_name)

        def draw(pen, base_parts=base_parts, accent=accent, dx=dx, dy=dy):
            replay(pen, base_parts)
            for contour in accent:
                replay(pen, contour, (1, 0, 0, 1, dx, dy))

        add_glyph(font, cmap, char, f"u{ord(char):04X}.add", font["hmtx"][base_name][0], draw)
    # ñ Ñ: the font has no tilde to borrow, so one is drawn over the letter
    slant = 0.2 if "italic" in key else 0
    for char, base in (("ñ", "n"), ("Ñ", "N")):
        if ord(char) not in cmap and ord(base) in cmap:
            name = cmap[ord(base)]
            box = bounds(font, name)
            cap = box[3] - box[1]
            wave = tilde_wave(box[2] - box[0], cap)
            left = (box[0] + box[2]) / 2 - (box[2] - box[0]) * 0.36
            bottom = box[3] + cap * 0.1
            base_parts = outline(font, name)

            def draw(pen, base_parts=base_parts, wave=wave, m=(1, 0, slant, 1, left + slant * cap * 0.5, bottom)):
                replay(pen, base_parts)
                replay(pen, wave, m)

            add_glyph(font, cmap, char, f"u{ord(char):04X}.add", font["hmtx"][name][0], draw)
    # ¿ and ¡: the ? and ! turned upside down
    for char, source in (("¿", "?"), ("¡", "!")):
        if ord(char) not in cmap and ord(source) in cmap:
            name = cmap[ord(source)]
            box = bounds(font, name)
            parts = outline(font, name)
            add_glyph(font, cmap, char, f"u{ord(char):04X}.add", font["hmtx"][name][0],
                      lambda pen, parts=parts, box=box: replay(pen, parts, (-1, 0, 0, -1, box[0] + box[2], box[3] + box[1] - 140)))
    # œ Œ: the o and the e side by side
    for char, left, right in (("œ", "o", "e"), ("Œ", "O", "E")):
        if ord(char) not in cmap and ord(left) in cmap and ord(right) in cmap:
            ln, rn = cmap[ord(left)], cmap[ord(right)]
            advance = font["hmtx"][ln][0]
            overlap = int(advance * 0.08)
            lp, rp = outline(font, ln), outline(font, rn)

            def draw(pen, lp=lp, rp=rp, shift=advance - overlap):
                replay(pen, lp)
                replay(pen, rp, (1, 0, 0, 1, shift, 0))

            add_glyph(font, cmap, char, f"u{ord(char):04X}.add", advance - overlap + font["hmtx"][rn][0], draw)
    # – —: the hyphen stretched
    for char, stretch in (("–", 1.5), ("—", 2.4)):
        if ord(char) not in cmap and ord("-") in cmap:
            name = cmap[ord("-")]
            parts = outline(font, name)
            add_glyph(font, cmap, char, f"u{ord(char):04X}.add", int(font["hmtx"][name][0] * stretch),
                      lambda pen, parts=parts, stretch=stretch: replay(pen, parts, (stretch, 0, 0, 1, 0, 0)))
    # « »: two < or > when the font has no guillemet
    for char, source in (("«", "<"), ("»", ">")):
        if ord(char) not in cmap and ord(source) in cmap:
            name = cmap[ord(source)]
            advance = font["hmtx"][name][0]
            parts = outline(font, name)

            def draw(pen, parts=parts, step=int(advance * 0.55)):
                replay(pen, parts, (0.8, 0, 0, 0.8, 0, 60))
                replay(pen, parts, (0.8, 0, 0, 0.8, step, 60))

            add_glyph(font, cmap, char, f"u{ord(char):04X}.add", int(advance * 1.3), draw)
    font["maxp"].numGlyphs = len(font.getGlyphOrder())
    font.flavor = "woff2"
    path = os.path.join(OUT, f"{key}.woff2")
    font.save(path)
    missing = "".join(c for c in "áíóúüñÁÉÍÓÚÑÇ¿¡œŒ«»–—" if ord(c) not in font.getBestCmap())
    print(key, os.path.getsize(path), "bytes", "still missing:", missing or "nothing")


for key, filename in SOURCES.items():
    build(key, filename)
