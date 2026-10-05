import numpy as np

from backend.app.core.geometry import depth_to_points, point_from_pixel


def test_center_pixel_backprojection():
    depth = np.full((4, 6), 2.0, np.float32)
    rgb = np.zeros((4, 6, 3), np.uint8)
    cal = {"fx": 100.0, "fy": 100.0, "cx": 3.0, "cy": 2.0, "scale": 1.0}
    point = point_from_pixel(2.0, 3, 2, cal)
    assert np.allclose(point, [0.0, 0.0, 2.0])
    scaled = point_from_pixel(2.0, 3, 2, {**cal, "scale": 1.5})
    assert np.allclose(scaled, [0.0, 0.0, 3.0])


def test_point_cloud_has_normals_and_pixels():
    y, x = np.indices((12, 12), dtype=np.float32)
    depth = (2.0 + 0.01 * x + 0.02 * y).astype(np.float32)
    rgb = np.dstack([np.full_like(depth, 100, dtype=np.uint8), np.full_like(depth, 120, dtype=np.uint8), np.full_like(depth, 140, dtype=np.uint8)])
    cal = {"fx": 120.0, "fy": 120.0, "cx": 6.0, "cy": 6.0, "scale": 1.5}
    points, colors, pixels, normals = depth_to_points(depth, rgb, cal, max_points=1000, max_depth=20, include_normals=True)
    assert len(points) == len(colors) == len(pixels)
    assert normals is not None
    assert normals.shape == points.shape
    assert np.isfinite(points).all()


def test_distortion_round_trip_pixel_projection():
    from backend.app.core.geometry import point_from_pixel
    from backend.app.core.analysis import project_point
    import numpy as np

    cal = {
        "fx": 500.0,
        "fy": 500.0,
        "cx": 320.0,
        "cy": 240.0,
        "scale": 1.0,
        "distortion": {"k1": 0.08, "k2": -0.02, "p1": 0.001, "p2": -0.001, "k3": 0.001},
    }
    p = point_from_pixel(3.0, 500, 300, cal)
    uv = project_point(np.asarray(p), cal)
    assert abs(uv[0] - 500) < 1e-3
    assert abs(uv[1] - 300) < 1e-3
