"""
Render the widget's picker preview to `app/src/main/res/drawable-nodpi/widget_preview.png`.

    python scripts/build-widget-preview.py        (needs Pillow)

**The output is committed.** A build must not depend on this having been run:
`res/xml/lifeos_widget_info.xml` names the drawable by resource id, so a missing
file is a build error rather than a silent fallback to the app icon — which is
the bug this whole file exists to fix.

Why a rendered PNG and not a vector. From API 31 the launcher lays out
`@layout/widget_preview` and draws the real thing; below that — and, as it turns
out, on some OEM launchers at any API level — it scales `previewImage` instead,
and a `previewImage` has to be a drawable. A vector drawable cannot set type, so
the first attempt drew the text as grey blocks and the result read as a loading
skeleton rather than a product. This draws the real words in the app's real
fonts.

Why Python rather than a `.mjs` like `build-sounds.mjs`: the point of this file
is typography, and Pillow can rasterise the `res/font` TTFs that the app itself
uses. Keeping the preview in the product's own type is worth the inconsistency.

Keep it in step with `res/layout/widget_preview.xml` and with `WidgetBody` —
both show the 4x2 (`FULL`) tier in the default `bloom` palette.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "app/src/main/res/font"
OUT = ROOT / "app/src/main/res/drawable-nodpi/widget_preview.png"

# bloom (ui/theme/Palette.kt). The widget is always drawn in the default
# palette here: the picker is shown before the widget exists, so there is no
# snapshot to read a palette from.
BG = "#0D0910"
SURFACE2 = "#241829"
TEXT = "#F6F4F8"
MUTED = "#A8A3B4"
ACCENT = "#FF5FA2"
ACCENT2 = "#FFA0C9"
GHOST = "#2A2730"  # text at 14%, over bg: the ring's ghosted 100% track

# The seven activity colours (ui/theme/Tokens.kt). Not part of any palette by
# design: they mean the same thing on the phone, the widget and the web.
SLEEP, DEEP_WORK, BREAK = "#5C6BC0", "#6EA8FF", "#4ADE80"
STUDY, LIFE_ADMIN, EXERCISE = "#B57BFF", "#FBBF24", "#FF7A9C"

S = 3  # render at 3x so the launcher scales down rather than up
W, H = 360 * S, 146 * S  # the last row's baseline plus the same padding as the top
PAD = 12 * S


def font(name: str, size_sp: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size_sp * S)


def main() -> None:
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=20 * S, fill=BG)

    # ---- the ring: the ghosted 100% track, then 68% of it lit ----
    r = 40 * S
    box = [PAD, PAD, PAD + r, PAD + r]
    d.arc(box, 0, 360, fill=GHOST, width=4 * S)
    d.arc(box, -90, -90 + 360 * 0.68, fill=ACCENT, width=4 * S)

    # ---- the two figures, in mono, and the pulse word ----
    x = PAD + r + 10 * S
    d.text((x, PAD + 1 * S), "68%", font=font("jetbrains_mono_medium.ttf", 20), fill=TEXT)
    d.text((x, PAD + 26 * S), "136/200 XP", font=font("jetbrains_mono_regular.ttf", 12), fill=MUTED)

    pulse_font = font("figtree_regular.ttf", 12)
    pw = d.textlength("Improving", font=pulse_font)
    d.text((W - PAD - pw, PAD + 12 * S), "Improving", font=pulse_font, fill=ACCENT2)

    # ---- the ribbon: the day's shape ----
    y = PAD + 48 * S
    span = W - 2 * PAD
    cells = [(SLEEP, 0.30), (DEEP_WORK, 0.17), (BREAK, 0.07),
             (STUDY, 0.25), (LIFE_ADMIN, 0.07), (EXERCISE, 0.14)]
    cx = PAD
    for colour, share in cells:
        w = span * share
        d.rectangle([cx, y, cx + w, y + 10 * S], fill=colour)
        cx += w

    # ---- the next two things ----
    title = font("figtree_regular.ttf", 13)
    time = font("jetbrains_mono_regular.ttf", 12)
    for i, (when, what) in enumerate([("16:30", "Read one chapter"),
                                      ("19:00", "Move for 45 minutes")]):
        ry = PAD + (68 + i * 30) * S
        d.rounded_rectangle([PAD, ry, PAD + 24 * S, ry + 24 * S], radius=8 * S, fill=SURFACE2)
        d.text((PAD + 32 * S, ry + 4 * S), what, font=title, fill=TEXT)
        tw = d.textlength(when, font=time)
        d.text((W - PAD - tw, ry + 5 * S), when, font=time, fill=MUTED)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({W}x{H})")


if __name__ == "__main__":
    main()
