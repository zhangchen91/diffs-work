#!/usr/bin/env python3
"""Write a small, text-only A4 PDF with a real CJK font. Test fixtures only.

Usage:  python3 scripts/make-pdf.py out.pdf title text.txt [--font PATH] [--dpi-note]

Why this exists: the PDF fixtures must be readable (Chinese text) *and* carry a
real text layer, because the PDF diff reads `getTextContent()` and compares the
character rectangles. Type1 base fonts cannot encode CJK, so the glyphs used by
the document are subset from a system font and embedded as a TrueType CID font.
"""
import struct
import sys
import textwrap

PAGE_W, PAGE_H = 595, 842
LEFT, TOP, SIZE, LEADING = 56, 780, 12, 19
DEFAULT_FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"


def esc(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def to_unicode_cmap(cmap):
    """Build a ToUnicode CMap for the embedded subset (glyph id -> unicode)."""
    entries = sorted(cmap.items())  # (gid, text)
    chunks = []
    for gid, text in entries:
        hexstr = "".join("%04X" % ord(c) for c in text)
        chunks.append("<%04X> <%s>" % (gid, hexstr))
    body = "\n".join(chunks)
    return (
        "/CIDInit /ProcSet findresource begin\n"
        "12 dict begin\nbegincmap\n"
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
        "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n"
        "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n"
        "%d beginbfchar\n%s\nendbfchar\n"
        "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n"
        % (len(entries), body)
    )


def build(lines, title, font_path):
    from fontTools import subset
    from fontTools.ttLib import TTFont

    text = "\n".join(lines)
    charset = sorted(set(text) - {"\n"})
    # 1) subset the font to the glyphs the document uses
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.drop_tables += ["DSIG"]
    font = TTFont(font_path, fontNumber=0)
    sub = subset.Subsetter(options=opts)
    sub.populate(text="".join(charset))
    sub.subset(font)
    font.flavor = None
    font.save("/tmp/_pdfsubset.ttf")

    # 2) glyph ids come from post-subset cmap
    sub_font = TTFont("/tmp/_pdfsubset.ttf")
    cmap = sub_font.getBestCmap()
    gid_of = {}
    unicode_of_gid = {}
    for ch in charset:
        code = cmap.get(ord(ch))
        if code is None:
            continue
        gid = sub_font.getGlyphID(code)
        gid_of[ch] = gid
        unicode_of_gid[gid] = ch
    for ch, gid in gid_of.items():
        unicode_of_gid.setdefault(gid, ch)

    with open("/tmp/_pdfsubset.ttf", "rb") as fh:
        font_bytes = fh.read()
    head = sub_font["head"]
    units_per_em = head.unitsPerEm
    ascender = sub_font["hhea"].ascent
    descender = sub_font["hhea"].descent
    bbox = [head.xMin, head.yMin, head.xMax, head.yMax]

    def encode(s: str) -> bytes:
        out = bytearray()
        for ch in s:
            out += struct.pack(">H", gid_of.get(ch, 0))
        return bytes(out)

    # 3) lay out pages
    pages, cur, y = [], [], TOP
    for line in lines:
        for w in textwrap.wrap(line, 40) or [""]:
            if y < 70:
                pages.append(cur)
                cur, y = [], TOP
            cur.append((LEFT, y, w))
            y -= LEADING
    pages.append(cur)

    objs = []

    def add(body: bytes) -> int:
        objs.append(body if isinstance(body, bytes) else body.encode("latin-1"))
        return len(objs)

    fontfile = add(b"<< /Length %d /Length1 %d >>\nstream\n" % (len(font_bytes), len(font_bytes))
                   + font_bytes + b"\nendstream")
    desc = add(
        ("<< /Type /FontDescriptor /FontName /SubCJK /Flags 4 /FontBBox [%d %d %d %d] "
         "/ItalicAngle 0 /Ascent %d /Descent %d /CapHeight %d /StemV 80 /FontFile2 %d 0 R >>"
         % (bbox[0], bbox[1], bbox[2], bbox[3], ascender, descender, ascender, fontfile)).encode("latin-1")
    )
    cmap_bytes = to_unicode_cmap(unicode_of_gid).encode("latin-1")
    tounicode = add(b"<< /Length %d >>\nstream\n" % len(cmap_bytes) + cmap_bytes + b"\nendstream")
    cid_font = add(
        ("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SubCJK "
         "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
         "/FontDescriptor %d 0 R /DW %d /W [1 [%d]] /CIDToGIDMap /Identity >>"
         % (desc, 1000, 1000 * 0 + int(units_per_em))).encode("latin-1")
    )
    type0 = add(
        ("<< /Type /Font /Subtype /Type0 /BaseFont /SubCJK /Encoding /Identity-H "
         "/DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>" % (cid_font, tounicode)).encode("latin-1")
    )

    contents = []
    for pg in pages:
        cmds = [b"BT", b"/F1 %d Tf" % SIZE]
        for x, py, txt in pg:
            cmds.append(b"1 0 0 1 %d %d Tm <%s> Tj" % (x, py, encode(txt).hex().encode("latin-1")))
        cmds.append(b"ET")
        stream = b"\n".join(cmds)
        contents.append(add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"))

    pages_id = len(objs) + len(pages) + 1
    page_ids = []
    for cid in contents:
        page_ids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] "
                b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_id, PAGE_W, PAGE_H, type0, cid)
            )
        )
    real_pages_id = add(
        b"<< /Type /Pages /Count %d /Kids [%s] >>"
        % (len(page_ids), " ".join("%d 0 R" % p for p in page_ids).encode())
    )
    assert real_pages_id == pages_id, "page parent id drifted"
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % real_pages_id)

    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for i, body in enumerate(objs, start=1):
        offsets[i] = len(out)
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for i in range(1, len(objs) + 1):
        out += b"%010d 00000 n \n" % offsets[i]
    info = add(b"<< /Title <%s> >>" % "".join("%04X" % ord(c) for c in title).encode("latin-1"))
    out += b"trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objs) + 1,
        catalog,
        info,
        xref,
    )
    return bytes(out)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out_path, title, src = args[0], args[1], args[2]
    font = DEFAULT_FONT
    if "--font" in sys.argv:
        font = sys.argv[sys.argv.index("--font") + 1]
    with open(src, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    data = build(lines, title, font)
    with open(out_path, "wb") as fh:
        fh.write(data)
    print("%s  %d bytes" % (out_path, len(data)))


if __name__ == "__main__":
    main()