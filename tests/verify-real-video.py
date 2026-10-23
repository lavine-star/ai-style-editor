"""Validate the actual source video's encoded GIF, not a synthetic fixture.

Requires Pillow, NumPy and imageio-ffmpeg. Usage:
python tests/verify-real-video.py source.mp4 output.gif
"""
import argparse
import math
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("gif")
parser.add_argument("--fps", type=float, default=30)
args = parser.parse_args()

frames = imageio_ffmpeg.read_frames(args.source, pix_fmt="rgb24")
metadata = next(frames)
width, height = metadata["size"]
source_fps = metadata["fps"]
gif = Image.open(args.gif)
assert gif.size == (width, height)
assert gif.n_frames == math.ceil(metadata["duration"] * args.fps)

cache = {}
next_source = 0
last_source = None
source_ended = False
checked_pixels = 0
leaks = 0
duration = 0
foreground_checks = 0

def read_through(index):
    global next_source, last_source, source_ended
    while next_source <= index and not source_ended:
        try:
            rgb = np.frombuffer(next(frames), dtype=np.uint8).reshape(height, width, 3).astype(np.int16)
        except StopIteration:
            source_ended = True
            break
        # Independent conservative reference: unequivocal green screen, not
        # cyan clothes or white hair. This does not reuse the app's classifier.
        cache[next_source] = (rgb[:, :, 1] >= 150) & (rgb[:, :, 1] > rgb[:, :, 0] + 90) & (rgb[:, :, 1] > rgb[:, :, 2] + 90)
        last_source = next_source
        next_source += 1

for i in range(gif.n_frames):
    target = math.floor(i / args.fps * source_fps)
    read_through(target + 2)
    reference = None
    # Ignore moving subject boundaries that differ by decoder frame selection.
    # Only pixels green in all five surrounding source frames are background.
    for source_index in range(max(0, target - 2), min(target + 2, last_source) + 1):
        reference = cache[source_index].copy() if reference is None else reference & cache[source_index]
    gif.seek(i)
    assert gif.disposal_method == 2, (i, "frame disposal must clear old opaque pixels")
    duration += gif.info.get("duration", 0)
    rgba = np.asarray(gif.convert("RGBA"))
    frame_leaks = int(np.count_nonzero(reference & (rgba[:, :, 3] > 0)))
    checked_pixels += int(np.count_nonzero(reference))
    leaks += frame_leaks
    assert frame_leaks == 0, (i, "opaque green-screen pixels", frame_leaks)
    # The supplied clip is in its stable front pose after 5 seconds; before
    # that the character moves across the frame, so fixed landmarks are invalid.
    if i / args.fps >= 5:
        for x, y in [(570, 55), (550, 95), (550, 240), (550, 520)]:
            # The original's final frame jumps back to the right-hand entry
            # pose. A fixed landmark that is green in the source is background,
            # not missing hair/skin; require opacity only for actual foreground.
            if cache[min(target, last_source)][y, x]:
                continue
            assert rgba[y, x, 3] == 255, (i, "hair/skin/shirt/trousers removed", x, y)
            foreground_checks += 1
    if i == 210:
        Image.fromarray(rgba).save(Path(args.gif).with_name("green-screen-transparent-preview.png"))
    for key in list(cache):
        if key < target - 3:
            del cache[key]
    if i % 150 == 0:
        print(f"Verified {i + 1}/{gif.n_frames} GIF frames", flush=True)

frames.close()
assert abs(duration - metadata["duration"] * 1000) <= 30, ("GIF timeline changed", duration, metadata["duration"])
print({
    "frames": gif.n_frames, "size": gif.size, "duration_ms": duration,
    "source_background_pixels_checked": checked_pixels, "opaque_background_leaks": leaks,
    "hair_skin_shirt_trousers_checks": foreground_checks,
})
