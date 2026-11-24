"""Phase 3 V5: segmentation-based billboard / frame / blank-wall slot detector.

What changed from V4 (Grounding DINO + boxes):
  * YOLOE-11s-seg (open-vocabulary detection + instance masks, one fast pass)
    replaces Grounding DINO. Masks give TIGHT 4-corner quads, not loose boxes.
  * Each selected slot spans the full continuous verified track (minimum 4 seconds).
  * Slots are tracked as quads with homography (LK flow + RANSAC), so the
    perspective of the surface is preserved frame to frame.
  * Every detector sample re-anchors the tracked quad (no slow drift).
  * Rendering is ONE pass with frames piped straight into ffmpeg
    (V4 decoded twice, wrote mp4v twice, then re-encoded twice).
  * Raw-detection cache is written once, not after every sampled frame.
  * Outputs are backward compatible: same files, same first columns; the
    coordinates.csv gains qx1..qy4 (quad corners) at the end.

Usage:
  python ad_slot_detector_v4.py --video input.mp4 --out-dir results/video1
First run downloads yoloe-11s-seg.pt (~26 MB) and the MobileCLIP text encoder
(~570 MB) from GitHub, then they are cached.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import platform
import shutil
import subprocess
import time
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

import cv2
import numpy as np

# --------------------------------------------------------------------------
# Open-vocabulary prompt set. Order matters: kinds are decided by index.
# --------------------------------------------------------------------------
BOARD_PROMPTS = ['billboard', 'advertising board', 'signboard', 'poster', 'picture frame']
WALL_PROMPTS = ['blank wall']
OCCLUDER_PROMPTS = ['person', 'chair', 'couch', 'potted plant', 'window', 'door', 'car',
                    'television', 'table']
NAMES = BOARD_PROMPTS + WALL_PROMPTS + OCCLUDER_PROMPTS
KIND_BY_INDEX = (['existing_board'] * len(BOARD_PROMPTS) + ['blank_surface'] * len(WALL_PROMPTS)
                 + ['protected'] * len(OCCLUDER_PROMPTS))
CONF_FLOOR = 0.05          # everything above this is cached; kind thresholds applied later


@dataclass
class Config:
    max_slots: int = 3
    min_duration: float = 4.0
    target_duration: float | None = None  # legacy setting accepted but ignored
    detect_hz: float = 1.0
    min_conf: float = 0.12            # boards / frames (YOLOE scores are lower than DINO's)
    wall_conf: float = 0.08
    occluder_conf: float = 0.20
    min_surface_fraction: float = 0.85
    min_aspect: float = 0.5
    min_area: float = 0.004
    max_area: float = 0.55
    wall_max_frac: float = 0.25       # a wall slot never covers more than this share of the frame
    min_width: float = 0.075
    min_height: float = 0.035
    min_rank: float = 0.40
    match_iou: float = 0.40
    max_edge_density: float = 0.08
    max_texture_std: float = 25.0
    allow_existing: bool = True
    imgsz: int = 640
    model_id: str = 'yoloe-11s-seg.pt'


# --------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------
def area(box):
    return max(0., float(box[2] - box[0])) * max(0., float(box[3] - box[1]))


def intersection(a, b):
    return max(0., min(a[2], b[2]) - max(a[0], b[0])) * max(0., min(a[3], b[3]) - max(a[1], b[1]))


def iou(a, b):
    inter = intersection(a, b)
    return inter / max(1., area(a) + area(b) - inter)


def same_region(a, b):
    return iou(a, b) > 0.40 or intersection(a, b) / max(1., min(area(a), area(b))) > 0.75


def clipped(box, width, height):
    x1, y1, x2, y2 = map(float, box)
    return [max(0., min(width, x1)), max(0., min(height, y1)),
            max(0., min(width, x2)), max(0., min(height, y2))]


def ints(box):
    return [int(round(v)) for v in box]


def order_quad(pts):
    """Clockwise from top-left: TL, TR, BR, BL."""
    pts = np.asarray(pts, np.float32).reshape(4, 2)
    c = pts.mean(0)
    pts = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    start = int(np.argmin(pts.sum(1)))
    return np.roll(pts, -start, axis=0).astype(np.float32)


def quad_bbox(q):
    return [float(q[:, 0].min()), float(q[:, 1].min()), float(q[:, 0].max()), float(q[:, 1].max())]


def quad_dims(q):
    w = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    h = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    return float(w), float(h)


def quad_area(q):
    return float(cv2.contourArea(np.asarray(q, np.float32).reshape(-1, 1, 2)))


def shrink_quad(q, frac):
    c = q.mean(0)
    return (c + (q - c) * (1 - 2 * frac)).astype(np.float32)


def rect_quad(box):
    x1, y1, x2, y2 = box
    return np.float32([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])


def quad_support(mask, q):
    """Share of the quad's pixels that fall on `mask`."""
    h, w = mask.shape
    x1, y1, x2, y2 = ints(clipped(quad_bbox(q), w, h))
    if x2 <= x1 or y2 <= y1:
        return 0.
    canvas = np.zeros((y2 - y1, x2 - x1), np.uint8)
    cv2.fillConvexPoly(canvas, np.round(q - [x1, y1]).astype(np.int32), 1)
    sel = canvas > 0
    n = int(sel.sum())
    return float(mask[y1:y2, x1:x2][sel].mean()) if n else 0.


