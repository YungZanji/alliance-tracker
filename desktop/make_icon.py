from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets" / "alliance-tracker.ico"

NAVY = "#07111F"
NAVY_2 = "#10243D"
LIME = "#D9F99D"
LIME_DARK = "#65A30D"
BLUE = "#5CBBFF"
WHITE = "#F8FAFC"


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("arialbd.ttf", "segoeuib.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def build(size: int = 512) -> Image.Image:
    image = Image.new("RGBA", (size, size), NAVY)
    draw = ImageDraw.Draw(image)

    margin = 18
    draw.rounded_rectangle((margin, margin, size - margin, size - margin), radius=112, fill=NAVY_2)
    draw.rounded_rectangle((38, 38, size - 38, size - 38), radius=96, outline=BLUE, width=8)

    # State 305-style crest: simple, readable, and distinctive at small sizes.
    crest = [
        (256, 76), (393, 126), (376, 326),
        (256, 414), (136, 326), (119, 126)
    ]
    draw.polygon(crest, fill=LIME)
    inner = [
        (256, 101), (368, 143), (354, 311),
        (256, 383), (158, 311), (144, 143)
    ]
    draw.polygon(inner, fill=LIME_DARK)

    title_font = font(132)
    text = "305"
    box = draw.textbbox((0, 0), text, font=title_font)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text(((size - tw) / 2, 220 - th / 2), text, font=title_font, fill=WHITE)

    # Small tracker bars make the purpose recognizable without cluttering the icon.
    baseline = 336
    bar_width = 24
    gap = 16
    heights = (42, 76, 58)
    start = 256 - (bar_width * 3 + gap * 2) / 2
    for index, height in enumerate(heights):
        x = int(start + index * (bar_width + gap))
        draw.rounded_rectangle((x, baseline - height, x + bar_width, baseline), radius=8, fill=BLUE)

    return image


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image = build()
    image.save(
        OUT,
        format="ICO",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(OUT)


if __name__ == "__main__":
    main()
