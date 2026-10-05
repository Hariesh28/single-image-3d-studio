# Camera calibration and metric XYZ

## Projection model

For pixel `(u,v)` and metric depth `Z`:

```text
X = (u - cx) * Z / fx
Y = -(v - cy) * Z / fy
Z = depth(u,v)
```

The negative sign on Y converts the image's downward pixel axis to the application's upward world convention.

## Calibration priority

1. Explicit manual intrinsics
2. EXIF 35 mm equivalent focal length
3. User-supplied horizontal FOV
4. Documented default FOV

If only physical focal length is present in EXIF and the sensor width is unknown, the application does **not** pretend it can derive an exact pixel focal length. It falls back to FOV instead.

## Reference-distance calibration

Two selected points and a known physical distance produce:

```text
scale_factor = known_distance / predicted_distance
```

The factor is persisted in the scene calibration and the geometry is rebuilt.

This corrects global scale, but it does not solve lens distortion, focal-length error, or depth-model local shape errors.

## Coordinate frames

Raw camera frame:

```text
X right
Y up
Z forward
```

Displayed ground-aligned frame:

```text
ground normal → +Y
selected ground plane translated → Y = 0
```

The raw camera frame remains the canonical measurement frame.