def poly_to_quad(poly):
    """Mask polygon -> tight convex 4-gon. Returns (quad, fidelity IoU) or (None, 0)."""
    poly = np.asarray(poly, np.float32).reshape(-1, 2)
    if len(poly) < 3:
        return None, 0.
    hull = cv2.convexHull(poly).reshape(-1, 1, 2)
    if len(hull) < 3:
        return None, 0.
    hull_area = cv2.contourArea(hull)
    if hull_area < 16:
        return None, 0.
    peri = cv2.arcLength(hull, True)
    candidates = []
    for eps in (.01, .02, .03, .045, .06, .08, .10):
        ap = cv2.approxPolyDP(hull, eps * peri, True)
        if len(ap) == 4:
            candidates.append(ap.reshape(4, 2))
            break
        if len(ap) < 4:
            break
    candidates.append(cv2.boxPoints(cv2.minAreaRect(hull)))
    best, best_iou = None, 0.
    for cand in candidates:
        q = order_quad(cand)
        inter, _ = cv2.intersectConvexConvex(q.reshape(-1, 2), hull.reshape(-1, 2))
        union = quad_area(q) + hull_area - inter
        score = inter / max(1., union)
        if score > best_iou:
            best, best_iou = q, float(score)
    return (best, best_iou) if best_iou >= 0.6 else (None, best_iou)


def largest_rectangle(mask):
    """Largest axis-aligned ALL-TRUE rectangle. Returns exclusive x2/y2."""
    height, width = mask.shape
    histogram = np.zeros(width, dtype=int)
    best, best_area = None, 0
    for y in range(height):
        histogram = np.where(mask[y], histogram + 1, 0)
        stack = []
        for x in range(width + 1):
            current = int(histogram[x]) if x < width else 0
            left = x
            while stack and stack[-1][1] > current:
                start, bar = stack.pop()
                candidate_area = bar * (x - start)
                if candidate_area > best_area:
                    best_area, best = candidate_area, [start, y + 1 - bar, x, y + 1]
                left = start
            if current and (not stack or stack[-1][1] < current):
                stack.append((left, current))
    return best


def crop_rectangle(mask, proposal, cfg, frame_area):
    """Largest clean rectangle inside a wall proposal, sized like a real poster."""
    h, w = mask.shape
    x1, y1, x2, y2 = ints(clipped(proposal, w, h))
    if x2 <= x1 or y2 <= y1:
        return None
    roi = mask[y1:y2, x1:x2].astype(np.uint8)
    scale = min(1., 160 / max(roi.shape))
    mw, mh = max(1, int(roi.shape[1] * scale)), max(1, int(roi.shape[0] * scale))
    small = cv2.resize(roi.astype(np.float32), (mw, mh), interpolation=cv2.INTER_AREA) > 0.995
    rect = largest_rectangle(small)
    if rect is None:
        return None
    a, b, c, d = rect
    a, b, c, d = (x1 + math.ceil(a * roi.shape[1] / mw), y1 + math.ceil(b * roi.shape[0] / mh),
                  x1 + math.floor(c * roi.shape[1] / mw), y1 + math.floor(d * roi.shape[0] / mh))
    bw, bh = c - a, d - b
    if bw < 1 or bh < 1:
        return None
    if bw / bh < cfg.min_aspect:                     # too tall -> trim height
        nh = bw / cfg.min_aspect
        b, d = (b + d - nh) / 2, (b + d + nh) / 2
    elif bw / bh > 4.0:                              # too wide -> trim width
        nw = bh * 4.0
        a, c = (a + c - nw) / 2, (a + c + nw) / 2
    bw, bh = c - a, d - b
    cap = cfg.wall_max_frac * frame_area
    if bw * bh > cap:                                # keep the ad poster-sized, centred
        s = math.sqrt(cap / (bw * bh))
        cx, cy = (a + c) / 2, (b + d) / 2
        a, c, b, d = cx - bw * s / 2, cx + bw * s / 2, cy - bh * s / 2, cy + bh * s / 2
    return ints([a, b, c, d])


def appearance(frame, box):
    x1, y1, x2, y2 = ints(box)
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return {'edge': 1., 'std': 255., 'clipped': 1., 'residual_std': 255., 'residual_outliers': 1.}
    gray = cv2.cvtColor(cv2.resize(crop, (160, 90)), cv2.COLOR_BGR2GRAY)
    yy, xx = np.mgrid[:90, :160]
    design = np.column_stack((np.ones(gray.size), xx.ravel(), yy.ravel()))
    residual = gray.ravel() - design @ np.linalg.lstsq(design, gray.ravel(), rcond=None)[0]
    return {'edge': float(np.mean(cv2.Canny(gray, 70, 150) > 0)),
            'std': float(gray.std()),
            'residual_std': float(residual.std()),
            'residual_outliers': float(np.mean(np.abs(residual) > 12)),
            'clipped': float(np.mean((gray < 8) | (gray > 247)))}


def geometry_ok(quad, width, height, cfg, kind):
    x1, y1, x2, y2 = quad_bbox(quad)
    qw, qh = quad_dims(quad)
    ratio = quad_area(quad) / (width * height)
    return (qw >= cfg.min_width * width and qh >= cfg.min_height * height
            and cfg.min_area <= ratio <= cfg.max_area
            and cfg.min_aspect <= qw / max(1., qh) <= 7.0
            and x1 >= width * 0.003 and y1 >= height * 0.003
            and x2 <= width * 0.997 and y2 <= height * 0.98
            and (kind != 'blank_surface' or ratio >= .008))


