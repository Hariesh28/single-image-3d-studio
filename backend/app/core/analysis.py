from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np


def _valid(depth: np.ndarray, max_depth: float) -> np.ndarray:
    d = np.asarray(depth, dtype=np.float32)
    return np.isfinite(d) & (d > 0.05) & (d <= max_depth * 1.02)


def depth_stats(depth: np.ndarray, max_depth: float, scale: float = 1.0) -> dict[str, Any]:
    d = np.asarray(depth, dtype=np.float32)
    valid = _valid(d, max_depth)
    values = d[valid].astype(np.float64) * float(scale)
    if values.size == 0:
        return {
            "valid_fraction": 0.0,
            "invalid_fraction": 1.0,
            "min_m": 0.0,
            "max_m": 0.0,
            "mean_m": 0.0,
            "median_m": 0.0,
            "std_m": 0.0,
            "percentiles_m": {f"p{k}": 0.0 for k in (1, 5, 10, 25, 50, 75, 90, 95, 99)},
        }
    pkeys = (1, 5, 10, 25, 50, 75, 90, 95, 99)
    pvals = np.percentile(values, pkeys)
    return {
        "valid_fraction": float(valid.mean()),
        "invalid_fraction": float(1.0 - valid.mean()),
        "min_m": float(values.min()),
        "max_m": float(values.max()),
        "mean_m": float(values.mean()),
        "median_m": float(np.median(values)),
        "std_m": float(values.std()),
        "percentiles_m": {f"p{k}": float(v) for k, v in zip(pkeys, pvals)},
    }


def depth_histogram(depth: np.ndarray, max_depth: float, scale: float = 1.0, bins: int = 64) -> dict[str, list[float]]:
    bins = int(np.clip(bins, 8, 256))
    d = np.asarray(depth, dtype=np.float32)
    valid = _valid(d, max_depth)
    if not np.any(valid):
        return {"edges_m": [], "counts": []}
    values = d[valid].astype(np.float64) * float(scale)
    upper = max(float(np.percentile(values, 99.5)), float(values.max()), 0.1)
    edges = np.linspace(0.0, upper, bins + 1)
    counts, _ = np.histogram(values, bins=edges)
    return {"edges_m": edges.tolist(), "counts": counts.astype(np.int64).tolist()}


