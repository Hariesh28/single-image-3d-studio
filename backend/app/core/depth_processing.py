from __future__ import annotations

import cv2
import numpy as np


def sanitize_depth(depth: np.ndarray, max_depth: float) -> tuple[np.ndarray, np.ndarray]:
    depth = np.asarray(depth, dtype=np.float32)
    valid = np.isfinite(depth) & (depth > 0.05) & (depth <= max_depth * 1.02)
    cleaned = depth.copy()
    cleaned[~valid] = 0.0
    return cleaned, valid


def depth_visualization(depth: np.ndarray, valid: np.ndarray, colormap: int = cv2.COLORMAP_TURBO) -> np.ndarray:
    if not np.any(valid):
        return np.zeros((*depth.shape, 3), dtype=np.uint8)
    low, high = np.percentile(depth[valid], [1.0, 99.0])
    normalized = np.zeros(depth.shape, dtype=np.uint8)
    normalized[valid] = np.clip(
        (depth[valid] - low) / max(high - low, 1e-6) * 255.0,
        0,
        255,
    ).astype(np.uint8)
    # Invert so near objects receive the visually warm end consistently.
    normalized[valid] = 255 - normalized[valid]
    return cv2.applyColorMap(normalized, colormap)


def depth_percentiles(depth: np.ndarray, valid: np.ndarray) -> dict[str, float]:
    if not np.any(valid):
        return {"p01": 0.0, "p05": 0.0, "p25": 0.0, "p50": 0.0, "p75": 0.0, "p95": 0.0, "p99": 0.0}
    values = depth[valid]
    p = np.percentile(values, [1, 5, 25, 50, 75, 95, 99])
    return {f"p{key}": float(value) for key, value in zip(("01", "05", "25", "50", "75", "95", "99"), p)}