def assess(frame, quad, safe_mask, kind, confidence, cfg, protected_mask=None):
    h, w = frame.shape[:2]
    if not geometry_ok(quad, w, h, cfg, kind):
        return None, 'geometry'
    if protected_mask is not None and quad_support(protected_mask, quad) > .015:
        return None, 'foreground_overlap'
    supported = quad_support(safe_mask, quad)
    if supported < cfg.min_surface_fraction:
        return None, 'unsafe_or_uncertain_surface'
    q = appearance(frame, clipped(quad_bbox(quad), w, h))
    if kind == 'blank_surface' and (q['edge'] > cfg.max_edge_density or q['std'] > cfg.max_texture_std
                                    or q['residual_std'] > 10 or q['residual_outliers'] > .12):
        return None, 'clutter_or_text'
    if q['clipped'] > 0.80:
        return None, 'extreme_dark_or_bright'
    cleanliness = 1. - min(1., q['edge'] / cfg.max_edge_density)
    size_score = min(1., quad_area(quad) / (w * h * 0.12))
    conf_norm = min(1., confidence / 0.5)       # YOLOE scores top out lower than DINO's
    # Deterministic ranking index, NOT a calibrated probability.
    score = (0.30 * conf_norm + 0.25 * supported + 0.20 * size_score
             + 0.15 * (cleanliness if kind == 'blank_surface' else 0.8) + 0.10)
    if score < cfg.min_rank:
        return None, 'low_rank'
    return dict(quad=quad.astype(np.float32), box=quad_bbox(quad), kind=kind,
                confidence=float(confidence), score=float(score), surface_fraction=supported), 'accepted'


# --------------------------------------------------------------------------
# Detector (YOLOE)
# --------------------------------------------------------------------------
class Models:
    def __init__(self, cfg, device=None, cache_path=None):
        self.cfg = cfg
        self.requested_device = device
        self.device = device
        self.cache_path = Path(cache_path) if cache_path else None
        self.cache = {}
        self.model = None
        self.frame_index = 0
        self.inference_seconds = 0.
        self.dirty = False
        self.last_raw = []
        if self.cache_path and self.cache_path.exists():
            try:
                data = json.loads(self.cache_path.read_text())
                if (data.get('names') == NAMES and data.get('model_id') == cfg.model_id
                        and data.get('imgsz') == cfg.imgsz):
                    self.cache = data.get('frames', {})
            except (json.JSONDecodeError, OSError):
                pass

    def load(self):
        import torch
        from ultralytics import YOLOE
        self.device = self.requested_device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = YOLOE(self.cfg.model_id)
        self.model.set_classes(NAMES, self.model.get_text_pe(NAMES))
        print('Loaded', self.cfg.model_id, 'on', self.device, flush=True)

    def infer(self, frame):
        if self.model is None:
            self.load()
        started = time.time()
        kwargs = dict(imgsz=self.cfg.imgsz, conf=CONF_FLOOR, iou=0.5,
                      device=0 if self.device == 'cuda' else 'cpu', verbose=False)
        try:
            res = self.model.predict(frame, **(dict(kwargs, half=True) if self.device == 'cuda' else kwargs))[0]
        except (SyntaxError, TypeError):   # newer ultralytics may rename/remove `half`
            res = self.model.predict(frame, **kwargs)[0]
        raw = []
        if res.boxes is not None and len(res.boxes):
            polys = res.masks.xy if res.masks is not None else [None] * len(res.boxes)
            for box, conf, cls, poly in zip(res.boxes.xyxy.cpu().numpy(), res.boxes.conf.cpu().numpy(),
                                            res.boxes.cls.cpu().numpy(), polys):
                idx = int(cls)
                if poly is None or len(poly) < 3:
                    x1, y1, x2, y2 = box
                    poly = np.float32([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
                poly = cv2.approxPolyDP(np.asarray(poly, np.float32).reshape(-1, 1, 2), 1.5, True).reshape(-1, 2)
                raw.append({'kind': KIND_BY_INDEX[idx], 'label': NAMES[idx], 'confidence': float(conf),
                            'box': [float(v) for v in box],
                            'poly': [[round(float(x), 1), round(float(y), 1)] for x, y in poly]})
        self.inference_seconds += time.time() - started
        return raw

    def proposals(self, frame):
        key = str(self.frame_index)
        if key in self.cache:
            raw = self.cache[key]
        else:
            raw = self.infer(frame)
            self.cache[key] = raw
            self.dirty = True
            print(f'Model frame {self.frame_index}: {len(raw)} raw detections', flush=True)
        if self.device is None:
            self.device = 'cached_model_detections'
        self.last_raw = raw
        return raw

    def save_cache(self):
        if self.cache_path and self.dirty:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps({'names': NAMES, 'model_id': self.cfg.model_id,
                                                   'imgsz': self.cfg.imgsz, 'frames': self.cache}),
                                       encoding='utf-8')
            self.dirty = False

    def masks(self, frame):
        raw = self.proposals(frame)
        h, w = frame.shape[:2]
        cfg = self.cfg
        occ = np.zeros((h, w), np.uint8)
        wall = np.zeros((h, w), np.uint8)
        board = np.zeros((h, w), np.uint8)
        for p in raw:
            poly = np.round(np.asarray(p['poly'])).astype(np.int32).reshape(-1, 1, 2)
            if len(poly) < 3:
                continue
            if p['kind'] == 'protected' and p['confidence'] >= cfg.occluder_conf:
                cv2.fillPoly(occ, [poly], 1)
            elif p['kind'] == 'existing_board' and p['confidence'] >= cfg.min_conf * 0.5:
                # hysteresis: starting a NEW slot needs min_conf (see detect()), but CONFIRMING a slot
                # that is already being tracked only needs half of it, because model scores flicker.
                cv2.fillPoly(board, [poly], 1)
            elif p['kind'] == 'blank_surface' and p['confidence'] >= cfg.wall_conf:
                cv2.fillPoly(wall, [poly], 1)
        occ = cv2.dilate(occ, np.ones((7, 7), np.uint8))
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edge = (cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 60, 140) > 0).astype(np.float32)
        density = cv2.boxFilter(edge, -1, (21, 21))
        blank = (wall > 0) & (occ == 0) & (density < .075)
        blank = cv2.erode(blank.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        return {'blank_surface': blank, 'existing_board': (board > 0) & (occ == 0),
                'foreground': occ.astype(bool)}

    def detect(self, frame, masks, rejects):
        h, w = frame.shape[:2]
        cfg = self.cfg
        candidates = []
        for p in sorted(self.last_raw, key=lambda p: p['confidence'], reverse=True):
            kind = p['kind']
            if kind == 'existing_board':
                if not cfg.allow_existing:
                    rejects['existing_board_disabled'] += 1
                    continue
                if p['confidence'] < cfg.min_conf:
                    rejects['low_model_confidence'] += 1
                    continue
                quad, fidelity = poly_to_quad(p['poly'])
                if quad is None:
                    rejects['not_a_clean_quadrilateral'] += 1
                    continue
                quad = shrink_quad(quad, .02)          # stay inside the visible face
            elif kind == 'blank_surface':
                if p['confidence'] < cfg.wall_conf:
                    rejects['low_model_confidence'] += 1
                    continue
                x1, y1, x2, y2 = clipped(p['box'], w, h)
                mx, my = max(4, round(w * .012)), max(4, math.ceil(h * .025))
                region = np.zeros((h, w), np.uint8)
                cv2.fillPoly(region, [np.round(np.asarray(p['poly'])).astype(np.int32).reshape(-1, 1, 2)], 1)
                region = masks['blank_surface'] & (region > 0)
                rect = crop_rectangle(region, [max(mx, x1), max(my, y1), min(w - mx, x2), min(h - my, y2)],
                                      cfg, w * h)
                if rect is None:
                    rejects['no_clean_wall_interior'] += 1
                    continue
                quad = rect_quad(rect)
            else:
                continue
            item, reason = assess(frame, quad, masks[kind], kind, p['confidence'], cfg, masks['foreground'])
            if item is None:
                rejects[reason] += 1
            elif all(not same_region(item['box'], o['box']) for o in candidates):
                item['label'] = p['label']
                candidates.append(item)
        return sorted(candidates, key=lambda i: i['score'], reverse=True)[:6]


# --------------------------------------------------------------------------
# scene cuts + tracking
# --------------------------------------------------------------------------
def scene_cut(previous, current):
    if previous is None:
        return False
    a, b = cv2.resize(previous, (160, 90)), cv2.resize(current, (160, 90))
    ha = cv2.calcHist([cv2.cvtColor(a, cv2.COLOR_BGR2HSV)], [0, 1], None, [24, 24], [0, 180, 0, 256])
    hb = cv2.calcHist([cv2.cvtColor(b, cv2.COLOR_BGR2HSV)], [0, 1], None, [24, 24], [0, 180, 0, 256])
    cv2.normalize(ha, ha, alpha=1., norm_type=cv2.NORM_L1)
    cv2.normalize(hb, hb, alpha=1., norm_type=cv2.NORM_L1)
    hist_change = cv2.compareHist(ha, hb, cv2.HISTCMP_BHATTACHARYYA)
    gray_change = float(np.mean(cv2.absdiff(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY),
                                            cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)))) / 255
    return bool((hist_change > .60 and gray_change > .10) or gray_change > .16)


