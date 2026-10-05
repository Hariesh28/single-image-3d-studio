from __future__ import annotations
from typing import Any
from pydantic import BaseModel

class SceneStatus(BaseModel):
    scene_id: str
    status: str
    progress: int
    stage: str
    message: str
    error: str | None = None
    started_at: float | None = None
    finished_at: float | None = None

class SceneSummary(BaseModel):
    scene_id: str
    width: int
    height: int
    scene_type: str
    model: str
    created_at: float
    point_count: int
    calibration_source: str

class SceneMetadata(BaseModel):
    scene_id: str
    width: int
    height: int
    original_width: int
    original_height: int
    model: str
    model_dataset: str
    model_source_commit: str
    scene_type: str
    scene_confidence: float
    scene_selection_source: str
    max_depth_m: float
    depth_min_m: float
    depth_max_m: float
    depth_percentiles: dict[str, float]
    point_counts: list[int]
    calibration: dict[str, Any]
    quality: dict[str, Any]
    planes: list[dict[str, Any]]
    ground_plane: dict[str, Any] | None
    ground_transform: dict[str, Any] | None
    artifacts: dict[str, str | None]
    settings: dict[str, Any]
    analysis: dict[str, Any]
    segmentation: dict[str, Any]
    created_at: float
