from __future__ import annotations

import math
import struct
from pathlib import Path

import cv2
import numpy as np

MAGIC_PC = 0x50334332
MAGIC_DEPTH = 0x44455031
POINTCLOUD_VERSION = 2
FLAG_NORMALS = 1


def _valid_mask(depth: np.ndarray, max_depth: float) -> np.ndarray:
    return np.isfinite(depth) & (depth > 0.05) & (depth <= max_depth)


def _importance_candidates(depth: np.ndarray, rgb: np.ndarray, valid: np.ndarray, max_points: int) -> np.ndarray:
    total = int(valid.sum())
    if total == 0:
        return np.empty(0, dtype=np.int64)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = cv2.magnitude(gx, gy)
    grad /= float(np.percentile(grad, 99.0) + 1e-6)
    grad = np.clip(grad, 0, 1)
    dh = np.zeros_like(depth, dtype=np.float32); dv = np.zeros_like(depth, dtype=np.float32)
    dh[:, 1:] = np.abs(np.diff(depth, axis=1)); dv[1:, :] = np.abs(np.diff(depth, axis=0))
    edge = np.clip((dh + dv) / max(float(np.nanpercentile(depth[valid], 90)), 1e-3), 0, 1)
    importance = 0.25 + 0.60 * grad + 1.0 * edge
    valid_ids = np.flatnonzero(valid.ravel())
    if len(valid_ids) <= max_points:
        return valid_ids.astype(np.int64)
    target_base = max(1, max_points // 3)
    stride = max(1, int(math.ceil(math.sqrt(total / target_base))))
    base_mask = np.zeros_like(valid, dtype=bool); base_mask[::stride, ::stride] = True
    base_ids = np.flatnonzero((base_mask & valid).ravel())
    if len(base_ids) > target_base: base_ids = base_ids[:target_base]
    remaining_mask = valid.ravel().copy(); remaining_mask[base_ids] = False
    remaining = np.flatnonzero(remaining_mask)
    budget = max_points - len(base_ids)
    if len(remaining) <= budget:
        chosen = np.concatenate((base_ids, remaining))
    else:
        scores = importance.ravel()[remaining]
        top = np.argpartition(scores, -budget)[-budget:]
        chosen = np.concatenate((base_ids, remaining[top]))
    return np.sort(chosen.astype(np.int64))


def _backproject(x: np.ndarray, y: np.ndarray, z: np.ndarray, cal: dict) -> np.ndarray:
    fx, fy, cx, cy = map(float, (cal["fx"], cal["fy"], cal["cx"], cal["cy"]))
    distortion = cal.get("distortion") or {}
    coeffs = [float(distortion.get(k, 0.0) or 0.0) for k in ("k1", "k2", "p1", "p2", "k3")]
    pts = np.column_stack((x.astype(np.float64), y.astype(np.float64))).reshape(-1, 1, 2)
    if any(abs(v) > 1e-12 for v in coeffs):
        K = np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]], dtype=np.float64)
        undist = cv2.undistortPoints(pts, K, np.asarray(coeffs, dtype=np.float64).reshape(-1, 1))[:, 0, :]
        X = undist[:, 0] * z.astype(np.float64)
        Y = -undist[:, 1] * z.astype(np.float64)
    else:
        X = (x.astype(np.float64) - cx) * z.astype(np.float64) / fx
        Y = -(y.astype(np.float64) - cy) * z.astype(np.float64) / fy
    return np.column_stack((X, Y, z)).astype(np.float32)


def _estimate_normals(depth: np.ndarray, pixels: np.ndarray, cal: dict, max_depth: float) -> np.ndarray:
    h, w = depth.shape
    y, x = np.divmod(pixels.astype(np.int64), w)
    z = depth[y, x].astype(np.float32)
    xr, yd = np.minimum(x + 1, w - 1), np.minimum(y + 1, h - 1)
    zr, zd = depth[y, xr], depth[yd, x]
    center = _backproject(x.astype(np.float32), y.astype(np.float32), z, cal)
    right = _backproject(xr.astype(np.float32), y.astype(np.float32), zr.astype(np.float32), cal)
    down = _backproject(x.astype(np.float32), yd.astype(np.float32), zd.astype(np.float32), cal)
    normals = np.cross(right - center, down - center)
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    normals /= np.maximum(norms, 1e-8)
    nbr = np.isfinite(zr) & np.isfinite(zd) & (zr > 0.05) & (zd > 0.05) & (zr <= max_depth) & (zd <= max_depth)
    normals[~nbr] = 0
    flip = normals[:, 2] > 0
    normals[flip] *= -1
    return normals.astype(np.float32)