def track_quad(prev_gray, cur_gray, quad):
    """LK flow (fwd/back checked) -> homography (RANSAC) applied to the quad corners.

    Fails rather than drifts. Plain featureless walls fall back to pixel evidence."""
    h, w = cur_gray.shape
    x1, y1, x2, y2 = quad_bbox(quad)
    bw, bh = x2 - x1, y2 - y1
    pad = .15
    a, b, c, d = ints(clipped([x1 - pad * bw, y1 - pad * bh, x2 + pad * bw, y2 + pad * bh], w, h))
    region = np.zeros((h, w), np.uint8)
    region[b:d, a:c] = 255
    pts = cv2.goodFeaturesToTrack(prev_gray, maxCorners=80, qualityLevel=.01, minDistance=6,
                                  mask=region, blockSize=5)
    if pts is not None and len(pts) >= 8:
        nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, cur_gray, pts, None, winSize=(21, 21), maxLevel=3)
        if nxt is not None:
            back, bst, _ = cv2.calcOpticalFlowPyrLK(cur_gray, prev_gray, nxt, None, winSize=(21, 21), maxLevel=3)
            if back is not None:
                ok = (st.ravel() == 1) & (bst.ravel() == 1) & (np.linalg.norm(pts - back, axis=2).ravel() < 1.2)
                p, q = pts[ok], nxt[ok]
                if len(p) >= 8:
                    H, inl = cv2.findHomography(p, q, cv2.RANSAC, 2.5)
                    if H is not None and inl is not None and inl.mean() >= .60:
                        moved = cv2.perspectiveTransform(quad.reshape(-1, 1, 2).astype(np.float32), H).reshape(4, 2)
                        scale = quad_area(moved) / max(1., quad_area(quad))
                        shift = float(np.linalg.norm(moved - quad, axis=1).max())
                        if (.80 < scale < 1.25 and shift < .08 * w
                                and cv2.isContourConvex(moved.reshape(-1, 1, 2).astype(np.float32))):
                            nb = clipped(quad_bbox(moved), w, h)
                            if nb[0] >= 0 and nb[1] >= 0 and nb[2] <= w and nb[3] <= h \
                                    and quad_bbox(moved)[0] >= -2 and quad_bbox(moved)[2] <= w + 2 \
                                    and quad_bbox(moved)[1] >= -2 and quad_bbox(moved)[3] <= h + 2:
                                warped = cv2.warpPerspective(prev_gray, H, (w, h))
                                aa, bb, cc, dd = ints(nb)
                                diff = cv2.absdiff(warped[bb:dd, aa:cc], cur_gray[bb:dd, aa:cc])
                                if diff.size and np.mean(diff > 35) < .08 and diff.mean() < 12:
                                    return moved.astype(np.float32), float(inl.mean())
    before, after = prev_gray[b:d, a:c], cur_gray[b:d, a:c]
    if before.size:
        difference = cv2.absdiff(before, after)
        if difference.mean() < 3.0 and np.mean(difference > 20) < .015:
            return quad.copy(), .85
    return None, 0.


