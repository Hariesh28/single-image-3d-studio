from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field, model_validator

SceneMode = Literal["auto", "indoor", "outdoor"]
QualityMode = Literal["fast", "balanced", "high", "maximum"]
CalibrationSource = Literal["auto", "manual", "fov"]

class CalibrationInput(BaseModel):
    source: CalibrationSource = "auto"
    fx: float | None = Field(default=None, gt=0)
    fy: float | None = Field(default=None, gt=0)
    cx: float | None = Field(default=None, ge=0)
    cy: float | None = Field(default=None, ge=0)
    fov_deg: float | None = Field(default=70.0, gt=5, lt=175)
    scale: float = Field(default=1.0, gt=0.0001, lt=1000)
    k1: float = 0.0
    k2: float = 0.0
    p1: float = 0.0
    p2: float = 0.0
    k3: float = 0.0

    @model_validator(mode="after")
    def validate_mode(self):
        if self.source == "manual" and (self.fx is None or self.fy is None):
            raise ValueError("Manual calibration requires fx and fy")
        if self.source == "fov" and self.fov_deg is None:
            raise ValueError("FOV calibration requires fov_deg")
        return self

class ProcessSettings(BaseModel):
    scene_mode: SceneMode = "auto"
    quality: QualityMode = "maximum"
    calibration: CalibrationInput | None = None
    generate_mesh: bool = True
    detect_planes: bool = True
    include_normals: bool = True
    max_points: int | None = Field(default=1_500_000, gt=10_000, le=10_000_000)

class ReferenceCalibrationRequest(BaseModel):
    x1: int = Field(ge=0); y1: int = Field(ge=0)
    x2: int = Field(ge=0); y2: int = Field(ge=0)
    known_distance_m: float = Field(gt=0)

class RegionRequest(BaseModel):
    polygon: list[tuple[int, int]] = Field(min_length=3)

class CrossSectionRequest(BaseModel):
    x1: int = Field(ge=0); y1: int = Field(ge=0)
    x2: int = Field(ge=0); y2: int = Field(ge=0)
    samples: int = Field(default=512, ge=16, le=2048)

class MeasurementRequest(BaseModel):
    a: tuple[float, float, float]
    b: tuple[float, float, float]
    c: tuple[float, float, float] | None = None

class EvaluationRequest(BaseModel):
    predicted_distance_m: float = Field(gt=0)
    known_distance_m: float = Field(gt=0)

class ReprojectionRequest(BaseModel):
    x: float; y: float; z: float

class Annotation(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    point: dict
    color: str = "#67e8f9"
    note: str = ""

class AnnotationsPayload(BaseModel):
    items: list[Annotation] = Field(default_factory=list, max_length=1000)

class SegmentationRequest(BaseModel):
    score_threshold: float = Field(default=0.65, ge=0.05, le=0.99)
    max_objects: int = Field(default=12, ge=1, le=30)

class SceneState(BaseModel):
    mode: str = "split"
    tool: str = "inspect"
    region_shape: str = "polygon"
    density: int = Field(default=0, ge=0, le=3)
    point_size: float = Field(default=2.2, ge=0.5, le=12)
    point_budget: int = Field(default=2_000_000, ge=100_000, le=10_000_000)
    color_mode: str = "rgb"
    rgb: bool = True
    point_opacity: float = Field(default=0.96, ge=0.1, le=1)
    near_depth: float = Field(default=0.05, ge=0.01)
    far_depth: float = Field(default=80.0, gt=0.01)
    background: str = "#050b13"
    show_grid: bool = True
    show_axes: bool = True
    show_frustum: bool = False
    show_planes: bool = False
    show_ground: bool = False
    show_mesh: bool = False
    show_camera: bool = True
    show_contours: bool = False
    show_labels: bool = True
    adaptive_lod: bool = True
    min_x: float | None = None
    max_x: float | None = None
    min_y: float | None = None
    max_y: float | None = None
    min_z: float | None = None
    max_z: float | None = None
    depth_colormap: str = "turbo"
    depth_display: str = "metric"
    parallax_strength: float = Field(default=0.65, ge=0, le=2)
    parallax_yaw: float = Field(default=0, ge=-360, le=360)
    parallax_pitch: float = Field(default=0, ge=-360, le=360)
    camera_view: str = "home"
    selected_object_id: int | None = None
