from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


def _normalize(depth: np.ndarray, valid: np.ndarray, display: str) -> np.ndarray:
    if not np.any(valid):
        return np.zeros(depth.shape, dtype=np.uint8)
    values = depth[valid].astype(np.float32)
    if display == "inverse":
        values = 1.0 / np.maximum(values, 1e-4)
    elif display == "log":
        values = np.log1p(values)
    low, high = np.percentile(values, [1.0, 99.0])
    out = np.zeros(depth.shape, dtype=np.uint8)
    out[valid] = np.clip((values - low) / max(high - low, 1e-6) * 255.0, 0, 255).astype(np.uint8)
    out[valid] = 255 - out[valid]
    return out


def save_depth_visuals(depth: np.ndarray, valid: np.ndarray, output_dir: Path) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    artifacts: dict[str, str] = {}
    colormaps = {
        "turbo": cv2.COLORMAP_TURBO,
        "viridis": cv2.COLORMAP_VIRIDIS,
        "jet": cv2.COLORMAP_JET,
        "magma": cv2.COLORMAP_MAGMA,
        "inferno": cv2.COLORMAP_INFERNO,
        "plasma": cv2.COLORMAP_PLASMA,
        "grayscale": None,
    }
    for display in ("metric", "inverse", "log"):
        normalized = _normalize(depth, valid, display)
        for name, cmap in colormaps.items():
            if cmap is None:
                image = cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR)
            else:
                image = cv2.applyColorMap(normalized, cmap)
            image[~valid] = 0
            filename = f"depth_{display}_{name}.png"
            cv2.imwrite(str(output_dir / filename), image)
            artifacts[f"depth_{display}_{name}"] = filename

    # Backward-compatible aliases.
    artifacts["depth_turbo"] = artifacts["depth_metric_turbo"]

    # Depth contour visualization: quantize normalized depth and draw boundaries.
    normalized = _normalize(depth, valid, "metric")
    base = cv2.applyColorMap(normalized, cv2.COLORMAP_TURBO)
    quantized = np.floor(normalized.astype(np.float32) / 24.0).astype(np.uint8)
    contours_img = base.copy()
    contours = cv2.Canny(quantized, 20, 60)
    contours_img[contours > 0] = (255, 255, 255)
    contours_img[~valid] = 0
    cv2.imwrite(str(output_dir / "depth_contours.png"), contours_img)
    artifacts["depth_contours"] = "depth_contours.png"
    return artifacts
