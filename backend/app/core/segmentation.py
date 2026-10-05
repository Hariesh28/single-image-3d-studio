from __future__ import annotations

import gc
import threading
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image
from torchvision.models.detection import MaskRCNN_ResNet50_FPN_V2_Weights, maskrcnn_resnet50_fpn_v2

from ..config import settings
from ..ml.bootstrap import ensure_segmentation_model

from .analysis import region_stats


class InstanceSegmentationEngine:
    """On-demand COCO instance segmentation using TorchVision Mask R-CNN.

    The model is intentionally lazy-loaded because depth reconstruction should not
    pay the memory/time cost of object segmentation unless the user asks for it.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._model = None
        self._weights = None
        self._checkpoint: Path | None = None
        self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def _load(self):
        with self._lock:
            if self._model is not None:
                return self._model, self._weights
            weights = MaskRCNN_ResNet50_FPN_V2_Weights.DEFAULT
            checkpoint = settings.models_dir / "maskrcnn_resnet50_fpn_v2_coco-73cbd019.pth"
            if not checkpoint.exists():
                try:
                    checkpoint = ensure_segmentation_model()
                except Exception:
                    checkpoint = checkpoint
            if checkpoint.exists():
                model = maskrcnn_resnet50_fpn_v2(weights=None)
                state = torch.load(checkpoint, map_location="cpu", weights_only=True)
                model.load_state_dict(state, strict=True)
            else:
                model = maskrcnn_resnet50_fpn_v2(weights=weights)
            model.eval().to(self._device)
            self._model = model
            self._weights = weights
            self._checkpoint = checkpoint if checkpoint.exists() else None
            return model, weights

    def release_gpu(self) -> None:
        """Release the segmentation model from GPU memory after on-demand use."""
        with self._lock:
            if self._model is not None and self._device.type == "cuda":
                try:
                    self._model.cpu()
                except Exception:
                    pass
            self._model = None
            gc.collect()
            if self._device.type == "cuda":
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()

    def predict(self, rgb: np.ndarray, score_threshold: float = 0.65, max_objects: int = 12) -> list[dict[str, Any]]:
        # Serialize segmentation inference.
        with self._lock:
            model, weights = self._load()
            h, w = rgb.shape[:2]
            max_side = 1024
            scale = min(1.0, max_side / max(h, w))
            image = Image.fromarray(rgb)
            if scale < 1.0:
                image = image.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.Resampling.BILINEAR)
            tensor = weights.transforms()(image).to(self._device)
            try:
                with torch.inference_mode():
                    prediction = model([tensor])[0]
            except torch.cuda.OutOfMemoryError:
                if self._device.type == "cuda":
                    torch.cuda.empty_cache()
                    gc.collect()
                    self._model = None
                    torch.cuda.empty_cache()
                if self._checkpoint and self._checkpoint.exists():
                    cpu_model = maskrcnn_resnet50_fpn_v2(weights=None).eval().cpu()
                    state = torch.load(self._checkpoint, map_location="cpu", weights_only=True)
                    cpu_model.load_state_dict(state, strict=True)
                else:
                    cpu_model = maskrcnn_resnet50_fpn_v2(weights=self._weights or MaskRCNN_ResNet50_FPN_V2_Weights.DEFAULT).eval().cpu()
                cpu_tensor = tensor.cpu()
                with torch.inference_mode():
                    prediction = cpu_model([cpu_tensor])[0]
                del cpu_model
                gc.collect()

            scores = prediction["scores"].detach().cpu().numpy()
            labels = prediction["labels"].detach().cpu().numpy()
            masks = prediction["masks"].detach().cpu().numpy()[:, 0]
            categories = weights.meta["categories"]
            results: list[dict[str, Any]] = []
            for i in range(min(len(scores), max_objects)):
                score = float(scores[i])
                if score < score_threshold:
                    continue
                low_mask = masks[i] >= 0.5
                if scale < 1.0:
                    full = np.asarray(Image.fromarray((low_mask.astype(np.uint8) * 255)).resize((w, h), Image.Resampling.NEAREST), dtype=np.uint8) > 0
                else:
                    full = low_mask
                ys, xs = np.where(full)
                if not len(xs):
                    continue
                results.append({
                    "id": len(results),
                    "label": categories[int(labels[i])] if int(labels[i]) < len(categories) else str(int(labels[i])),
                    "score": score,
                    "bbox_px": {"x0": int(xs.min()), "y0": int(ys.min()), "x1": int(xs.max()), "y1": int(ys.max())},
                    "mask": full,
                })
            return results


ENGINE = InstanceSegmentationEngine()


def encode_mask_png(mask: np.ndarray, path: Path) -> None:
    from PIL import Image
    Image.fromarray((np.asarray(mask, dtype=np.uint8) * 255)).save(path, format="PNG", optimize=True)


def enrich_objects(objects: list[dict[str, Any]], depth: np.ndarray, rgb: np.ndarray, calibration: dict, max_depth: float) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for obj in objects:
        item = {k: v for k, v in obj.items() if k != "mask"}
        item.update(region_stats(obj["mask"], depth, rgb, calibration, max_depth))
        output.append(item)
    return output
