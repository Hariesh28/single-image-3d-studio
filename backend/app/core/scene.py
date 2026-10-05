from __future__ import annotations

import cv2
import numpy as np


def classify_scene(rgb: np.ndarray) -> tuple[str, float, dict]:
    """Lightweight, explainable scene classifier used only for model routing.

    It intentionally reports uncertainty. It is not a semantic classifier and the
    final UI allows the user to override the automatic choice.
    """
    h, w = rgb.shape[:2]
    small = cv2.resize(rgb, (min(640, w), min(640, h)), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]
    hsv = cv2.cvtColor(small, cv2.COLOR_RGB2HSV)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)

    upper = hsv[: max(1, sh // 3)]
    blue_sky = (
        (upper[..., 0] >= 85)
        & (upper[..., 0] <= 135)
        & (upper[..., 1] >= 70)
        & (upper[..., 2] >= 100)
    ).mean()

    lower_brightness = gray[int(sh * 0.55) :].mean() / 255.0
    global_saturation = hsv[..., 1].mean() / 255.0
    texture = float(cv2.Laplacian(gray, cv2.CV_32F).var())
    texture_norm = float(np.clip(np.log1p(texture) / 10.0, 0.0, 1.0))

    edge_density = float((cv2.Canny(gray, 80, 160) > 0).mean())
    perspective_score = float(np.clip(edge_density * 2.8, 0.0, 1.0))

    outdoor_score = float(
        np.clip(
            0.50 * blue_sky
            + 0.18 * lower_brightness
            + 0.17 * texture_norm
            + 0.15 * perspective_score,
            0.0,
            1.0,
        )
    )
    # Bias away from declaring outdoor when sky evidence is weak.
    if blue_sky < 0.01:
        outdoor_score *= 0.75
    indoor_score = 1.0 - outdoor_score

    if outdoor_score >= 0.60:
        label = "outdoor"
        confidence = outdoor_score
    elif outdoor_score <= 0.40:
        label = "indoor"
        confidence = indoor_score
    else:
        label = "uncertain"
        confidence = abs(outdoor_score - 0.5) * 2.0

    return label, float(np.clip(confidence, 0.0, 1.0)), {
        "outdoor_score": outdoor_score,
        "indoor_score": indoor_score,
        "sky_blue_ratio": float(blue_sky),
        "texture_score": texture,
        "edge_density": edge_density,
        "global_saturation": float(global_saturation),
    }
