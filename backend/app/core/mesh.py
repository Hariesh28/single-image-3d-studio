from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import trimesh
from PIL import Image
from .geometry import _backproject


def depth_to_mesh(
    depth: np.ndarray,
    rgb: np.ndarray,
    cal: dict,
    max_dim: int = 640,
    depth_jump_ratio: float = 0.12,
) -> trimesh.Trimesh:
    h, w = depth.shape
    scale = min(1.0, max_dim / max(h, w))
    nh = max(2, int(round(h * scale)))
    nw = max(2, int(round(w * scale)))
    d = cv2.resize(depth, (nw, nh), interpolation=cv2.INTER_AREA).astype(np.float32)
    c = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA)
    ys, xs = np.indices((nh, nw), dtype=np.float32)
    sx, sy = w / nw, h / nh
    scaled_cal = dict(cal)
    scaled_cal["fx"] = float(cal["fx"]) / sx
    scaled_cal["fy"] = float(cal["fy"]) / sy
    scaled_cal["cx"] = float(cal["cx"]) / sx
    scaled_cal["cy"] = float(cal["cy"]) / sy
    valid = np.isfinite(d) & (d > 0.05)
    z = np.where(valid, d, 0.0).astype(np.float32)
    flat = _backproject(xs.ravel(), ys.ravel(), z.ravel(), scaled_cal)
    scene_scale = float(cal.get("scale", 1.0))
    vertices = flat.astype(np.float32) * np.float32(scene_scale)
    grid = np.arange(nh * nw, dtype=np.int64).reshape(nh, nw)
    a, b, cidx, didx = grid[:-1, :-1].ravel(), grid[:-1, 1:].ravel(), grid[1:, :-1].ravel(), grid[1:, 1:].ravel()
    za, zb, zc, zd = z.ravel()[a], z.ravel()[b], z.ravel()[cidx], z.ravel()[didx]
    valid_quad = valid.ravel()[a] & valid.ravel()[b] & valid.ravel()[cidx] & valid.ravel()[didx]
    max_z = np.maximum.reduce([za, zb, zc, zd])
    min_z = np.minimum.reduce([za, zb, zc, zd])
    valid_quad &= (max_z - min_z) <= depth_jump_ratio * np.maximum(max_z, 1e-3)
    diag_ad = np.abs(za - zd) <= np.abs(zb - zc)
    f1a = np.column_stack((a, b, didx)); f1b = np.column_stack((a, didx, cidx))
    f2a = np.column_stack((a, b, cidx)); f2b = np.column_stack((b, didx, cidx))
    faces = np.concatenate((np.where(valid_quad[:, None], np.where(diag_ad[:, None], f1a, f2a), -1),
                            np.where(valid_quad[:, None], np.where(diag_ad[:, None], f1b, f2b), -1)), axis=0)
    faces = faces[faces[:, 0] >= 0]
    if not len(faces):
        return trimesh.Trimesh(vertices=np.empty((0, 3)), faces=np.empty((0, 3), dtype=np.int64), process=False)
    # Per-vertex UVs map directly back to the resized source image.
    uv = np.column_stack((xs.ravel() / max(nw - 1, 1), 1.0 - ys.ravel() / max(nh - 1, 1))).astype(np.float32)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces.astype(np.int64), process=False)
    # Remove vertices that are not referenced by any valid triangle; this keeps
    # exported GLB/OBJ files compact and avoids carrying invalid-depth vertices.
    mesh.remove_unreferenced_vertices()
    try:
        mesh.visual = trimesh.visual.texture.TextureVisuals(uv=uv, image=Image.fromarray(c))
    except Exception:
        mesh.vertex_colors = np.concatenate([c.reshape(-1, 3), np.full((nw * nh, 1), 255, dtype=np.uint8)], axis=1)
    return mesh


def export_glb(mesh: trimesh.Trimesh, path: Path) -> None:
    path.write_bytes(mesh.export(file_type="glb"))


def export_obj_mesh(mesh: trimesh.Trimesh, path: Path) -> None:
    path.write_text(mesh.export(file_type="obj"), encoding="utf-8")
