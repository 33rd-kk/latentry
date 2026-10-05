"""Draws the README banner (docs/assets/banner-{light,dark}.png): the name on
the left, and on the right what poseorbit is for, left to right: a picture,
the skeleton poseorbit drew from it turned 30 degrees and the picture a model
made from that skeleton, then the same for a close-up.

The pictures are in docs/assets/examples (see the README's Examples for how
they were made). Deterministic: re-running only changes the files when this
script or those pictures change.

    python scripts/make_banner.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "docs" / "assets"
EXAMPLES = ASSETS / "examples"
W, H, SCALE = 1280, 320, 2

THEMES = {
    "light": {"bg": "#fafafa", "fg": "#171717", "muted": "#737373", "border": "#e5e5e5", "accent": "#7c6cf0"},
    "dark": {"bg": "#0a0a0a", "fg": "#fafafa", "muted": "#a3a3a3", "border": "#262626", "accent": "#8b7cf6"},
}

TILE_W, TILE_H = 100, 146  # the 832x1216 outputs' shape
ARROW = 30  # the gap between tiles that holds an arrow
SPLIT = 34  # the gap between the turn and the close-up
TOP = 88

# (picture, label under it, gap before it: None, "arrow" or "split")
TILES = [
    ("reference.jpg", "picture", None),
    ("turn-skeleton.png", "yaw -30", "arrow"),
    ("turn-result.jpg", "generated", "arrow"),
    ("closeup-skeleton.png", "zoom x5", "split"),
    ("closeup-result.jpg", "generated", "arrow"),
]
# Headings over groups of tiles: (first tile, last tile, text).
GROUPS = [(1, 2, "turn"), (3, 4, "close-up")]


def font(size: int) -> ImageFont.FreeTypeFont:
    # Pillow's bundled font, so the script needs no font files (it has no
    # minus, times or arrow signs: labels stay ASCII, arrows are drawn).
    return ImageFont.load_default(size=size * SCALE)


def arrow(draw: ImageDraw.ImageDraw, x0: float, x1: float, y: float, colour: str) -> None:
    s = SCALE
    draw.line([x0 * s, y * s, (x1 - 3) * s, y * s], fill=colour, width=2 * s)
    draw.polygon([((x1 - 8) * s, (y - 5) * s), (x1 * s, y * s), ((x1 - 8) * s, (y + 5) * s)], fill=colour)


def banner(theme: dict) -> Image.Image:
    s = SCALE
    image = Image.new("RGB", (W * s, H * s), theme["bg"])
    draw = ImageDraw.Draw(image)

    draw.text((56 * s, 104 * s), "poseorbit", font=font(60), fill=theme["fg"])
    draw.text((58 * s, 178 * s), "Pick a person, turn the pose in 3D, frame it,", font=font(18), fill=theme["muted"])
    draw.text((58 * s, 203 * s), "and draw the skeleton your image model follows.", font=font(18), fill=theme["muted"])

    gaps = {None: 0, "arrow": ARROW, "split": SPLIT}
    width = sum(TILE_W + gaps[gap] for _, _, gap in TILES)
    x = W - 48 - width
    lefts = []
    for name, label, gap in TILES:
        if gap == "arrow":
            arrow(draw, x + 6, x + ARROW - 6, TOP + TILE_H / 2, theme["accent"])
        elif gap == "split":
            middle = x + SPLIT / 2
            draw.line([middle * s, (TOP + 16) * s, middle * s, (TOP + TILE_H - 16) * s], fill=theme["border"], width=s)
        x += gaps[gap]
        lefts.append(x)
        tile = Image.open(EXAMPLES / name).convert("RGB").resize((TILE_W * s, TILE_H * s), Image.Resampling.LANCZOS)
        mask = Image.new("L", tile.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, tile.width - 1, tile.height - 1], radius=8 * s, fill=255)
        image.paste(tile, (x * s, TOP * s), mask)
        draw.rounded_rectangle(
            [x * s, TOP * s, (x + TILE_W) * s - 1, (TOP + TILE_H) * s - 1], radius=8 * s, outline=theme["border"], width=s
        )
        text = draw.textlength(label, font=font(12))
        draw.text((x * s + (TILE_W * s - text) / 2, (TOP + TILE_H + 10) * s), label, font=font(12), fill=theme["muted"])
        x += TILE_W

    for first, last, heading in GROUPS:
        left, right = lefts[first], lefts[last] + TILE_W
        text = draw.textlength(heading, font=font(13))
        draw.text(((left + right) / 2 * s - text / 2, (TOP - 26) * s), heading, font=font(13), fill=theme["fg"])
        draw.line([left * s, (TOP - 8) * s, right * s, (TOP - 8) * s], fill=theme["border"], width=s)
    return image


def main() -> None:
    for name, theme in THEMES.items():
        path = ASSETS / f"banner-{name}.png"
        banner(theme).save(path, optimize=True)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
