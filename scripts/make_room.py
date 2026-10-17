"""AIRTIGHT interrogation-room backgrounds, drawn as original pixel art.

Native size 320x180 (16:9). Scale up in CSS with image-rendering: pixelated.
Variants: empty (entry screen), he, she (suspect pronoun from the case).
"""
import numpy as np
from PIL import Image

W, H = 320, 180
rng = np.random.default_rng(71)

# Limited palette: warm room, tungsten light, pale table, cold-dark shadows.
PALETTE = np.array([
    (9, 9, 11), (17, 16, 16), (26, 24, 22), (36, 33, 29), (48, 43, 36),
    (63, 55, 44), (82, 70, 53), (108, 89, 62), (140, 112, 72), (178, 138, 80),
    (214, 168, 92), (240, 204, 130), (252, 236, 190),
    (52, 51, 49), (68, 67, 64), (86, 85, 81), (104, 102, 97), (122, 120, 114),
    (140, 137, 130), (158, 155, 146), (178, 174, 165), (198, 194, 184), (222, 218, 208),
    (30, 34, 38), (44, 50, 55),
], dtype=float)

BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0) - 0.5

yy, xx = np.mgrid[0:H, 0:W].astype(float)
LAMP_X, LAMP_Y = 96, 34          # bulb position
TABLE_Y = 138                    # top edge of table


