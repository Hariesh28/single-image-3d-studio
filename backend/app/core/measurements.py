from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np


def _vector(value: Sequence[float]) -> np.ndarray:
    arr = np.asarray(value, dtype=np.float64)
    if arr.shape != (3,) or not np.isfinite(arr).all():
        raise ValueError("3D points must contain exactly three finite coordinates")
    return arr


def measure_points(a: Sequence[float], b: Sequence[float], c: Sequence[float] | None = None) -> dict[str, Any]:
    pa = _vector(a)
    pb = _vector(b)
    delta = pb - pa
    result: dict[str, Any] = {
        "a": pa.tolist(),
        "b": pb.tolist(),
        "delta": delta.tolist(),
        "distance_m": float(np.linalg.norm(delta)),
        "horizontal_distance_m": float(np.linalg.norm(delta[[0, 2]])),
        "vertical_difference_m": float(abs(delta[1])),
        "depth_difference_m": float(abs(delta[2])),
    }

    if c is not None:
        pc = _vector(c)
        v1 = pa - pb
        v2 = pc - pb
        n1 = float(np.linalg.norm(v1))
        n2 = float(np.linalg.norm(v2))
        if n1 <= 1e-12 or n2 <= 1e-12:
            result["c"] = pc.tolist()
            result["angle_deg"] = None
        else:
            cosine = float(np.dot(v1, v2) / (n1 * n2))
            result["c"] = pc.tolist()
            result["angle_deg"] = float(math.degrees(math.acos(np.clip(cosine, -1.0, 1.0))))

    return result
