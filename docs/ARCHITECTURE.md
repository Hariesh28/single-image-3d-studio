# Architecture

## Backend

```text
FastAPI
  │
  ├── upload validation
  ├── scene/job API
  ├── SSE progress
  └── artifact API
         │
         ▼
  GPU JobManager (1 worker)
         │
         ▼
  Processing Pipeline
         │
         ├── Image normalization + EXIF
         ├── Scene routing
         ├── ModelManager
         ├── Depth sanitization
         ├── CalibrationEngine
         ├── PointCloudBuilder
         ├── PlaneDetector
         └── MeshBuilder
```

## Frontend

```text
React
  │
  ├── Zustand scene state
  ├── Image / Depth panels
  ├── Controls / Inspector
  └── React Three Fiber
          │
          ├── BufferGeometry
          ├── GLSL point shader
          ├── picking
          ├── measurements
          └── scene overlays
```

## Why modular monolith

This project is local and single-user first. A modular monolith avoids unnecessary microservice complexity while keeping the boundaries required to replace the depth model, storage layer or renderer later.
