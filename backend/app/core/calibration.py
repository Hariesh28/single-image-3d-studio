from __future__ import annotations

import math
from typing import Any

import numpy as np

from .image import rational_to_float
from ..config import settings


def _clamp_principal_point(value: float | None, default: float, upper: float) -> float:
    if value is None or not math.isfinite(value):
        return default
    return float(np.clip(value, 0.0, upper))


def fov_to_focal(width: int, fov_deg: float) -> float:
    fov_deg = float(np.clip(fov_deg, 5.0, 175.0))
    return width / (2.0 * math.tan(math.radians(fov_deg) / 2.0))


def focal_to_fov(width: int, focal_px: float) -> float:
    return math.degrees(2.0 * math.atan(width / (2.0 * focal_px)))


def estimate_intrinsics(
    width: int,
    height: int,
    exif: dict[str, Any],
    calibration: Any | None = None,
) -> dict[str, Any]:
    cx_default, cy_default = width / 2.0, height / 2.0

    if calibration is not None:
        source = getattr(calibration, "source", "fov")
        scale = float(getattr(calibration, "scale", 1.0) or 1.0)
        if source == "manual":
            fx = float(getattr(calibration, "fx", 0) or 0)
            fy = float(getattr(calibration, "fy", 0) or 0)
            if fx <= 0 or fy <= 0:
                raise ValueError("Manual calibration requires positive fx and fy")
            cx = _clamp_principal_point(getattr(calibration, "cx", None), cx_default, width)
            cy = _clamp_principal_point(getattr(calibration, "cy", None), cy_default, height)
            return build_calibration(fx, fy, cx, cy, "manual", scale, distortion={"k1":float(getattr(calibration,"k1",0.0)),"k2":float(getattr(calibration,"k2",0.0)),"p1":float(getattr(calibration,"p1",0.0)),"p2":float(getattr(calibration,"p2",0.0)),"k3":float(getattr(calibration,"k3",0.0))})
        if source == "fov":
            fov = float(getattr(calibration, "fov_deg", settings.default_fov_deg) or settings.default_fov_deg)
            fx = fov_to_focal(width, fov)
            fy = fx
            cx = _clamp_principal_point(getattr(calibration, "cx", None), cx_default, width)
            cy = _clamp_principal_point(getattr(calibration, "cy", None), cy_default, height)
            return build_calibration(fx, fy, cx, cy, "fov", scale, fov, distortion={"k1":float(getattr(calibration,"k1",0.0)),"k2":float(getattr(calibration,"k2",0.0)),"p1":float(getattr(calibration,"p1",0.0)),"p2":float(getattr(calibration,"p2",0.0)),"k3":float(getattr(calibration,"k3",0.0))})

    # auto/default mode: use the strongest available metadata before falling back.
    f35 = rational_to_float(exif.get("FocalLengthIn35mmFilm"))
    if f35 and f35 > 0:
        # Full-frame equivalent focal length + 36 mm horizontal sensor assumption.
        fx = width * f35 / 36.0
        return build_calibration(fx, fx, cx_default, cy_default, "exif_35mm", 1.0)

    # If only physical focal length is present, sensor width is unknown, so it is not
    # safe to convert it directly to pixel focal length. Fall back to a documented FOV.
    return build_calibration(
        fov_to_focal(width, settings.default_fov_deg),
        fov_to_focal(width, settings.default_fov_deg),
        cx_default,
        cy_default,
        "default_fov",
        1.0,
        settings.default_fov_deg,
    )


def build_calibration(
    fx: float,
    fy: float,
    cx: float,
    cy: float,
    source: str,
    scale: float = 1.0,
    fov_deg: float | None = None,
    distortion: dict[str, float] | None = None,
) -> dict[str, Any]:
    fx = float(fx)
    fy = float(fy)
    cx = float(cx)
    cy = float(cy)
    scale = float(scale)
    if fov_deg is None:
        fov_x = focal_to_fov(2 * cx, fx)
        fov_y = math.degrees(2.0 * math.atan((2 * cy) / (2.0 * fy)))
    else:
        fov_x = float(fov_deg)
        fov_y = math.degrees(2.0 * math.atan((2 * cy) / (2.0 * fy)))
    return {
        "fx": fx,
        "fy": fy,
        "cx": cx,
        "cy": cy,
        "source": source,
        "scale": scale,
        "fov_deg": float(fov_x),
        "fov_x_deg": float(fov_x),
        "fov_y_deg": float(fov_y),
        "pixel_aspect_assumed": abs(fx - fy) < 1e-6,
        "distortion": distortion or {"k1":0.0,"k2":0.0,"p1":0.0,"p2":0.0,"k3":0.0},
    }


def camera_matrix(calibration: dict[str, Any]) -> np.ndarray:
    return np.array(
        [
            [calibration["fx"], 0.0, calibration["cx"]],
            [0.0, calibration["fy"], calibration["cy"]],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


def calibration_quality(source: str) -> dict[str, Any]:
    table = {
        "manual": (0.98, "high"),
        "exif_35mm": (0.85, "good"),
        "fov": (0.72, "medium"),
        "default_fov": (0.45, "low"),
    }
    score, label = table.get(source, (0.40, "low"))
    return {"score": score, "label": label}


def scale_calibration(calibration: dict[str, Any], scale: float) -> dict[str, Any]:
    out = dict(calibration)
    out["scale"] = float(scale)
    return out
