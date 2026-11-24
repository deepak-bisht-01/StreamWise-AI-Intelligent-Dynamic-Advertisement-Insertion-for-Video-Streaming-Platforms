"""StreamWise AI - ad insertion engine (step 2 of the roadmap).

Reads the detector's output (slots.json + coordinates.csv), uses the tracked surface corners
(with box refinement for older detector results), and composites an ad creative into it
with perspective warp, lighting match and fade in/out.

It also writes ad_overlay.json (per-frame normalized quads) so the web player
can draw a DIFFERENT ad per viewer at playback time without re-rendering.

Usage:
  python ad_inserter.py --video normalized_input.mp4 --slots slots.json \
      --coords coordinates.csv --ad creative1.png [--ad creative2.mp4] \
      --output with_ads.mp4 [--overlay-json ad_overlay.json]

--video MUST be the detector's normalized_input.mp4 (same size, 30 fps) because
the coordinates are in that pixel space.
Ads are assigned to slots in slot order and cycled if there are fewer ads.
Prints ONE JSON object on stdout; progress goes to stderr.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# 1. box -> tight quad
# --------------------------------------------------------------------------
def order_corners(pts: np.ndarray) -> np.ndarray:
    """Return corners as TL, TR, BR, BL."""
    pts = np.asarray(pts, np.float32).reshape(4, 2)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.float32([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]])


def refine_quad(frame, box, min_frac=0.12, inset=0.015):
    """Find the enclosed 4-sided region inside a loose detection box.

    Works by finding regions fully enclosed by edges (e.g. the inside of a
    picture/billboard frame). Falls back to the box itself (inset a little) for
    plain walls that have no inner edges. Returns (quad 4x2 float32, method).
    """
    h_f, w_f = frame.shape[:2]
    x1, y1, x2, y2 = [int(round(v)) for v in box]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w_f, x2), min(h_f, y2)
    bw, bh = x2 - x1, y2 - y1
    rect = np.float32([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
    if bw < 20 or bh < 20:
        return rect, "box"
    crop = frame[y1:y2, x1:x2]
    scale = min(1.0, 480 / max(bw, bh))
    small = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    edges = cv2.Canny(gray, 30, 90)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))
    sh, sw = edges.shape
    cells, _ = cv2.findContours(255 - edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    best, best_area = None, 0.0
    for c in cells:
        a = cv2.contourArea(c)
        frac = a / (sw * sh)
        if not (min_frac <= frac <= 0.92):
            continue
        bx, by, cw, ch = cv2.boundingRect(c)
        if bx <= 2 or by <= 2 or bx + cw >= sw - 2 or by + ch >= sh - 2:
            continue  # touches the crop border => open wall, not an enclosed face
        approx = cv2.approxPolyDP(c, 0.03 * cv2.arcLength(c, True), True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        if a / max(1.0, cv2.contourArea(cv2.convexHull(c))) < 0.9:
            continue
        if a > best_area:
            best, best_area = approx.reshape(4, 2), a
    if best is None:
        centre = rect.mean(0)
        return centre + (rect - centre) * (1 - 2 * inset), "box"
    quad = order_corners(best.astype(np.float32) / scale + np.float32([x1, y1]))
    centre = quad.mean(0)
    # edges found by Canny sit slightly inside the dark frame; nudge in a touch
    # more so the ad never bleeds over the frame.
    return centre + (quad - centre) * (1 - inset), "contour"


# --------------------------------------------------------------------------
# 2. input loading
# --------------------------------------------------------------------------
def load_tracks(slots_json: Path, coords_csv: Path):
    data = json.loads(slots_json.read_text(encoding="utf-8"))
    meta = data.get("metadata", {})
    slots = {s["slot_id"]: s for s in data["slots"]}
    boxes = defaultdict(dict)
    quads = defaultdict(dict)
    corners = [f"q{axis}{i}" for i in range(1, 5) for axis in "xy"]
    with coords_csv.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            sid = int(r["slot_id"])
            boxes[sid][int(r["frame"])] = [float(r[k]) for k in ("x1", "y1", "x2", "y2")]
            if all(r.get(k) for k in corners):
                quad = np.array([float(r[k]) for k in corners], np.float32).reshape(4, 2)
                if np.isfinite(quad).all() and cv2.isContourConvex(quad) and cv2.contourArea(quad) > 4:
                    quads[sid][int(r["frame"])] = quad
    return meta, slots, boxes, quads


class AdSource:
    """Image (RGBA ok) or looping video creative."""

    def __init__(self, path: str):
        self.path = path
        self.cap = None
        self.image = None
        if Path(path).suffix.lower() in VIDEO_EXT:
            self.cap = cv2.VideoCapture(path)
            if not self.cap.isOpened():
                raise RuntimeError(f"Cannot open ad video {path}")
        else:
            img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
            if img is None:
                raise RuntimeError(f"Cannot read ad image {path}")
            if img.ndim == 2:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            if img.shape[2] == 3:
                img = np.dstack([img, np.full(img.shape[:2], 255, np.uint8)])
            self.image = img

    def frame(self):
        if self.image is not None:
            return self.image
        ok, f = self.cap.read()
        if not ok:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, f = self.cap.read()
        return np.dstack([f, np.full(f.shape[:2], 255, np.uint8)])


def cover_fit(bgra, w, h):
    ih, iw = bgra.shape[:2]
    scale = min(w / iw, h / ih)
    new_w = max(1, round(iw * scale))
    new_h = max(1, round(ih * scale))

    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    logo = cv2.resize(bgra, (new_w, new_h), interpolation=interp)

    canvas = np.zeros((h, w, 4), dtype=np.uint8)
    x = (w - new_w) // 2
    y = (h - new_h) // 2
    canvas[y:y + new_h, x:x + new_w] = logo
    return canvas


# --------------------------------------------------------------------------
# 3. compositing
# --------------------------------------------------------------------------
def composite(frame, ad_bgra, quad, strength):
    """Warp the ad into `quad` and blend. Works on the quad's bounding ROI only."""
    H, W = frame.shape[:2]
    bx0, by0 = np.floor(quad.min(0)).astype(int) - 3
    bx1, by1 = np.ceil(quad.max(0)).astype(int) + 3
    bx0, by0, bx1, by1 = max(0, bx0), max(0, by0), min(W, bx1), min(H, by1)
    if bx1 - bx0 < 8 or by1 - by0 < 8 or strength <= 0:
        return frame
    ah, aw = ad_bgra.shape[:2]
    src = np.float32([[0, 0], [aw, 0], [aw, ah], [0, ah]])
    dst = quad - np.float32([bx0, by0])
    M = cv2.getPerspectiveTransform(src, dst)
    size = (bx1 - bx0, by1 - by0)
    warped = cv2.warpPerspective(ad_bgra, M, size, flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    inside = np.zeros(size[::-1], np.uint8)
    cv2.fillConvexPoly(inside, np.round(dst * 16).astype(np.int32), 255, cv2.LINE_AA, shift=4)
    mask = (inside.astype(np.float32) / 255.0) * (warped[..., 3].astype(np.float32) / 255.0)
    mask = cv2.GaussianBlur(mask, (3, 3), 0) * strength

    roi = frame[by0:by1, bx0:bx1].astype(np.float32)
    ad = warped[..., :3].astype(np.float32)

    # -- lighting match: scene brightness + low-frequency shading from the wall
    lum = cv2.cvtColor(roi.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    sel = inside > 0
    if sel.sum() > 50:
        wall_mean = float(lum[sel].mean())
        # low-frequency shading computed on a tiny copy (a full-res big-sigma blur is very slow)
        tiny = cv2.resize(lum, (max(2, size[0] // 16), max(2, size[1] // 16)), interpolation=cv2.INTER_AREA)
        tiny = cv2.GaussianBlur(tiny, (0, 0), 1.5)
        shade = cv2.resize(tiny, size, interpolation=cv2.INTER_LINEAR) / max(1.0, wall_mean)
        shade = np.clip(shade, 0.75, 1.25)[..., None]
        gain = float(np.clip(wall_mean / 235.0, 0.55, 1.05))
        ad = np.clip(ad * gain * shade, 0, 255)
    ad = cv2.GaussianBlur(ad, (0, 0), 0.6)  # video is never razor sharp

    out = roi * (1 - mask[..., None]) + ad * mask[..., None]
    frame[by0:by1, bx0:bx1] = np.clip(out, 0, 255).astype(np.uint8)
    return frame


def fade_strength(i, start, end, fps, seconds=0.4):
    n = max(1, int(round(seconds * fps)))
    return float(min(1.0, (i - start + 1) / n, (end - i) / n))


# --------------------------------------------------------------------------
# 4. main pipeline
# --------------------------------------------------------------------------
def ffmpeg_path():
    p = shutil.which("ffmpeg")
    if p:
        return p
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def smooth_boxes(boxes: dict, alpha=0.55):
    out, prev = {}, None
    for f in sorted(boxes):
        b = np.array(boxes[f], np.float64)
        prev = b if prev is None else alpha * b + (1 - alpha) * prev
        out[f] = prev.copy()
    return out


def wall_placement(frame, surface, anchor):
    """Keep a stationary wall placement while it still fits the detected safe area."""
    if anchor is not None:
        quad, region, reference = anchor
        # The reference stays fixed so small cumulative camera motion is detectable.
        current = cv2.resize(frame[region], (96, 96), interpolation=cv2.INTER_AREA)
        change = cv2.absdiff(current, reference).max(axis=2)
        if (np.mean(change > 14) < .015 and
                all(cv2.pointPolygonTest(surface, tuple(map(float, pt)), False) >= 0 for pt in quad)):
            return quad, anchor

    # Leave room for harmless detector jitter without extending beyond the new surface.
    quad = surface.mean(axis=0) + .88 * (surface - surface.mean(axis=0))
    h, w = frame.shape[:2]
    x, y, bw, bh = cv2.boundingRect(surface)
    region = (slice(max(0, y - bh // 3), min(h, y + bh + bh // 3)),
              slice(max(0, x - bw // 3), min(w, x + bw + bw // 3)))
    crop = frame[region]
    if not crop.size:
        return quad, None
    reference = cv2.resize(crop, (96, 96), interpolation=cv2.INTER_AREA)
    return quad, (quad, region, reference)


def run(video, slots_json, coords_csv, ads, output, overlay_json=None, slot_ids=None, crf=20):
    meta, slots, raw_boxes, tracked_quads = load_tracks(Path(slots_json), Path(coords_csv))
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open {video}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    W, H = int(cap.get(3)), int(cap.get(4))
    if meta.get("working_width") and (W, H) != (meta["working_width"], meta["working_height"]):
        raise RuntimeError(f"Video is {W}x{H} but detections are in {meta['working_width']}x"
                           f"{meta['working_height']}. Pass the detector's normalized_input.mp4.")

    wanted = sorted(slot_ids or slots.keys())
    sources = [AdSource(p) for p in ads]
    plan = {}
    for n, sid in enumerate(wanted):
        plan[sid] = dict(ad=sources[n % len(sources)], boxes=smooth_boxes(raw_boxes[sid]),
                         start=slots[sid]["start_frame"], end=slots[sid]["end_frame_exclusive"],
                         rel=None, fitted=None, method=None, quads={}, anchor=None, last_frame=None)

    Path(output).parent.mkdir(parents=True, exist_ok=True)
    silent = Path(output).with_name(Path(output).stem + "_silent.mp4")
    writer = cv2.VideoWriter(str(silent), cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
    if not writer.isOpened():
        raise RuntimeError("OpenCV VideoWriter failed")

    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        clean = frame  # refinement must see the un-overlaid frame
        for sid, p in plan.items():
            if not (p["start"] <= i < p["end"]) or i not in p["boxes"]:
                continue
            box = p["boxes"][i]
            quad = tracked_quads[sid].get(i)
            if quad is None:
                if p["rel"] is None:
                    refined, method = refine_quad(clean, box)
                    extent = box[2:] - box[:2]
                    if np.any(extent <= 0):
                        continue
                    p["rel"] = (refined - box[:2]) / extent
                    p["method"] = p["method"] or method
                quad = (box[:2] + p["rel"] * (box[2:] - box[:2])).astype(np.float32)
            else:
                p["method"] = "detector_quad"
            if slots[sid].get("kind") == "blank_surface":
                if p["last_frame"] != i - 1:
                    p["anchor"] = None
                quad, p["anchor"] = wall_placement(clean, quad, p["anchor"])
            p["last_frame"] = i
            if "size" not in p:
                wq = (np.linalg.norm(quad[1] - quad[0]) + np.linalg.norm(quad[2] - quad[3])) / 2
                hq = (np.linalg.norm(quad[3] - quad[0]) + np.linalg.norm(quad[2] - quad[1])) / 2
                p["size"] = (max(32, int(wq)), max(32, int(hq)))
                log(f"slot {sid}: quad via {p['method']}, size {p['size']}")
            p["quads"][i] = quad
            if p["ad"].image is None or p["fitted"] is None:  # still images are fitted once per slot
                p["fitted"] = cover_fit(p["ad"].frame(), *p["size"])
            ad = p["fitted"]
            frame = composite(frame, ad, quad, fade_strength(i, p["start"], p["end"], fps))
        writer.write(frame)
        i += 1
    cap.release()
    writer.release()

    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(silent),
                    "-i", str(video), "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "libx264",
                    "-preset", "veryfast", "-crf", str(crf), "-pix_fmt", "yuv420p", "-c:a", "copy",
                    "-movflags", "+faststart", str(out)], check=True)
    silent.unlink(missing_ok=True)

    if overlay_json:
        doc = dict(version=1, fps=fps, width=W, height=H, slots=[
            dict(slot_id=sid, start_frame=p["start"], end_frame_exclusive=p["end"], method=p["method"],
                 aspect=(p["size"][0] / p["size"][1]) if p.get("size") else None,
                 quads={str(f): [round(float(v), 5) for v in (q / [W, H]).ravel()] for f, q in p["quads"].items()})
            for sid, p in plan.items()])
        Path(overlay_json).write_text(json.dumps(doc), encoding="utf-8")
    return dict(success=True, frames=i, output=str(out),
                slots=[dict(slot_id=s, method=p["method"], frames=len(p["quads"])) for s, p in plan.items()])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--slots", required=True)
    ap.add_argument("--coords", required=True)
    ap.add_argument("--ad", action="append", required=True, help="creative (image or video); repeatable")
    ap.add_argument("--output", required=True)
    ap.add_argument("--overlay-json", default=None)
    ap.add_argument("--slot-ids", default=None, help="comma list, default all")
    a = ap.parse_args()
    try:
        ids = [int(x) for x in a.slot_ids.split(",")] if a.slot_ids else None
        print(json.dumps(run(a.video, a.slots, a.coords, a.ad, a.output, a.overlay_json, ids)))
    except Exception as exc:  # Node reads one JSON object
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()