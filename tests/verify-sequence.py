"""Verify a 12 fps, 6 second image-sequence GIF against its source video.

Requires Pillow, NumPy and imageio-ffmpeg. Source images are not modified.
Usage: python tests/verify-sequence.py source.mp4 result.gif
"""
import argparse
import hashlib
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("gif")
args = parser.parse_args()

reader = imageio_ffmpeg.read_frames(args.source, pix_fmt="rgb24")
metadata = next(reader)
width, height = metadata["size"]
source_frames = [np.frombuffer(frame, dtype=np.uint8).reshape(height, width, 3) for frame in reader]
assert len(source_frames) == 72, len(source_frames)
assert metadata["fps"] == 12, metadata
assert abs(metadata["duration"] - 6) < .01, metadata

def background(rgb):
    rgb = rgb.astype(np.int16)
    # Label only unambiguous core green, not green-blended motion trails.
    return (rgb[:, :, 1] > 150) & (rgb[:, :, 1] > rgb[:, :, 0] + 90) & (rgb[:, :, 1] > rgb[:, :, 2] + 90)

def turquoise(rgb):
    rgb = rgb.astype(np.int16)
    return (rgb[:, :, 1] > rgb[:, :, 0] + 40) & (rgb[:, :, 2] > rgb[:, :, 0] + 40) & (np.abs(rgb[:, :, 1] - rgb[:, :, 2]) < 30)

def interior(mask):
    padded = np.pad(mask, 2, mode="constant", constant_values=False)
    return np.logical_and.reduce([
        padded[2 + dy:2 + dy + height, 2 + dx:2 + dx + width]
        for dy in range(-2, 3) for dx in range(-2, 3)
    ])

masks = [background(frame) for frame in source_frames]
clothing_masks = [turquoise(frame) for frame in source_frames]
gif = Image.open(args.gif)
assert gif.n_frames == 72, gif.n_frames
assert gif.size == (width, height), gif.size
assert gif.info.get("loop") == 0, "Animation must loop."
elapsed = checked = foreground = clothing_checked = 0
unique = set()
contact = Image.new("RGB", (424 * 4, 560), "white")
for i in range(gif.n_frames):
    gif.seek(i)
    assert gif.disposal_method == 2, (i, "Previous frame must be cleared.")
    delay = gif.info["duration"]
    assert delay in (80, 90), (i, delay)
    elapsed += delay
    rgba = np.array(gif.convert("RGBA"))
    reference = masks[i].copy()
    # Different video decoders may select an adjacent frame at a boundary.
    # Test background that is unequivocally green in all neighboring frames.
    for j in range(max(0, i - 1), min(72, i + 2)):
        reference &= masks[j]
    # Exclude the two-pixel antialiased boundary: codec color rounding there
    # is not an independent, reliable background/foreground label.
    reference = interior(reference)
    checked += int(reference.sum())
    leaks = int(np.count_nonzero(reference & (rgba[:, :, 3] > 0)))
    assert leaks == 0, (i, "Opaque green-background pixels", leaks)
    clothing = clothing_masks[i].copy()
    for j in range(max(0, i - 1), min(72, i + 2)):
        clothing &= clothing_masks[j]
    clothing = interior(clothing)
    clothing_checked += int(clothing.sum())
    assert not np.any(clothing & (rgba[:, :, 3] != 255)), (i, "Turquoise clothing was erased.")
    for x, y in [(450, 160), (525, 225), (300, 520), (450, 890)]:
        # Moving hair can leave a landmark on a green-blended motion edge.
        # Only assert independently identifiable neutral hair, skin or dark fabric.
        identifiable = True
        for j in range(max(0, i - 1), min(72, i + 2)):
            region = source_frames[j][y - 2:y + 3, x - 2:x + 3].astype(np.int16)
            r, g, b = region[:, :, 0], region[:, :, 1], region[:, :, 2]
            neutral = (region.min(axis=2) > 150) & (region.max(axis=2) - region.min(axis=2) < 40)
            skin = (r > g + 10) & (r > b + 30)
            dark = region.max(axis=2) < 90
            identifiable &= bool(np.all(neutral | skin | dark))
        if identifiable:
            assert rgba[y, x, 3] == 255, (i, "Foreground landmark was removed", x, y)
            foreground += 1
    unique.add(hashlib.sha256(rgba.tobytes()).hexdigest())
    if i in (3, 21, 39, 57):
        image = Image.fromarray(rgba).resize((424, 560), Image.Resampling.LANCZOS)
        checker = Image.new("RGB", image.size, "#ffffff")
        draw = ImageDraw.Draw(checker)
        for y in range(0, 560, 16):
            for x in range(0, 424, 16):
                if (x // 16 + y // 16) % 2 == 0:
                    draw.rectangle((x, y, x + 15, y + 15), fill="#e8eaee")
        checker.paste(image, mask=image.getchannel("A"))
        contact.paste(checker, ((3, 21, 39, 57).index(i) * 424, 0))

assert elapsed == 6000, elapsed
assert len(unique) == 72, ("Expected 72 distinct interpolated frames", len(unique))
contact.save(Path(args.gif).with_name("avatar-transparent-contact.png"))
print({"frames": gif.n_frames, "unique_frames": len(unique), "duration_ms": elapsed,
       "size": gif.size, "background_pixels_checked": checked, "opaque_background_leaks": 0,
       "foreground_landmarks_checked": foreground, "turquoise_clothing_pixels_checked": clothing_checked,
       "bytes": Path(args.gif).stat().st_size})