@dataclass
class Track:
    track_id: int
    scene_id: int
    kind: str
    label: str
    confidence: float
    quad: np.ndarray
    rows: list = field(default_factory=list)   # [frame, bbox_ints, rank, quality, quad_list]
    last_verified: int = -1
    rank: float = 0.
    misses: int = 0


def make_row(frame_idx, quad, rank, quality):
    return [frame_idx, ints(quad_bbox(quad)), rank, quality, [round(float(v), 2) for v in quad.ravel()]]


def window_options(tracks, fps, cfg):
    """Consecutive observed/tracked frames with periodic detector confirmation."""
    minimum = math.ceil(cfg.min_duration * fps - 1e-6)
    options = []
    max_tail = max(0, round(fps / cfg.detect_hz) - 1)
    for tr in tracks:
        verified_end = tr.last_verified + max_tail
        start = 0
        while start < len(tr.rows) and tr.rows[start][0] <= verified_end:
            end = start + 1
            while (end < len(tr.rows) and tr.rows[end][0] <= verified_end
                   and tr.rows[end][0] == tr.rows[end - 1][0] + 1):
                end += 1
            if end - start >= minimum:
                rows = tr.rows[start:end]
                score = sum(r[2] * (.85 + .15 * r[3]) for r in rows) / len(rows)
                rank = min(1., score + .02)
                if rank >= cfg.min_rank:
                    options.append(dict(track_id=tr.track_id, scene_id=tr.scene_id, kind=tr.kind,
                                        label=tr.label, start_frame=rows[0][0],
                                        end_frame_exclusive=rows[-1][0] + 1, rank=rank,
                                        rows=rows, min_frame_score=min(r[2] for r in rows)))
            start = end
    return sorted(options, key=lambda o: (o['rank'], len(o['rows'])), reverse=True)


def select_windows(options, cfg):
    selected = []
    for option in options:
        if any(o['track_id'] == option['track_id'] for o in selected):
            continue
        if any(option['start_frame'] < o['end_frame_exclusive']
               and o['start_frame'] < option['end_frame_exclusive'] for o in selected):
            continue
        selected.append(option)
        if len(selected) == cfg.max_slots:
            break
    for rank, option in enumerate(selected, 1):
        option['rank_order'] = rank
    selected.sort(key=lambda o: o['start_frame'])
    for index, option in enumerate(selected, 1):
        option['slot_id'] = index
    return selected


# --------------------------------------------------------------------------
# video I/O
# --------------------------------------------------------------------------
def timestamp(seconds):
    millis = round(seconds * 1000)
    return f'{millis // 3600000:02d}:{millis // 60000 % 60:02d}:{millis // 1000 % 60:02d}.{millis % 1000:03d}'


def ffmpeg_path():
    path = shutil.which('ffmpeg')
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise RuntimeError('Install FFmpeg or imageio-ffmpeg (pip install imageio-ffmpeg)') from exc


def run_ffmpeg(command, log):
    with Path(log).open('w', encoding='utf-8') as f:
        result = subprocess.run(command, stdout=f, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'FFmpeg failed. Inspect {log}')


def normalize_video(source, destination, max_width):
    vf = f"scale=w='min({max_width},iw)':h=-2,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30"
    run_ffmpeg([ffmpeg_path(), '-hide_banner', '-y', '-i', str(source), '-map', '0:v:0', '-map', '0:a:0?',
                '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-movflags', '+faststart', str(destination)], destination.with_suffix('.log'))


class FFPipe:
    """Raw BGR frames -> ffmpeg stdin -> H.264 mp4 (+ audio copied from `audio_src`). One encode, no temp file."""

    def __init__(self, dest, audio_src, width, height, fps):
        self.dest = Path(dest)
        self.log = self.dest.with_suffix('.log')
        self.logf = self.log.open('wb')
        self.proc = subprocess.Popen(
            [ffmpeg_path(), '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24',
             '-s', f'{width}x{height}', '-r', f'{fps:.6f}', '-i', '-', '-i', str(audio_src),
             '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
             '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', str(self.dest)],
            stdin=subprocess.PIPE, stdout=self.logf, stderr=self.logf)

    def write(self, frame):
        try:
            self.proc.stdin.write(np.ascontiguousarray(frame).tobytes())
        except (BrokenPipeError, OSError) as exc:
            raise RuntimeError(f'FFmpeg pipe closed early. Inspect {self.log}') from exc

    def close(self):
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        code = self.proc.wait()
        self.logf.close()
        if code or not self.dest.exists() or self.dest.stat().st_size == 0:
            raise RuntimeError(f'FFmpeg failed. Inspect {self.log}')


def draw_slot(frame, quad, label, width):
    pts = np.round(quad).astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(frame, [pts], True, (50, 230, 60), 2, cv2.LINE_AA)
    x1, y1 = int(quad[:, 0].min()), int(quad[:, 1].min())
    fs = max(.35, min(.6, width / 1900))
    tw, th = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)[0]
    tx, ty = max(4, min(x1, width - tw - 6)), max(th + 7, y1 - 8)
    cv2.rectangle(frame, (tx - 2, ty - th - 4), (tx + tw + 3, ty + 4), (20, 25, 20), -1)
    cv2.putText(frame, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, fs, (90, 255, 100), 1, cv2.LINE_AA)