def depth_edge_map(depth: np.ndarray) -> np.ndarray:
    d = np.asarray(depth, dtype=np.float32)
    valid = np.isfinite(d)
    clean = np.where(valid, d, 0.0)
    gx = cv2.Sobel(clean, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(clean, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    denom = float(np.percentile(mag[valid], 99.0)) if np.any(valid) else 1.0
    return np.clip(mag / max(denom, 1e-6), 0.0, 1.0)


def depth_quality(depth: np.ndarray, max_depth: float) -> dict[str, Any]:
    d = np.asarray(depth, dtype=np.float32)
    valid = _valid(d, max_depth)
    if not np.any(valid):
        return {
            "valid_fraction": 0.0,
            "smoothness": 0.0,
            "edge_fraction": 0.0,
            "hole_fraction": 1.0,
            "gradient_median": 0.0,
            "gradient_p95": 0.0,
            "score": 0.0,
            "label": "poor",
        }
    edges = depth_edge_map(d)
    edge_fraction = float((edges > 0.25).mean())
    lap = cv2.Laplacian(np.where(valid, d, 0.0), cv2.CV_32F)
    scale = float(np.median(d[valid]))
    relative_lap = float(np.mean(np.abs(lap[valid])) / max(scale, 1e-4))
    smoothness = float(np.clip(1.0 - relative_lap * 1.8, 0.0, 1.0))
    gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=3)
    grad = cv2.magnitude(gx, gy)[valid]
    score = float(np.clip(0.55 * float(valid.mean()) + 0.45 * smoothness, 0.0, 1.0))
    label = "excellent" if score >= 0.90 else "good" if score >= 0.75 else "fair" if score >= 0.55 else "poor"
    return {
        "valid_fraction": float(valid.mean()),
        "smoothness": smoothness,
        "edge_fraction": edge_fraction,
        "hole_fraction": float((~valid).mean()),
        "gradient_median": float(np.median(grad)) if grad.size else 0.0,
        "gradient_p95": float(np.percentile(grad, 95)) if grad.size else 0.0,
        "score": score,
        "label": label,
    }


def _polygon_area_3d(points: np.ndarray) -> float:
    if len(points) < 3:
        return 0.0
    center = np.mean(points, axis=0)
    area = 0.0
    for i in range(len(points)):
        a = points[i] - center
        b = points[(i + 1) % len(points)] - center
        area += 0.5 * float(np.linalg.norm(np.cross(a, b)))
    return float(area)


def region_stats(mask: np.ndarray, depth: np.ndarray, rgb: np.ndarray, calibration: dict, max_depth: float, polygon: list[tuple[int,int]] | None = None) -> dict[str, Any]:
    mask = np.asarray(mask, dtype=bool)
    depth = np.asarray(depth, dtype=np.float32)
    valid = mask & _valid(depth, max_depth)
    ys, xs = np.where(mask)
    result: dict[str, Any] = {
        "pixel_count": int(mask.sum()),
        "valid_depth_pixels": int(valid.sum()),
        "coverage_fraction": float(mask.mean()),
    }
    if ys.size:
        bbox = {"x0": int(xs.min()), "y0": int(ys.min()), "x1": int(xs.max()), "y1": int(ys.max())}
        result["bbox_px"] = bbox
    else:
        result["bbox_px"] = None
    if not np.any(valid):
        result.update({
            "depth_median_m": None,
            "depth_mean_m": None,
            "xyz_min": None,
            "xyz_max": None,
            "dimensions_m": None,
            "centroid_m": None,
            "surface_area_m2": None,
            "bbox_volume_m3": None,
        })
        return result
    values = depth[valid].astype(np.float64) * float(calibration.get("scale", 1.0))
    result["depth_median_m"] = float(np.median(values))
    result["depth_mean_m"] = float(np.mean(values))

    from .geometry import points_from_mask

    points = points_from_mask(depth, mask, calibration, max_depth=max_depth, max_points=50_000)
    if len(points):
        mn = points.min(axis=0)
        mx = points.max(axis=0)
        dims = mx - mn
        result["xyz_min"] = mn.tolist()
        result["xyz_max"] = mx.tolist()
        result["dimensions_m"] = dims.tolist()
        result["centroid_m"] = points.mean(axis=0).tolist()
        result["bbox_volume_m3"] = float(np.prod(np.maximum(dims, 0.0)))
    else:
        result["xyz_min"] = result["xyz_max"] = result["dimensions_m"] = result["centroid_m"] = None
        result["bbox_volume_m3"] = None

    # Surface area from a simplified boundary polygon. This is intentionally an
    # approximation; irregular masks/occlusions make a single-image surface area
    # inherently uncertain.
    if bbox := result.get("bbox_px"):
        bx = np.asarray(polygon if polygon and len(polygon) >= 3 else [[bbox["x0"], bbox["y0"]], [bbox["x1"], bbox["y0"]], [bbox["x1"], bbox["y1"]], [bbox["x0"], bbox["y1"]]], dtype=np.int32)
        boundary = []
        from .geometry import point_from_pixel
        scale = float(calibration.get("scale", 1.0))
        for x, y in bx:
            z = float(depth[int(y), int(x)])
            if np.isfinite(z) and z > 0.05 and z <= max_depth * 1.02:
                boundary.append(point_from_pixel(z, int(x), int(y), calibration).astype(np.float64) * scale)
        result["surface_area_m2"] = _polygon_area_3d(np.asarray(boundary)) if len(boundary) >= 3 else None
    else:
        result["surface_area_m2"] = None
    return result


def cross_section(depth: np.ndarray, rgb: np.ndarray, calibration: dict, p1: tuple[int, int], p2: tuple[int, int], max_depth: float, samples: int = 512) -> dict[str, Any]:
    h, w = depth.shape
    x1, y1 = p1
    x2, y2 = p2
    length = math.hypot(x2 - x1, y2 - y1)
    n = int(np.clip(samples, 16, 2048))
    xs = np.linspace(x1, x2, n).round().astype(int)
    ys = np.linspace(y1, y2, n).round().astype(int)
    xs = np.clip(xs, 0, w - 1)
    ys = np.clip(ys, 0, h - 1)
    z = depth[ys, xs].astype(np.float32)
    valid = _valid(z, max_depth)
    from .geometry import point_from_pixel
    points: list[list[float] | None] = []
    scale = float(calibration.get("scale", 1.0))
    cumulative = [0.0]
    last = None
    for x, y, zv, ok in zip(xs, ys, z, valid):
        if ok:
            p = point_from_pixel(float(zv), int(x), int(y), calibration).astype(float)
            p *= scale
            points.append(p.tolist())
            if last is not None:
                cumulative.append(cumulative[-1] + float(np.linalg.norm(p - last)))
            last = p
        else:
            points.append(None)
            cumulative.append(cumulative[-1])
    return {
        "start": [x1, y1],
        "end": [x2, y2],
        "pixel_length": length,
        "samples": int(n),
        "points": points,
        "depth_m": [(float(v * scale) if ok else None) for v, ok in zip(z, valid)],
        "distance_m": cumulative[:n],
        "pixel_x": xs.tolist(),
        "pixel_y": ys.tolist(),
    }


def project_point(point: np.ndarray, calibration: dict) -> tuple[float, float]:
    x, y, z = map(float, point)
    if z <= 1e-8:
        raise ValueError("Point is behind the camera")
    K = np.array([[calibration['fx'],0.0,calibration['cx']],[0.0,calibration['fy'],calibration['cy']],[0.0,0.0,1.0]],dtype=np.float64)
    dist_cfg=calibration.get('distortion') or {}
    dist=np.array([float(dist_cfg.get(k,0.0) or 0.0) for k in ('k1','k2','p1','p2','k3')],dtype=np.float64)
    xyz=np.array([[x,-y,z]],dtype=np.float64).reshape(-1,1,3)
    uv,_=cv2.projectPoints(xyz,np.zeros((3,1)),np.zeros((3,1)),K,dist)
    return float(uv[0,0,0]),float(uv[0,0,1])
