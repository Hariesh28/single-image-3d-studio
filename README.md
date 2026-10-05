# Single Image 3D Studio 5.0

A local-first, production-oriented **single-image metric 3D analysis studio** built around **Depth Anything V2 Metric Large**, **FastAPI**, **PyTorch**, **React**, and **Three.js/WebGL**.

## What the application does

```text
Single RGB image
      ↓
Image + EXIF normalization
      ↓
Indoor / outdoor scene routing
      ↓
Depth Anything V2 Metric Large
      ↓
Metric depth map
      ↓
Camera calibration + distortion model
      ↓
Metric XYZ back-projection
      ↓
Point cloud + normals + LODs
      ↓
Planes + ground + mesh + segmentation
      ↓
Synchronized 2D / depth / 3D analysis studio
```

## Major capabilities

### AI and depth

- Official Depth Anything V2 Metric Large source pinned to commit `a561b849ebae10a6f5ef49e26c83cbbcd36c71bf`.
- Indoor Hypersim and outdoor Virtual KITTI 2 metric Large checkpoints.
- Automatic scene routing with manual indoor/outdoor override.
- CUDA inference, mixed precision and GPU-memory-aware resolution fallback.
- One resident ViT-L model at a time for 8 GB-class GPUs.
- Optional offline-ready TorchVision Mask R-CNN object model.
- Raw and processed depth retained separately.

### Camera and metric geometry

- EXIF 35mm-equivalent focal length support.
- FOV calibration.
- Manual `fx`, `fy`, `cx`, `cy` calibration.
- OpenCV radial/tangential distortion coefficients.
- Reference-distance global scale calibration.
- Camera-relative metric frame: X right, Y up, Z forward.
- Reprojection diagnostics.

The base pinhole model is:

```text
Z = depth(u,v)
X = (u-cx) * Z / fx
Y = -(v-cy) * Z / fy
```

When distortion coefficients are supplied, OpenCV undistortion is applied before back-projection.

### Interactive viewer

- IMAGE / DEPTH / 3D / SPLIT / COMPARE / PARALLAX modes.
- Orbit, pan, zoom and preset camera views.
- GPU point rendering with typed arrays and GLSL shaders.
- Point density, point size, opacity and GPU budget controls.
- Adaptive LOD driven by observed FPS.
- RGB / depth / height / normal / selected-object coloring.
- X/Y/Z/depth clipping.
- Grid, axes, camera marker and frustum.
- Plane overlays and ground alignment.
- Optional edge-aware textured mesh.
- Selected point labels and camera-to-point context.
- 3D comparison of two saved scenes.
- Depth-based virtual camera/parallax mode.

### Synchronized inspection

- Hover an image/depth pixel for live pixel, depth and XYZ information.
- Click an image/depth pixel to select its metric 3D point.
- Click a 3D point to recover its source pixel.
- Nearby-valid-depth snapping for invalid samples.
- Copy XYZ JSON.
- Named annotations.
- Selected-object 3D highlighting.

### Measurements and analysis

- A-B 3D Euclidean distance.
- Horizontal distance.
- Vertical difference.
- Depth difference.
- A-B-C angle at B.
- Polygon ROI statistics.
- Approximate 3D surface area.
- Approximate bounding-box volume.
- Object depth and dimensions.
- Depth histogram and interactive depth-range selection.
- Depth cross-section/profile with cumulative 3D path length.
- Reprojection check.
- Ground-truth known-distance evaluation.

### Scene understanding

- RANSAC dominant planes.
- Ground-plane candidate selection.
- On-demand COCO instance segmentation.
- Object mask overlay.
- Object 3D dimensions/centroid/bounds.
- Selected-object semantic point-cloud mode.

### Project management

- Persistent local scenes.
- Save/reopen `.s3d` reconstruction packages.
- UI-state persistence.
- Snapshot / undo / redo.
- Scene-to-scene comparison.
- Reproducibility metadata.
- Model/checkpoint/source revision tracking.
- Local scene cache.

### Export

- Metric depth PNG variants.
- NPY depth.
- Raw `depth.f32`.
- PLY point cloud.
- OBJ point cloud.
- OBJ mesh.
- GLB textured mesh.
- CSV point samples (bounded export).
- JSON scene metadata.
- Complete `.s3d` ZIP package.

## Windows 11 + RTX 4060 setup

Recommended:

- Windows 11
- RTX 4060 Laptop GPU (~8 GB VRAM)
- 16 GB RAM
- Python 3.11
- Node.js 22+
- NVIDIA driver with CUDA support

### Install

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

### Start everything

```powershell
.\start.ps1
```

The launcher starts the backend and Vite in separate PowerShell windows, waits for the health endpoints, and then opens the application.

Frontend:

```text
http://localhost:5173
```

Backend:

```text
http://127.0.0.1:8000
```

API docs:

```text
http://127.0.0.1:8000/docs
```

### Run individually

```powershell
.\run-backend.ps1
```

```powershell
.\run-frontend.ps1
```

### Bootstrap all models before going offline

```powershell
.\bootstrap-models.ps1
```

This prepares the Depth Anything V2 source/checkpoints and the optional COCO instance-segmentation checkpoint.

### Docker

```powershell
docker compose up --build
```

## Accuracy and coordinate semantics

The system reports **metric estimates**, not guaranteed survey-grade ground truth. Metric depth provides an estimated Z value; X and Y additionally depend on camera intrinsics. Reference-distance calibration corrects global scale but does not replace intrinsic calibration or eliminate local depth-model errors.

Calibration quality is surfaced as `high`, `good`, `medium`, or `low` based on the calibration source.

## Important model provenance

The application downloads the official Depth Anything V2 metric implementation and the official metric Large checkpoints. The exact source revision is pinned and recorded in each scene's metadata.

See:

- `docs/ARCHITECTURE.md`
- `docs/CALIBRATION.md`
- `docs/MODELS_AND_LICENSES.md`
- `docs/FEATURES.md`
- `docs/TESTING.md`

## Development validation

Backend:

```powershell
.\.venv\Scripts\python.exe -m compileall backend scripts
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend:

```powershell
cd frontend
npm install
npm run build
npm run test
```

The repository is designed for local execution. A full browser production build requires the frontend npm dependencies to be installed in the target environment.
