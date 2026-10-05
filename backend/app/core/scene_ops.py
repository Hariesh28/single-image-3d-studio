from __future__ import annotations

import numpy as np


def apply_scene_transform(points: np.ndarray, transform: dict | None, scale: float = 1.0) -> np.ndarray:
    out = points.astype(np.float32) * np.float32(scale)
    if not transform:
        return out
    rotation = np.asarray(transform["rotation"], dtype=np.float32)
    translation = np.asarray(transform["translation"], dtype=np.float32)
    return out @ rotation.T + translation