def render_both(video, out_dir, selected, preview_tracks, fps):
    """ONE decode pass -> two piped H.264 encodes (suggestions + detection preview)."""
    cap = cv2.VideoCapture(str(video))
    width, height = int(cap.get(3)), int(cap.get(4))
    sel_map, prev_map = {}, {}
    for slot in selected:
        for row in slot['rows']:
            sel_map.setdefault(row[0], []).append((slot, row))
    for slot in preview_tracks:
        for row in slot['rows']:
            prev_map.setdefault(row[0], []).append((slot, row))
    out_sel = FFPipe(out_dir / 'phase3_suggestions.mp4', video, width, height, fps)
    out_prev = FFPipe(out_dir / 'detection_preview.mp4', video, width, height, fps)
    index = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            a = frame.copy() if index in sel_map else frame
            for slot, row in sorted(sel_map.get(index, []), key=lambda x: x[0]['rank'], reverse=True)[:3]:
                quad = np.float32(row[4]).reshape(4, 2)
                draw_slot(a, quad, f"SLOT {slot['slot_id']} | {timestamp(slot['start_frame'] / fps)} - "
                                   f"{timestamp(slot['end_frame_exclusive'] / fps)}", width)
                if index == slot['start_frame']:
                    cv2.imwrite(str(out_dir / f"slot_{slot['slot_id']}_preview.jpg"), a)
            b = frame.copy() if index in prev_map else frame
            for slot, row in sorted(prev_map.get(index, []), key=lambda x: x[0]['rank'], reverse=True)[:3]:
                name = 'BOARD' if slot['kind'] == 'existing_board' else 'WALL SPACE'
                draw_slot(b, np.float32(row[4]).reshape(4, 2), f"DETECTED {name} | ID {slot['slot_id']}", width)
            out_sel.write(a)
            out_prev.write(b)
            index += 1
    finally:
        cap.release()
        out_sel.close()
        out_prev.close()
    return index


# --------------------------------------------------------------------------
# main analysis
# --------------------------------------------------------------------------
def analyze(video, models, cfg):
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f'Cannot open {video}')
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not np.isfinite(fps) or fps <= 0:
        raise RuntimeError('Invalid FPS; video normalization failed.')
    width, height = int(cap.get(3)), int(cap.get(4))
    step = max(1, round(fps / cfg.detect_hz))
    active, finished, rejects = [], [], Counter()
    previous, previous_gray = None, None
    frame_idx, next_id, scene_id, cuts = 0, 1, 0, []
    track_seconds = 0.
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        is_cut = scene_cut(previous, frame)
        if is_cut:
            finished.extend(active)
            active = []
            scene_id += 1
            cuts.append(frame_idx)
        if previous_gray is not None and not is_cut:
            t0 = time.time()
            survivors = []
            for tr in active:
                quad, quality = track_quad(previous_gray, gray, tr.quad)
                if quad is None:
                    rejects['tracking_failure'] += 1
                    finished.append(tr)
                else:
                    tr.quad = quad
                    tr.rows.append(make_row(frame_idx, quad, tr.rank, quality))
                    survivors.append(tr)
            active = survivors
            track_seconds += time.time() - t0
        if frame_idx % step == 0 or is_cut:
            models.frame_index = frame_idx
            masks = models.masks(frame)
            candidates = models.detect(frame, masks, rejects)
            survivors = []
            for tr in active:
                item, reason = assess(frame, tr.quad, masks[tr.kind], tr.kind, tr.confidence, cfg,
                                      masks.get('foreground'))
                if item is None:
                    # One sampled miss of the SURFACE mask is tolerated (flow/pixel evidence still holds);
                    # anything else (foreground, clutter, geometry) ends the track immediately.
                    if reason == 'unsafe_or_uncertain_surface' and tr.misses < 1:
                        tr.misses += 1
                        rejects['recheck_grace_' + reason] += 1
                        survivors.append(tr)
                        continue
                    rejects['recheck_' + reason] += 1
                    if tr.rows and tr.rows[-1][0] == frame_idx:
                        tr.rows.pop()
                    finished.append(tr)
                else:
                    tr.misses = 0
                    tr.last_verified, tr.rank = frame_idx, item['score']
                    # Re-anchor on a matching fresh detection: removes tracker drift.
                    for cand in candidates:
                        if cand['kind'] == tr.kind and iou(cand['box'], quad_bbox(tr.quad)) >= .5:
                            tr.quad = (0.5 * tr.quad + 0.5 * cand['quad']).astype(np.float32)
                            break
                    if tr.rows and tr.rows[-1][0] == frame_idx:
                        tr.rows[-1] = make_row(frame_idx, tr.quad, tr.rank, tr.rows[-1][3])
                    survivors.append(tr)
            active = survivors
            for item in candidates:
                tb = item['box']
                if any(iou(tb, quad_bbox(tr.quad)) >= cfg.match_iou or same_region(tb, quad_bbox(tr.quad))
                       for tr in active):
                    continue
                tr = Track(next_id, scene_id, item['kind'], item['label'], item['confidence'], item['quad'],
                           rows=[make_row(frame_idx, item['quad'], item['score'], 1.)],
                           last_verified=frame_idx, rank=item['score'])
                active.append(tr)
                next_id += 1
            if frame_idx % max(step, round(fps * 5)) == 0:
                print(f'Analyzed {frame_idx / fps:.1f}s | active tracks={len(active)} | finished={len(finished)}',
                      flush=True)
        previous, previous_gray = frame, gray
        frame_idx += 1
    cap.release()
    models.save_cache()
    finished.extend(active)
    return finished, dict(fps=fps, processed_frames=frame_idx, duration_sec=frame_idx / fps,
                          coordinate_space='normalized_input_pixels', working_width=width,
                          working_height=height, detect_every_frames=step, effective_detect_hz=fps / step,
                          scene_cut_frames=cuts, rejected_counts=dict(rejects),
                          tracking_sec=round(track_seconds, 3))


