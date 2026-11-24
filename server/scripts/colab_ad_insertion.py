"""StreamWise AI - bridge between the Express API and the Phase 3 detector.

Node calls this script. It:
  1. runs ad_slot_detector_v4.py (billboard / blank-wall detection + tracking)
  2. copies the annotated result to the requested output path
  3. prints ONE JSON object on stdout (everything else goes to stderr)

Usage:
  python colab_ad_insertion.py --input in.mp4 --output out.mp4 \
      [--work-dir server/generated/ai] [--config '{"maxSlots":3}']
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
DETECTOR = HERE / "ad_slot_detector_v4.py"

# camelCase keys from the API  ->  detector CLI flags
CONFIG_FLAGS = {
    "maxSlots": "--max-slots",
    "minDuration": "--min-duration",
    "targetDuration": "--target-duration",
    "detectHz": "--detect-hz",
    "minConf": "--min-conf",
    "minRank": "--min-rank",
    "maxWidth": "--max-width",
    "device": "--device",
    "modelId": "--model-id",
    "minAspect": "--min-aspect",
    "minSurfaceFraction": "--min-surface-fraction",
}

# The notebook's defaults are very strict (they favour "no slot" over a wrong
# slot) and reject tall surfaces, which are common in portrait phone videos.
# The app uses this looser profile unless config {"profile": "strict"} is sent.
# These numbers are NOT validated: check results on your own clips.
LENIENT = {"minConf": 0.22, "minRank": 0.35, "minAspect": 0.5, "minSurfaceFraction": 0.80}


def fail(message: str, code: int = 1):
    print(json.dumps({"success": False, "error": message}))
    sys.exit(code)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--work-dir", default=str(HERE.parent / "generated" / "ai"))
    parser.add_argument("--config", default="{}", help="JSON string")
    parser.add_argument("--keep-run", action="store_true",
                        help="print where the full run folder is (CSV/JSON/previews). Node deletes it afterwards.")
    args = parser.parse_args()

    source = Path(args.input)
    if not source.is_file():
        fail(f"Input video not found: {source}")
    try:
        config = json.loads(args.config or "{}")
    except json.JSONDecodeError as exc:
        fail(f"--config is not valid JSON: {exc}")

    # The detector refuses non-empty folders, so every run gets a fresh one.
    run_dir = Path(args.work_dir) / f"{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    run_dir.parent.mkdir(parents=True, exist_ok=True)

    if config.get("profile") != "strict":
        config = {**LENIENT, **config}

    command = [sys.executable, str(DETECTOR), "--video", str(source), "--out-dir", str(run_dir),
               "--cache", str(Path(args.work_dir) / "raw_cache")]
    for key, flag in CONFIG_FLAGS.items():
        if config.get(key) is not None:
            command += [flag, str(config[key])]
    if config.get("allowExisting") is False:
        command.append("--blank-only")

    started = time.time()
    # Detector progress -> stderr so stdout stays clean JSON for Node.
    proc = subprocess.run(command, stdout=sys.stderr, stderr=sys.stderr)
    if proc.returncode != 0:
        fail(f"Detector exited with code {proc.returncode}. See server logs.", proc.returncode)

    result_json = run_dir / "slots.json"
    final_video = run_dir / "phase3_suggestions.mp4"
    if not result_json.exists() or not final_video.exists():
        fail("Detector finished but expected output files are missing.")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(final_video, output)
    # Colab's "DETECTION PREVIEW": every surface found, even ones visible < 4 s.
    preview = output.with_name(output.stem + "_preview.mp4")
    if (run_dir / "detection_preview.mp4").exists():
        shutil.copyfile(run_dir / "detection_preview.mp4", preview)

    data = json.loads(result_json.read_text(encoding="utf-8"))
    meta = data["metadata"]

    # Human-readable summary (stderr, so Node's JSON parsing is unaffected)
    print("\n=== SUMMARY ===", file=sys.stderr)
    print(f"device: {data.get('device')} | video: {meta['duration_sec']:.1f}s | "
          f"detected candidate tracks: {meta['detected_candidate_tracks']} | "
          f"longest: {meta.get('longest_candidate_duration_sec')}s | final slots: {len(data['slots'])}",
          file=sys.stderr)
    print(f"model saw (before filters): {meta.get('model_saw')}", file=sys.stderr)
    print(f"filter rejections: {meta.get('rejected_counts')}", file=sys.stderr)
    print(f"profile: {'strict' if config.get('profile') == 'strict' else 'lenient'}", file=sys.stderr)
    print(f"final video   : {output}", file=sys.stderr)
    print(f"preview video : {preview}  <- open THIS to see every detection", file=sys.stderr)
    if args.keep_run:
        print(f"full run folder kept: {run_dir}", file=sys.stderr)
    print(json.dumps({
        "success": True,
        "status": data["status"],                 # "ok" | "no_suitable_slot"
        "slots": data["slots"],                   # start/end time, box, rank, kind
        "metadata": {k: data["metadata"].get(k) for k in
                     ("fps", "duration_sec", "working_width", "working_height",
                      "detected_candidate_tracks", "scene_cut_frames")},
        "device": data.get("device"),
        "elapsedSec": round(time.time() - started, 2),
        "outputVideoPath": str(output),
        "previewVideoPath": str(preview),
        "runDir": str(run_dir),
        "files": {
            "slotsCsv": str(run_dir / "slots.csv"),
            "coordinatesCsv": str(run_dir / "coordinates.csv"),
            "detectionPreview": str(run_dir / "detection_preview.mp4"),
            "candidateSummary": str(run_dir / "candidate_summary.csv"),
        },
    }))


if __name__ == "__main__":
    main()