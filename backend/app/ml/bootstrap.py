from __future__ import annotations

import hashlib
import io
import logging
import shutil
import zipfile
from pathlib import Path

import torch
from urllib.request import Request, urlopen

from ..config import settings

log = logging.getLogger(__name__)

MODEL_SPECS = {
    "indoor": {
        "repo_id": "depth-anything/Depth-Anything-V2-Metric-Hypersim-Large",
        "filename": "depth_anything_v2_metric_hypersim_vitl.pth",
        "max_depth": 20.0,
        "dataset": "Hypersim",
    },
    "outdoor": {
        "repo_id": "depth-anything/Depth-Anything-V2-Metric-VKITTI-Large",
        "filename": "depth_anything_v2_metric_vkitti_vitl.pth",
        "max_depth": 80.0,
        "dataset": "Virtual KITTI 2",
    },
}


def ensure_source() -> Path:
    metric_dir = settings.vendor_dir / "Depth-Anything-V2" / "metric_depth"
    marker = settings.vendor_dir / "Depth-Anything-V2" / ".source_commit"
    if metric_dir.exists() and marker.exists() and marker.read_text(encoding="utf-8").strip() == settings.da_commit:
        return metric_dir

    settings.vendor_dir.mkdir(parents=True, exist_ok=True)
    archive_url = f"https://github.com/{settings.da_repo}/archive/{settings.da_commit}.zip"
    log.info("Downloading pinned Depth Anything V2 source: %s", archive_url)
    request = Request(archive_url, headers={"User-Agent": "single-image-3d-studio/2.0"})
    with urlopen(request, timeout=120) as response:
        payload = response.read()

    tmp_root = settings.vendor_dir / ".da_source_tmp"
    if tmp_root.exists():
        shutil.rmtree(tmp_root)
    tmp_root.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        archive.extractall(tmp_root)

    extracted = next(tmp_root.glob("Depth-Anything-V2-*"), None)
    if extracted is None:
        raise RuntimeError("Depth Anything V2 source archive had an unexpected layout")
    source_metric = extracted / "metric_depth"
    if not source_metric.exists():
        raise RuntimeError("Pinned Depth Anything V2 source does not contain metric_depth")

    target = settings.vendor_dir / "Depth-Anything-V2"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    shutil.copytree(source_metric, target / "metric_depth")
    for notice_name in ("LICENSE", "NOTICE", "README.md"):
        notice = extracted / notice_name
        if notice.exists():
            shutil.copy2(notice, target / notice_name)
    (target / ".source_commit").write_text(settings.da_commit, encoding="utf-8")
    shutil.rmtree(tmp_root, ignore_errors=True)
    return target / "metric_depth"


def ensure_model(scene_type: str) -> Path:
    if scene_type not in MODEL_SPECS:
        raise ValueError(f"Unsupported scene type: {scene_type}")
    spec = MODEL_SPECS[scene_type]
    path = settings.models_dir / spec["filename"]
    if path.exists() and path.stat().st_size >= settings.model_download_min_bytes:
        return path

    from huggingface_hub import hf_hub_download

    log.info("Downloading official Depth Anything V2 metric %s Large checkpoint", scene_type)
    kwargs = {
        "repo_id": spec["repo_id"],
        "filename": spec["filename"],
        "local_dir": str(settings.models_dir),
    }
    if settings.hf_token:
        kwargs["token"] = settings.hf_token
    downloaded = Path(hf_hub_download(**kwargs))
    if downloaded != path and downloaded.exists():
        shutil.copy2(downloaded, path)

    if not path.exists() or path.stat().st_size < settings.model_download_min_bytes:
        raise RuntimeError(f"Downloaded checkpoint for {scene_type} is missing or unexpectedly small")

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    (path.with_suffix(path.suffix + ".sha256")).write_text(digest.hexdigest(), encoding="utf-8")
    return path


SEGMENTATION_FILENAME = "maskrcnn_resnet50_fpn_v2_coco-73cbd019.pth"

def ensure_segmentation_model() -> Path:
    """Ensure the TorchVision COCO Mask R-CNN weights exist under project models/."""
    target = settings.models_dir / SEGMENTATION_FILENAME
    if target.exists() and target.stat().st_size > 100_000_000:
        return target
    from torchvision.models.detection import MaskRCNN_ResNet50_FPN_V2_Weights, maskrcnn_resnet50_fpn_v2
    weights = MaskRCNN_ResNet50_FPN_V2_Weights.DEFAULT
    cache_file = Path(torch.hub.get_dir()) / "checkpoints" / weights.url.rsplit("/", 1)[-1]
    target.parent.mkdir(parents=True, exist_ok=True)
    if not cache_file.exists():
        # TorchVision downloads from its official model host.
        model = maskrcnn_resnet50_fpn_v2(weights=weights)
        del model
    if not cache_file.exists():
        raise RuntimeError("TorchVision Mask R-CNN checkpoint download did not produce a local file")
    shutil.copy2(cache_file, target)
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    (target.with_suffix(target.suffix + ".sha256")).write_text(digest.hexdigest(), encoding="utf-8")
    return target

def model_status() -> dict[str, dict]:
    result: dict[str, dict] = {}
    for key, spec in MODEL_SPECS.items():
        path = settings.models_dir / spec["filename"]
        result[key] = {
            "repo_id": spec["repo_id"],
            "filename": spec["filename"],
            "dataset": spec["dataset"],
            "max_depth_m": spec["max_depth"],
            "present": path.exists(),
            "size_bytes": path.stat().st_size if path.exists() else 0,
        }
    seg = settings.models_dir / SEGMENTATION_FILENAME
    result["segmentation"] = {
        "repo_id": "pytorch/torchvision",
        "filename": SEGMENTATION_FILENAME,
        "dataset": "COCO",
        "present": seg.exists(),
        "size_bytes": seg.stat().st_size if seg.exists() else 0,
    }
    return result
