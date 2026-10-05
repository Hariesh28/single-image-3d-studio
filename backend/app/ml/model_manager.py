from __future__ import annotations

import gc
import logging
import sys
import threading
import time
from pathlib import Path

import numpy as np
import torch

from ..config import settings
from .bootstrap import MODEL_SPECS, ensure_model, ensure_source, model_status

log = logging.getLogger(__name__)


class ModelManager:
    """Owns the single resident ViT-L model used by the GPU worker.

    Keeping at most one large model on an 8 GB GPU materially reduces the chance of
    model-switch OOMs. The backend serializes GPU inference through JobManager.
    """

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.model = None
        self.loaded_scene_type: str | None = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.last_inference_seconds: float | None = None
        self.last_input_size: int | None = None
        self.last_fallback_size: int | None = None
        if self.device.type == "cuda":
            try:
                torch.set_float32_matmul_precision("high")
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True
            except Exception:
                pass

    @staticmethod
    def _configs() -> dict:
        return {
            "encoder": "vitl",
            "features": 256,
            "out_channels": [256, 512, 1024, 1024],
        }

    def _import_model_class(self):
        metric_dir = ensure_source()
        if str(metric_dir) not in sys.path:
            sys.path.insert(0, str(metric_dir))
        from depth_anything_v2.dpt import DepthAnythingV2
        return DepthAnythingV2

    def release_gpu(self) -> None:
        """Explicitly release the resident ViT-L model before another GPU model runs."""
        with self.lock:
            self._unload()

    def _unload(self) -> None:
        if self.model is not None:
            try:
                self.model.cpu()
            except Exception:
                pass
        self.model = None
        self.loaded_scene_type = None
        gc.collect()
        if self.device.type == "cuda":
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()

    def _load(self, scene_type: str) -> None:
        if self.loaded_scene_type == scene_type and self.model is not None:
            return
        self._unload()
        checkpoint = ensure_model(scene_type)
        model_class = self._import_model_class()
        config = {**self._configs(), "max_depth": MODEL_SPECS[scene_type]["max_depth"]}
        model = model_class(**config)
        try:
            state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        except TypeError:
            state = torch.load(checkpoint, map_location="cpu")
        model.load_state_dict(state, strict=True)
        model.eval()
        model.to(self.device)
        self.model = model
        self.loaded_scene_type = scene_type
        log.info("Loaded %s metric V2 Large on %s", scene_type, self.device)

    def infer(self, bgr: np.ndarray, scene_type: str, input_size: int) -> tuple[np.ndarray, int]:
        with self.lock:
            self._load(scene_type)
            sizes = [int(input_size), 644, 560, 518, 448, 392]
            sizes = list(dict.fromkeys(s for s in sizes if s > 0 and s <= input_size)) + [392]
            sizes = list(dict.fromkeys(sizes))
            last_error: Exception | None = None
            for size in sizes:
                try:
                    start = time.perf_counter()
                    if self.device.type == "cuda":
                        with torch.inference_mode(), torch.autocast(device_type="cuda", dtype=torch.float16):
                            depth = self.model.infer_image(bgr, input_size=size)
                    else:
                        with torch.inference_mode():
                            depth = self.model.infer_image(bgr, input_size=size)
                    elapsed = time.perf_counter() - start
                    self.last_inference_seconds = elapsed
                    self.last_input_size = size
                    self.last_fallback_size = size if size != input_size else None
                    depth = np.asarray(depth, dtype=np.float32)
                    depth = np.nan_to_num(depth, nan=0.0, posinf=0.0, neginf=0.0)
                    if self.device.type == "cuda":
                        torch.cuda.empty_cache()
                    return depth, size
                except torch.cuda.OutOfMemoryError as exc:
                    last_error = exc
                    if self.device.type == "cuda":
                        torch.cuda.empty_cache()
                        gc.collect()
                    log.warning("CUDA OOM at input_size=%s; retrying lower resolution", size)
            raise RuntimeError("GPU memory was insufficient even at the fallback inference resolution") from last_error

    def system_info(self) -> dict:
        gpu_memory = None
        if self.device.type == "cuda":
            try:
                free, total = torch.cuda.mem_get_info()
                gpu_memory = {
                    "free_bytes": int(free),
                    "total_bytes": int(total),
                    "allocated_bytes": int(torch.cuda.memory_allocated()),
                    "reserved_bytes": int(torch.cuda.memory_reserved()),
                }
            except Exception:
                gpu_memory = None
        return {
            "device": str(self.device),
            "cuda": bool(torch.cuda.is_available()),
            "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "cuda_version": torch.version.cuda,
            "torch_version": torch.__version__,
            "loaded_model": self.loaded_scene_type,
            "last_input_size": self.last_input_size,
            "last_inference_seconds": self.last_inference_seconds,
            "gpu_memory": gpu_memory,
            "models": model_status(),
        }
