"""Composite a static ad creative into one detected billboard slot."""
from __future__ import annotations

import argparse
import bisect
import json
import subprocess
import sys
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np


def fit_creative(image: np.ndarray, width: int, height: int) -> np.ndarray:
    scale = max(width / image.shape[1], height / image.shape[0])
    resized = cv2.resize(
        image,
        (max(width, round(image.shape[1] * scale)), max(height, round(image.shape[0] * scale))),
        interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR,
    )
    left = (resized.shape[1] - width) // 2
    top = (resized.shape[0] - height) // 2
    return resized[top:top + height, left:left + width]


def box_at(track: list, seconds: float):
    if not track:
        return None
    times = [float(point[0]) for point in track]
    right = bisect.bisect_right(times, seconds)
    if right == 0:
        return track[0][1:5] if seconds >= times[0] - 0.05 else None
    if right >= len(track):
        return track[-1][1:5] if seconds <= times[-1] + 0.05 else None
    before, after = track[right - 1], track[right]
    span = float(after[0]) - float(before[0])
    ratio = 0.0 if span <= 0 else (seconds - float(before[0])) / span
    return [float(a) + (float(b) - float(a)) * ratio for a, b in zip(before[1:5], after[1:5])]


def composite(args):
    source = Path(args.input)
    creative_path = Path(args.image)
    output = Path(args.output)
    slot = json.loads(Path(args.slot_json).read_text(encoding='utf-8'))

    creative = cv2.imread(str(creative_path), cv2.IMREAD_UNCHANGED)
    if creative is None:
        raise ValueError('Could not read the uploaded ad image.')
    if creative.ndim == 2:
        creative = cv2.cvtColor(creative, cv2.COLOR_GRAY2BGR)
    if creative.shape[2] == 3:
        creative_alpha = None
    elif creative.shape[2] == 4:
        creative_alpha = True
    else:
        raise ValueError('Ad image must be JPG or PNG.')

    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ValueError('Could not open the detection result video.')
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(str(args.silent), cv2.VideoWriter_fourcc(*'mp4v'), fps, (width, height))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError('Could not create the ad preview video.')

    start_sec, end_sec = float(slot['start_sec']), float(slot['end_sec'])
    source_width = float(slot.get('frame_width') or width)
    source_height = float(slot.get('frame_height') or height)
    scale_x, scale_y = width / source_width, height / source_height
    track = slot.get('track') or []
    index = 0
    applied_frames = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            seconds = index / fps
            if start_sec <= seconds < end_sec:
                box = box_at(track, seconds)
                if box:
                    x1, y1, x2, y2 = [round(value) for value in box]
                    x1, x2 = max(0, round(x1 * scale_x) + 2), min(width, round(x2 * scale_x) - 2)
                    y1, y2 = max(0, round(y1 * scale_y) + 2), min(height, round(y2 * scale_y) - 2)
                    if x2 > x1 and y2 > y1:
                        ad = fit_creative(creative, x2 - x1, y2 - y1)
                        region = frame[y1:y2, x1:x2]
                        if creative_alpha:
                            alpha = ad[:, :, 3:4].astype(np.float32) / 255.0
                            frame[y1:y2, x1:x2] = (
                                ad[:, :, :3].astype(np.float32) * alpha
                                + region.astype(np.float32) * (1 - alpha)
                            ).astype(np.uint8)
                        else:
                            frame[y1:y2, x1:x2] = ad[:, :, :3]
                        applied_frames += 1
            writer.write(frame)
            index += 1
    finally:
        cap.release()
        writer.release()

    if applied_frames == 0:
        raise ValueError('No tracked billboard frames overlapped this slot. Re-run billboard analysis and try again.')

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
        '-i', str(args.silent), '-i', str(source),
        '-map', '0:v:0', '-map', '1:a:0?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-movflags', '+faststart', str(output),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)
    return applied_frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--silent', required=True)
    parser.add_argument('--slot-json', required=True)
    args = parser.parse_args()
    try:
        frames = composite(args)
        print(json.dumps({'success': True, 'framesWithAd': frames}))
    except Exception as error:
        print(json.dumps({'success': False, 'error': str(error)}))
        print(str(error), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
