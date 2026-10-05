from __future__ import annotations

import math
from typing import Any

import numpy as np


def _fit_plane(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> tuple[np.ndarray, float] | None:
    normal = np.cross(b - a, c - a)
    norm = float(np.linalg.norm(normal))
    if norm < 1e-8:
        return None
    normal = normal / norm
    offset = -float(np.dot(normal, a))
    return normal.astype(np.float64), offset


def detect_planes(
    points: np.ndarray,
    iterations: int = 160,
    threshold: float = 0.035,
    min_inliers: int = 300,
    max_planes: int = 4,
    sample_limit: int = 80_000,
) -> list[dict[str, Any]]:
    if len(points) < min_inliers:
        return []

    rng = np.random.default_rng(2026)
    sample_count = min(len(points), sample_limit)
    indices = np.linspace(0, len(points) - 1, sample_count, dtype=np.int64) if len(points) > sample_limit else np.arange(len(points))
    sampled = np.asarray(points[indices], dtype=np.float64)
    remaining = np.arange(len(sampled), dtype=np.int64)
    planes: list[dict[str, Any]] = []

    for plane_index in range(max_planes):
        if len(remaining) < min_inliers:
            break
        cloud = sampled[remaining]
        best_count = 0
        best_normal: np.ndarray | None = None
        best_offset = 0.0
        best_mask: np.ndarray | None = None

        for _ in range(iterations):
            choice = rng.integers(0, len(cloud), 3)
            fit = _fit_plane(cloud[choice[0]], cloud[choice[1]], cloud[choice[2]])
            if fit is None:
                continue
            normal, offset = fit
            distances = np.abs(cloud @ normal + offset)
            mask = distances <= threshold
            count = int(mask.sum())
            if count > best_count:
                best_count = count
                best_normal = normal
                best_offset = offset
                best_mask = mask

        if best_mask is None or best_count < min_inliers or best_normal is None:
            break

        inlier_cloud = cloud[best_mask]
        center = inlier_cloud.mean(axis=0)
        covariance = np.cov(inlier_cloud - center, rowvar=False) if len(inlier_cloud) >= 3 else np.eye(3)
        eigenvalues = np.linalg.eigvalsh(covariance)
        curvature = float(eigenvalues[0] / max(float(eigenvalues.sum()), 1e-12))
        normal = best_normal / max(float(np.linalg.norm(best_normal)), 1e-12)
        # Make the Y component positive so the UI has a consistent orientation.
        if normal[1] < 0:
            normal *= -1.0
            best_offset *= -1.0

        planes.append(
            {
                "id": plane_index,
                "normal": normal.tolist(),
                "offset": float(best_offset),
                "inliers": best_count,
                "center": center.tolist(),
                "curvature": curvature,
                "threshold_m": threshold,
            }
        )
        remaining = remaining[~best_mask]

    return planes


def choose_ground_plane(planes: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not planes:
        return None
    scored: list[tuple[float, dict[str, Any]]] = []
    for plane in planes:
        normal = np.asarray(plane["normal"], dtype=np.float64)
        center = np.asarray(plane["center"], dtype=np.float64)
        upness = abs(float(normal[1]))
        height_score = math.exp(-abs(float(center[1])) / 2.5)
        horizontal_score = upness**2
        count_score = math.log1p(int(plane["inliers"]))
        score = horizontal_score * height_score * count_score
        scored.append((score, plane))
    return max(scored, key=lambda item: item[0])[1]


def rotation_matrix_from_vectors(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    a = source.astype(np.float64)
    b = target.astype(np.float64)
    a /= max(np.linalg.norm(a), 1e-12)
    b /= max(np.linalg.norm(b), 1e-12)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-10:
        if c > 0:
            return np.eye(3, dtype=np.float64)
        # 180-degree rotation around any axis orthogonal to a.
        axis = np.array([1.0, 0.0, 0.0])
        if abs(a[0]) > 0.9:
            axis = np.array([0.0, 1.0, 0.0])
        axis -= axis.dot(a) * a
        axis /= np.linalg.norm(axis)
        return -np.eye(3) + 2 * np.outer(axis, axis)
    s = np.array(
        [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]],
        dtype=np.float64,
    )
    return np.eye(3) + s + s @ s * ((1 - c) / max(np.dot(v, v), 1e-12))


def ground_transform(ground_plane: dict[str, Any] | None) -> dict[str, Any] | None:
    if not ground_plane:
        return None
    normal = np.asarray(ground_plane["normal"], dtype=np.float64)
    rotation = rotation_matrix_from_vectors(normal, np.array([0.0, 1.0, 0.0]))
    center = np.asarray(ground_plane["center"], dtype=np.float64)
    rotated_center = rotation @ center
    translation = np.array([0.0, -rotated_center[1], 0.0], dtype=np.float64)
    return {"rotation": rotation.tolist(), "translation": translation.tolist()}
