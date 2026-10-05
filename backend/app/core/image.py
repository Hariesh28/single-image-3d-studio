from __future__ import annotations

from io import BytesIO
from typing import Any

import numpy as np
from PIL import ExifTags, Image, ImageOps


SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}


def open_image(data: bytes) -> Image.Image:
    with Image.open(BytesIO(data)) as image:
        image.verify()
    image = Image.open(BytesIO(data))
    image = ImageOps.exif_transpose(image)
    return image.convert("RGB")


def extract_exif(data_or_image: bytes | Image.Image) -> dict[str, Any]:
    if isinstance(data_or_image, bytes):
        image = Image.open(BytesIO(data_or_image))
    else:
        image = data_or_image
    exif = image.getexif()
    tags = {ExifTags.TAGS.get(key, key): value for key, value in exif.items()}
    wanted = (
        "Make",
        "Model",
        "LensModel",
        "FocalLength",
        "FocalLengthIn35mmFilm",
        "ExifImageWidth",
        "ExifImageHeight",
        "ImageWidth",
        "ImageLength",
        "DigitalZoomRatio",
        "Orientation",
        "ExposureTime",
        "ISOSpeedRatings",
        "DateTimeOriginal",
    )
    return {key: tags[key] for key in wanted if key in tags}


def rational_to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if hasattr(value, "numerator") and hasattr(value, "denominator"):
            denominator = float(value.denominator)
            if denominator == 0:
                return None
            return float(value.numerator) / denominator
        if isinstance(value, tuple) and len(value) == 2:
            numerator, denominator = value
            if float(denominator) == 0:
                return None
            return float(numerator) / float(denominator)
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def resize_to_max_pixels(image: Image.Image, max_pixels: int) -> tuple[Image.Image, float]:
    width, height = image.size
    pixels = width * height
    if pixels <= max_pixels:
        return image, 1.0
    scale = (max_pixels / pixels) ** 0.5
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))
    resized = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
    return resized, scale


def pil_to_rgb(image: Image.Image) -> np.ndarray:
    return np.asarray(image, dtype=np.uint8).copy()


def pil_to_bgr(image: Image.Image) -> np.ndarray:
    rgb = pil_to_rgb(image)
    return rgb[..., ::-1].copy()
