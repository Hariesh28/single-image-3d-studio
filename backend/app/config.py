from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def _int(name: str, default: int) -> int:
    try: return int(os.getenv(name, default))
    except (TypeError, ValueError): return default

def _float(name: str, default: float) -> float:
    try: return float(os.getenv(name, default))
    except (TypeError, ValueError): return default

@dataclass(frozen=True)
class Settings:
    app_name: str = "Single Image 3D Studio"
    version: str = "5.0.0"
    api_prefix: str = "/api"
    host: str = os.getenv("S3D_HOST", "127.0.0.1")
    port: int = _int("S3D_PORT", 8000)
    data_dir: Path = Path(os.getenv("S3D_DATA_DIR", ROOT / "data"))
    models_dir: Path = Path(os.getenv("S3D_MODELS_DIR", ROOT / "models"))
    vendor_dir: Path = Path(os.getenv("S3D_VENDOR_DIR", ROOT / "vendor"))
    max_upload_mb: int = _int("S3D_MAX_UPLOAD_MB", 40)
    max_pixels: int = _int("S3D_MAX_PIXELS", 12_000_000)
    max_points: int = _int("S3D_MAX_POINTS", 2_000_000)
    default_max_points: int = _int("S3D_DEFAULT_MAX_POINTS", 1_500_000)
    max_mesh_dimension: int = _int("S3D_MAX_MESH_DIM", 640)
    max_planes_points: int = _int("S3D_MAX_PLANE_POINTS", 80_000)
    max_segmentation_objects: int = _int("S3D_MAX_SEGMENTATION_OBJECTS", 12)
    segmentation_min_score: float = _float("S3D_SEGMENTATION_MIN_SCORE", 0.65)
    max_region_pixels: int = _int("S3D_MAX_REGION_PIXELS", 4_000_000)
    cors_origin: str = os.getenv("S3D_CORS_ORIGIN", "http://localhost:5173")
    allow_lan: bool = os.getenv("S3D_ALLOW_LAN", "0") == "1"
    default_fov_deg: float = _float("S3D_DEFAULT_FOV", 70.0)
    da_repo: str = "DepthAnything/Depth-Anything-V2"
    da_commit: str = "a561b849ebae10a6f5ef49e26c83cbbcd36c71bf"
    model_download_min_bytes: int = _int("S3D_MODEL_MIN_BYTES", 500_000_000)
    hf_token: str | None = os.getenv("HF_TOKEN") or None

    @property
    def scene_dir(self) -> Path: return self.data_dir / "scenes"
    @property
    def cache_dir(self) -> Path: return self.data_dir / "cache"
    @property
    def logs_dir(self) -> Path: return self.data_dir / "logs"

settings = Settings()
for p in (settings.data_dir, settings.models_dir, settings.vendor_dir, settings.scene_dir, settings.cache_dir, settings.logs_dir):
    p.mkdir(parents=True, exist_ok=True)
