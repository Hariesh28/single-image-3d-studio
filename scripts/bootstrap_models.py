from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.ml.bootstrap import ensure_model, ensure_source, ensure_segmentation_model, model_status


def main() -> None:
    print("Preparing Depth Anything V2 source...")
    ensure_source()
    for scene_type in ("indoor", "outdoor"):
        print(f"Preparing {scene_type} Large metric checkpoint...")
        ensure_model(scene_type)
    print("Preparing optional COCO instance-segmentation model...")
    try:
        ensure_segmentation_model()
    except Exception as exc:
        print(f"Warning: segmentation checkpoint not prepared: {exc}")
    print(model_status())


if __name__ == "__main__":
    main()