def candidate_report(tracks, out_dir, fps, cfg):
    previews, summaries = [], []
    for track in tracks:
        rows = track.rows
        if len(rows) < max(2, round(.4 * fps)):
            continue
        duration = len(rows) / fps
        verified = sum(r[0] <= track.last_verified for r in rows) / fps
        cid = len(previews) + 1
        previews.append(dict(slot_id=cid, track_id=track.track_id, kind=track.kind, rows=rows,
                             rank=float(np.mean([r[2] for r in rows])),
                             start_frame=rows[0][0], end_frame_exclusive=rows[-1][0] + 1))
        summaries.append(dict(candidate_id=cid, track_id=track.track_id, kind=track.kind,
                              start_sec=rows[0][0] / fps, end_sec=(rows[-1][0] + 1) / fps,
                              continuous_duration_sec=round(duration, 3),
                              detector_confirmed_span_sec=round(verified, 3),
                              meets_4s_rule=duration >= cfg.min_duration,
                              reason='eligible_for_ranking' if duration >= cfg.min_duration
                              else 'detected_but_visible_less_than_4s'))
    fields = ['candidate_id', 'track_id', 'kind', 'start_sec', 'end_sec', 'continuous_duration_sec',
              'detector_confirmed_span_sec', 'meets_4s_rule', 'reason']
    with (out_dir / 'candidate_summary.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(summaries)
    return previews, summaries


def export_results(source, digest, out_dir, cfg, selected, meta, started, models):
    fps = meta['fps']
    slots, coordinates = [], []
    for slot in selected:
        rows = slot['rows']
        first = rows[0][1]
        fq = rows[0][4]
        slots.append(dict(slot_id=slot['slot_id'], rank_order=slot['rank_order'], track_id=slot['track_id'],
                          scene_id=slot['scene_id'], kind=slot['kind'], label=slot['label'],
                          start_sec=slot['start_frame'] / fps, end_sec=slot['end_frame_exclusive'] / fps,
                          start_time=timestamp(slot['start_frame'] / fps),
                          end_time=timestamp(slot['end_frame_exclusive'] / fps),
                          duration_sec=len(rows) / fps, start_frame=slot['start_frame'],
                          end_frame_exclusive=slot['end_frame_exclusive'],
                          ranking_score=round(slot['rank'], 4), min_frame_score=slot['min_frame_score'],
                          x1=first[0], y1=first[1], x2=first[2], y2=first[3], quad=fq,
                          reason='YOLOE segmentation; foreground exclusion; homography quad tracking; '
                                 'periodic detector re-anchoring.'))
        for row in rows:
            coordinates.append([slot['slot_id'], row[0], row[0] / fps, *row[1], row[2], row[3], *row[4]])
    keys = ['slot_id', 'rank_order', 'track_id', 'scene_id', 'kind', 'start_sec', 'end_sec', 'start_time',
            'end_time', 'duration_sec', 'start_frame', 'end_frame_exclusive', 'ranking_score',
            'min_frame_score', 'x1', 'y1', 'x2', 'y2', 'reason']
    with (out_dir / 'slots.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=keys, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(slots)
    with (out_dir / 'coordinates.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['slot_id', 'frame', 'time_sec', 'x1', 'y1', 'x2', 'y2', 'frame_rank', 'tracking_quality',
                         'qx1', 'qy1', 'qx2', 'qy2', 'qx3', 'qy3', 'qx4', 'qy4'])
        writer.writerows(coordinates)
    import importlib.metadata
    versions = {}
    for package in ['torch', 'torchvision', 'ultralytics', 'numpy', 'opencv-python-headless', 'Pillow']:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = 'not installed under this distribution name'
    data = dict(pipeline_version='5.1', status='ok' if slots else 'no_suitable_slot',
                input_video=str(source.resolve()), input_sha256=digest, config=asdict(cfg), metadata=meta,
                slots=slots, elapsed_sec=round(time.time() - started, 2), device=models.device,
                python=platform.python_version(), versions=versions,
                limitations=['Pretrained open-vocabulary model, not trained on ad-suitability.',
                             'Surface masks are sampled; homography/pixel tracking runs between samples '
                             '(one missed sample is bridged by tracking evidence only).',
                             'Quads assume a planar surface; curved or heavily occluded surfaces are not modelled.',
                             'Ranking score is not calibrated confidence or measured accuracy.',
                             'No guarantee of detecting every suitable slot or excluding every unsuitable one.'])
    (out_dir / 'slots.json').write_text(json.dumps(data, indent=2), encoding='utf-8')
    return data


def raw_summary(models):
    stats = {}
    for raw in models.cache.values():
        best = {}
        for p in raw:
            best[p['kind']] = max(best.get(p['kind'], 0.), p['confidence'])
        for kind, conf in best.items():
            item = stats.setdefault(kind, {'frames_with_detection': 0, 'max_confidence': 0.})
            item['frames_with_detection'] += 1
            item['max_confidence'] = round(max(item['max_confidence'], conf), 3)
    return {'sampled_frames': len(models.cache), 'by_kind': stats}


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--video', required=True)
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--max-slots', type=int, choices=[1, 2, 3], default=3)
    parser.add_argument('--min-duration', type=float, default=4.0)
    parser.add_argument('--target-duration', type=float, help='Legacy argument, ignored. Slots have no duration cap.')
    parser.add_argument('--detect-hz', type=float, default=1.0)
    parser.add_argument('--min-conf', type=float, default=.12, help='Min model score for boards/frames.')
    parser.add_argument('--min-rank', type=float, default=.40)
    parser.add_argument('--allow-existing', dest='allow_existing', action='store_true', default=True)
    parser.add_argument('--blank-only', dest='allow_existing', action='store_false')
    parser.add_argument('--model-id', default='yoloe-11s-seg.pt',
                        help='yoloe-11s-seg.pt (fast) or yoloe-11m-seg.pt / yoloe-11l-seg.pt (more accurate).')
    parser.add_argument('--imgsz', type=int, default=640, help='Model input size: 640 fast, 960 finds small boards.')
    parser.add_argument('--cache', default=None, help='Optional raw detection cache folder.')
    parser.add_argument('--max-width', type=int, default=1280)
    parser.add_argument('--min-aspect', type=float, default=0.5, help='Min width/height of a slot (0.3-1.0).')
    parser.add_argument('--min-surface-fraction', type=float, default=0.85)
    parser.add_argument('--device', choices=['cpu', 'cuda'], default=None)
    args = parser.parse_args()
    if not math.isfinite(args.min_duration) or args.min_duration < 4:
        parser.error('min-duration must be finite and at least 4 seconds.')
    if not 1 <= args.detect_hz <= 10:
        parser.error('detect-hz must be between 1 and 10.')
    if not .05 <= args.min_conf <= .9 or not 0 <= args.min_rank <= 1:
        parser.error('Invalid score thresholds.')
    if not .3 <= args.min_aspect <= 1 or not .5 <= args.min_surface_fraction <= 1:
        parser.error('min-aspect must be 0.3-1.0 and min-surface-fraction 0.5-1.0.')
    if args.max_width < 320 or args.max_width % 2:
        parser.error('max-width must be an even integer >= 320.')
    if args.imgsz % 32 or not 320 <= args.imgsz <= 1280:
        parser.error('imgsz must be a multiple of 32 between 320 and 1280.')
    return args


def main():
    args = parse_args()
    source = Path(args.video)
    if not source.is_file():
        raise FileNotFoundError(source)
    out_dir = Path(args.out_dir)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(f'{out_dir} is not empty. Use a new run folder.')
    out_dir.mkdir(parents=True, exist_ok=True)
    cfg = Config(**{k: getattr(args, k) for k in ['max_slots', 'min_duration', 'target_duration', 'detect_hz',
                                                  'min_conf', 'min_rank', 'allow_existing', 'model_id', 'imgsz',
                                                  'min_aspect', 'min_surface_fraction']})
    started = time.time()
    stage = {}
    t0 = time.time()
    normalized = out_dir / 'normalized_input.mp4'
    normalize_video(source, normalized, args.max_width)
    stage['normalize_sec'] = round(time.time() - t0, 2)
    digest = file_sha256(source)
    cache_name = f'{digest[:20]}_w{args.max_width}_hz{cfg.detect_hz:g}_{Path(cfg.model_id).stem}_{cfg.imgsz}.json'
    cache_path = (Path(args.cache) / cache_name) if args.cache else (out_dir / 'raw_detections.json')
    models = Models(cfg, args.device, cache_path)
    t0 = time.time()
    tracks, meta = analyze(normalized, models, cfg)
    stage['analysis_sec'] = round(time.time() - t0, 2)
    meta['fresh_model_inference_sec'] = round(models.inference_seconds, 3)
    meta['raw_detection_cache_entries'] = len(models.cache)
    meta['model_saw'] = raw_summary(models)
    print('MODEL SAW (before filters):', json.dumps(meta['model_saw']), flush=True)
    print('FILTER REJECTIONS:', json.dumps(meta['rejected_counts']), flush=True)
    if args.cache is None:
        pass  # cache already lives at out_dir/raw_detections.json
    preview_tracks, summaries = candidate_report(tracks, out_dir, meta['fps'], cfg)
    meta['detected_candidate_tracks'] = len(summaries)
    meta['longest_candidate_duration_sec'] = max((c['continuous_duration_sec'] for c in summaries), default=0)
    options = window_options(tracks, meta['fps'], cfg)
    selected = select_windows(options, cfg)
    meta['track_count'] = len(tracks)
    meta['valid_window_candidate_count'] = len(options)
    t0 = time.time()
    written = render_both(normalized, out_dir, selected, preview_tracks, meta['fps'])
    stage['render_sec'] = round(time.time() - t0, 2)
    if written != meta['processed_frames']:
        raise RuntimeError('Analysis and rendering frame counts differ.')
    stage['total_sec'] = round(time.time() - started, 2)
    meta['timing'] = stage
    data = export_results(source, digest, out_dir, cfg, selected, meta, started, models)
    print('\nStatus:', data['status'], '| Total slots:', len(data['slots']))
    print('Timing (s):', json.dumps(stage))
    print('Detected candidate tracks:', len(summaries), '| Longest continuous candidate:',
          meta['longest_candidate_duration_sec'], 's')
    if not data['slots']:
        print('Inspect detection_preview.mp4 and candidate_summary.csv: detections are separate from 4-second eligibility.')
    for slot in data['slots']:
        print(f"SLOT {slot['slot_id']}: {slot['start_time']} -> {slot['end_time']} ({slot['duration_sec']:.2f}s)")
    print('Saved:', out_dir.resolve())


if __name__ == '__main__':
    main()