# Testing and validation

## Backend checks

Run from repository root:

```powershell
.\.venv\Scripts\python.exe -m compileall backend scripts
.\.venv\Scripts\python.exe -m pytest -q
```

The repository unit tests cover:

- FOV/focal-length conversion
- manual calibration precedence
- distortion parameter preservation
- center-pixel back-projection
- point-cloud metadata/normals
- distorted pixel → XYZ → pixel round trip
- plane detection/ground candidate logic

## API smoke test

With the backend running:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/api/health
Invoke-WebRequest http://127.0.0.1:8000/api/system
```

## Frontend checks

```powershell
cd frontend
npm install
npm run build
npm run test
```

## Manual end-to-end acceptance test

1. Upload a JPEG/PNG/WebP.
2. Wait for depth processing to finish.
3. Confirm IMAGE, DEPTH, 3D and SPLIT all render.
4. Hover over IMAGE and confirm pixel/depth/XYZ updates.
5. Click an image point and confirm the 3D selection marker moves to the corresponding point.
6. Switch to 3D, select a point, and confirm its source pixel is recovered.
7. In Measure mode, select A then B; confirm the 3D line and metric distance.
8. Add C; confirm A-B-C angle.
9. Run Region ROI and confirm pixel count, depth statistics and approximate 3D dimensions.
10. Run Depth profile and confirm the depth plot and 3D path length.
11. Run object detection and select an object; confirm mask overlay, object statistics and selected-object 3D coloring.
12. Toggle planes/ground/mesh/frustum.
13. Change calibration and confirm the point cloud rebuilds.
14. Apply reference-distance calibration and confirm the global scale changes.
15. Save `.s3d`, reload it, and confirm annotations/UI state persist.
16. Download at least one individual artifact and the full `.s3d` package.

## WebGL acceptance

The browser must expose WebGL2. If WebGL cannot initialize, the application intentionally keeps image/depth/analysis available and displays a renderer-specific error rather than blanking the application.
