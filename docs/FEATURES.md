# Single Image 3D Studio 5.1 — Feature Matrix

This document maps the product features to their implementation areas.

## Reconstruction

- Metric depth: `backend/app/ml/model_manager.py`
- Model bootstrap/provenance: `backend/app/ml/bootstrap.py`
- Image/EXIF normalization: `backend/app/core/image.py`
- Indoor/outdoor routing: `backend/app/core/scene.py`
- Depth sanitation/quality: `backend/app/core/depth_processing.py`, `backend/app/core/analysis.py`
- Calibrated XYZ: `backend/app/core/calibration.py`, `backend/app/core/geometry.py`

## Geometry

- Dense/important-sample point cloud: `geometry.py`
- Multiple LOD artifacts: `processing.py`
- Normals: `geometry.py`
- Planes: `planes.py`
- Ground alignment: `planes.py` + `PointCloud.tsx`
- Edge-aware mesh: `mesh.py`
- Textured GLB/OBJ: `mesh.py`

## Analysis tools

- Pixel inspector
- 3D picking
- Bidirectional pixel ↔ point correspondence
- A/B/C measurements
- Angle measurement
- Polygon ROI
- Rectangle ROI
- Freehand lasso ROI
- ROI 3D bounds/centroid/area/volume estimates
- Depth histogram
- Cross-section profile
- Reprojection check
- Known-distance evaluation
- On-demand COCO instance segmentation
- Object depth and 3D dimensions
- Selected-object semantic coloring

## Viewer

- Image/depth/3D/split/compare/parallax modes
- Orbit/pan/zoom
- Preset camera views
- Camera frustum
- Ground frame
- Plane overlays
- Mesh overlay
- GPU point budgets
- Adaptive LOD
- FPS-aware GPU point budget
- Point-size/opacity controls
- RGB/depth/height/normal/object color modes
- XYZ clipping

## Project/data

- Scene cache
- Scene workspace
- Save/open `.s3d`
- UI-state persistence
- Snapshot / undo / redo
- Per-scene annotations
- Individual artifact downloads
- PLY / OBJ / GLB / NPY / CSV / PNG
- Reproducibility metadata including model source commit and checkpoint digest

## Local/offline behavior

The application is local-first. After the initial bootstrap has downloaded the pinned Depth Anything V2 checkpoints, source tree, and optional TorchVision segmentation checkpoint, reconstruction and analysis can run without sending image data to external services.

## Reliability hardening

- Typed server-side measurement engine with degenerate-angle handling
- Validated annotation payloads
- Pointer-capture-safe image navigation and freehand ROI drawing
- Graceful WebGL fallback/error boundary
- GPU-memory-aware model switching and segmentation CPU fallback


## 5.1 interaction architecture

The viewer separates the right side into dedicated workspaces: Controls, Inspect, Measure, Annotate, Region, Profile, Analytics, and Project. Measure has explicit A/B/C slots, real-time 3D distance and angle calculation, backend verification, known-distance validation, and persistent history. Annotation management, region-shape/result details, and depth-profile charts are available in their respective tool workspaces. Image/Depth/3D selection remains linked through the scene pixel identity.

Depth exaggeration is display-only: metric coordinates, stored depth, measurements, and exported numeric geometry remain based on the original metric depth. Overlays that depend on depth (planes, frustum, mesh) use the same visual transform so they remain aligned during visualization.