def base_wall():
    img = np.zeros((H, W, 3))
    img[:] = (30, 27, 24)
    # plaster blotches: low-frequency noise
    n = rng.normal(0, 1, (H // 6 + 2, W // 6 + 2))
    n = np.kron(n, np.ones((6, 6)))[:H, :W]
    img += n[..., None] * 3.0
    # fine grit
    img += rng.normal(0, 2.2, (H, W))[..., None]
    return img


def light(img):
    # warm pool on the wall, falling off with distance from the bulb
    dx, dy = (xx - LAMP_X) / 1.25, (yy - LAMP_Y - 30)
    d = np.sqrt(dx * dx + dy * dy)
    pool = np.clip(1 - d / 115, 0, 1) ** 1.8
    # cone: brighter below the shade
    cone = np.clip(1 - np.abs(xx - LAMP_X) / (12 + (yy - LAMP_Y) * 0.55), 0, 1)
    cone *= (yy > LAMP_Y + 6)
    glow = pool * 70 + cone * 18
    img += glow[..., None] * np.array([1.0, 0.78, 0.45])
    # vignette, heavier on the right where the UI panel sits
    vx = np.clip((xx - 150) / 170, 0, 1)
    vig = 1 - 0.55 * vx - 0.35 * (np.abs(yy - 80) / 100) ** 2
    img *= np.clip(vig, 0.35, 1)[..., None]
    return img


def rect(img, x0, y0, x1, y1, col):
    img[y0:y1, x0:x1] = col


def pipes(img):
    # three vertical conduits on the far left, lit edge facing the lamp
    for i, x in enumerate((10, 17, 23)):
        w = 4 if i == 0 else 3
        rect(img, x, 0, x + w, TABLE_Y + 4, (40, 36, 31))
        img[0:TABLE_Y + 4, x + w - 1] = (92, 78, 58)          # lit edge
        for y in (30, 76, 118):                                 # couplings
            rect(img, x - 1, y, x + w + 1, y + 3, (58, 50, 40))
            img[y, x - 1:x + w + 1] = (110, 92, 66)
    # junction box with a switch
    rect(img, 28, 70, 44, 90, (54, 48, 40))
    img[70, 28:44] = (104, 88, 64)
    img[70:90, 43] = (96, 82, 60)
    rect(img, 33, 75, 39, 85, (34, 31, 27))
    rect(img, 35, 77, 37, 81, (120, 100, 70))


def lamp(img):
    # cord
    img[0:LAMP_Y - 10, LAMP_X] = (22, 20, 18)
    # shade: dark dome
    for y in range(LAMP_Y - 12, LAMP_Y - 3):
        half = int(4 + (y - (LAMP_Y - 12)) * 2.2)
        img[y, LAMP_X - half:LAMP_X + half + 1] = (34, 31, 27)
        img[y, LAMP_X - half] = (70, 60, 46)
        img[y, LAMP_X + half] = (24, 22, 19)
    # bright rim
    rim = LAMP_Y - 3
    img[rim, LAMP_X - 24:LAMP_X + 25] = (214, 168, 92)
    img[rim + 1, LAMP_X - 23:LAMP_X + 24] = (150, 118, 74)
    # cage wires below the rim
    for k in range(-20, 21, 6):
        for t in range(0, 9):
            x = int(LAMP_X + k * (1 - t / 13))
            img[rim + 2 + t, x] = (176, 138, 82)
    img[rim + 10, LAMP_X - 13:LAMP_X + 14] = (176, 138, 82)
    # bulb
    for y in range(rim + 2, rim + 8):
        for x in range(LAMP_X - 3, LAMP_X + 4):
            if (x - LAMP_X) ** 2 + (y - rim - 4) ** 2 <= 10:
                img[y, x] = (252, 236, 190)


def chair(img):
    # empty chair back behind the table, under the light
    cx = LAMP_X
    rect(img, cx - 13, 96, cx + 14, 101, (46, 42, 37))
    img[96, cx - 13:cx + 14] = (120, 100, 70)
    for x in (cx - 12, cx + 11):
        rect(img, x, 96, x + 3, TABLE_Y, (40, 36, 32))
        img[96:TABLE_Y, x] = (96, 82, 60)
    rect(img, cx - 13, 108, cx + 14, 111, (40, 36, 32))


def figure(img, pronoun):
    """Seated silhouette, no face. Rim light from the lamp above."""
    cx = LAMP_X
    body = (14, 13, 13)
    rimc = (150, 118, 74)
    mask = np.zeros((H, W), bool)
    # head
    head_cy, head_r = 82, 9 if pronoun == "he" else 8
    mask |= ((xx - cx) ** 2 / (head_r - 1) ** 2 + (yy - head_cy) ** 2 / head_r ** 2) <= 1
    # neck
    mask |= (np.abs(xx - cx) <= 4) & (yy >= head_cy + 6) & (yy <= head_cy + 13)
    # shoulders and torso down to the table
    sw = 30 if pronoun == "he" else 24
    top = head_cy + 12
    t = np.clip((yy - top) / 15, 0, 1)
    halfw = 6 + (sw - 6) * np.sin(t * np.pi / 2) ** 0.8
    halfw -= np.clip((yy - top - 22) / 20, 0, 1) * 4      # slight taper at the waist
    mask |= (yy >= top) & (yy < TABLE_Y) & (np.abs(xx - cx) <= halfw)
    if pronoun == "she":
        # shoulder-length hair framing the head
        hair = ((xx - cx) ** 2 / 10 ** 2 + (yy - (head_cy - 1)) ** 2 / 10 ** 2) <= 1
        # hair falls to the shoulders, narrowing slightly at the ends
        fall = (yy >= head_cy) & (yy <= head_cy + 14)
        fall &= np.abs(xx - cx) <= 10 - np.clip(yy - head_cy - 9, 0, 5) * 0.6
        mask |= hair | fall
    img[mask] = body
    # rim light: pixels of the mask whose upper neighbour is outside
    up = np.zeros_like(mask)
    up[1:] = mask[:-1]
    edge = mask & ~up
    img[edge] = rimc
    # second, dimmer rim row on the head and shoulders
    edge2 = np.zeros_like(mask)
    edge2[1:] = edge[:-1]
    edge2 &= mask & (yy < top + 6)
    img[edge2] = (70, 58, 42)
    # forearms resting on the table
    for side in (-1, 1):
        x0 = cx + side * (sw - 6)
        xa, xb = sorted((x0, x0 - side * 14))
        rect(img, xa, TABLE_Y - 3, xb, TABLE_Y + 3, body)
        img[TABLE_Y - 3, xa:xb] = rimc


def table(img):
    # pale slab across the bottom, lit near the lamp
    top = TABLE_Y
    for y in range(top, H):
        shade = 168 - (y - top) * 1.6
        img[y, :] = (shade, shade * 0.98, shade * 0.93)
    lit = np.clip(1 - np.abs(xx - LAMP_X) / 140, 0, 1) ** 1.4
    tbl = yy >= top
    img[tbl] *= (0.55 + 0.5 * lit[tbl])[..., None]
    img[top, :] = (210, 205, 192)                    # front highlight edge
    img[top + 1, :] *= 1.06
    # soft shadow line where the far edge meets the wall
    img[top - 1, :] *= 0.55
    # the case file folder lying on the table
    rect(img, LAMP_X + 22, top + 6, LAMP_X + 46, top + 13, (120, 100, 70))
    img[top + 6, LAMP_X + 22:LAMP_X + 46] = (178, 138, 80)


def quantize(img):
    img = np.clip(img + BAYER[yy.astype(int) % 4, xx.astype(int) % 4][..., None] * 18, 0, 255)
    flat = img.reshape(-1, 3)
    d = ((flat[:, None, :] - PALETTE[None, :, :]) ** 2).sum(-1)
    return PALETTE[d.argmin(1)].reshape(H, W, 3).astype(np.uint8)


def render(variant):
    img = base_wall()
    pipes(img)
    img = light(img)
    if variant == "empty":
        chair(img)
    else:
        chair(img)
        figure(img, variant)
    lamp(img)
    table(img)
    return quantize(img)


def tight_crop(img):
    """Native-res 213x120 crop: suspect at ~30% across, lamp in frame, thin table edge."""
    cw, ch = 213, 120
    x0, y0 = LAMP_X - int(cw * 0.30), 22
    return img.crop((x0, y0, x0 + cw, y0 + ch))


if __name__ == "__main__":
    from PIL import ImageEnhance
    Image.fromarray(render("empty")).save("room-empty.png")        # entry screen
    for v in ("he", "she"):
        crop = tight_crop(Image.fromarray(render(v)))
        crop.save(f"zoom-{v}.png")                                   # briefing screen
        ImageEnhance.Brightness(crop).enhance(0.45).save(f"dim-{v}.png")  # interrogation screen
    print("ok")