def depth_to_points(depth: np.ndarray, rgb: np.ndarray, cal: dict, max_points: int, max_depth: float = 100.0, include_normals: bool = True):
    h, w = depth.shape
    valid = _valid_mask(depth, max_depth)
    ids = _importance_candidates(depth, rgb, valid, max_points)
    if not len(ids):
        empty = np.empty((0, 3), np.float32)
        return empty, np.empty((0, 3), np.uint8), np.empty(0, np.uint32), None
    y, x = np.divmod(ids, w)
    z = depth[y, x].astype(np.float32)
    points = _backproject(x.astype(np.float32), y.astype(np.float32), z, cal) * np.float32(cal.get("scale", 1.0))
    colors = rgb[y, x].astype(np.uint8)
    pixels = ids.astype(np.uint32)
    normals = _estimate_normals(depth, pixels, cal, max_depth) if include_normals else None
    finite = np.isfinite(points).all(axis=1)
    return points[finite], colors[finite], pixels[finite], normals[finite] if normals is not None else None


def points_from_mask(depth: np.ndarray, mask: np.ndarray, cal: dict, max_depth: float, max_points: int = 50_000) -> np.ndarray:
    valid = np.asarray(mask, dtype=bool) & _valid_mask(depth, max_depth)
    ids = np.flatnonzero(valid.ravel())
    if len(ids) > max_points:
        step = max(1, len(ids) // max_points)
        ids = ids[::step][:max_points]
    h, w = depth.shape
    y, x = np.divmod(ids, w)
    z = depth[y, x].astype(np.float32)
    return _backproject(x.astype(np.float32), y.astype(np.float32), z, cal) * np.float32(cal.get("scale", 1.0))


def point_from_pixel(depth_value: float, x: int, y: int, cal: dict) -> np.ndarray:
    z = float(depth_value)
    p = _backproject(np.array([x], np.float32), np.array([y], np.float32), np.array([z], np.float32), cal)[0]
    return p * np.float32(cal.get("scale", 1.0))


def write_depth(path: Path, depth: np.ndarray) -> None:
    depth = np.asarray(depth, np.float32, order="C")
    with path.open("wb") as h: h.write(struct.pack("<III", MAGIC_DEPTH, depth.shape[1], depth.shape[0])); h.write(depth.tobytes())


def write_pointcloud(path: Path, points: np.ndarray, colors: np.ndarray, pixels: np.ndarray, width: int, height: int, normals: np.ndarray | None = None) -> None:
    points = np.asarray(points, np.float32, order="C"); colors = np.asarray(colors, np.uint8, order="C"); pixels = np.asarray(pixels, np.uint32, order="C")
    flags = FLAG_NORMALS if normals is not None else 0
    with path.open("wb") as h:
        h.write(struct.pack("<IIIII", MAGIC_PC, len(points), width, height, flags)); h.write(points.tobytes()); h.write(colors.tobytes())
        pad = (-h.tell()) % 4
        if pad: h.write(b"\0" * pad)
        if normals is not None:
            h.write(np.asarray(normals, np.float32, order="C").tobytes()); pad = (-h.tell()) % 4
            if pad: h.write(b"\0" * pad)
        h.write(pixels.tobytes())


def write_ply(path: Path, points: np.ndarray, colors: np.ndarray, normals: np.ndarray | None = None) -> None:
    dtype = [("x","<f4"),("y","<f4"),("z","<f4"),("r","u1"),("g","u1"),("b","u1")]
    if normals is not None: dtype += [("nx","<f4"),("ny","<f4"),("nz","<f4")]
    header = ["ply","format binary_little_endian 1.0",f"element vertex {len(points)}","property float x","property float y","property float z","property uchar red","property uchar green","property uchar blue"]
    if normals is not None: header += ["property float nx","property float ny","property float nz"]
    header += ["end_header"]
    rec = np.empty(len(points), dtype=dtype)
    rec["x"],rec["y"],rec["z"] = points.T; rec["r"],rec["g"],rec["b"] = colors.T
    if normals is not None: rec["nx"],rec["ny"],rec["nz"] = normals.T
    with path.open("wb") as h: h.write(("\n".join(header)+"\n").encode("ascii")); h.write(rec.tobytes())


def write_obj_points(path: Path, points: np.ndarray, colors: np.ndarray | None = None) -> None:
    with path.open("w", encoding="utf-8") as h:
        for i,p in enumerate(points):
            if colors is None: h.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
            else:
                c = colors[i].astype(np.float32)/255.0; h.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f} {c[0]:.6f} {c[1]:.6f} {c[2]:.6f}\n")


def transform_points(points: np.ndarray, scale: float = 1.0, rotation: np.ndarray | None = None, translation: np.ndarray | None = None) -> np.ndarray:
    out = points.astype(np.float32) * np.float32(scale)
    if rotation is not None: out = out @ np.asarray(rotation, np.float32).T
    if translation is not None: out = out + np.asarray(translation, np.float32)
    return out
