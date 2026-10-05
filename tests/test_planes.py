import numpy as np
from backend.app.core.planes import choose_ground_plane, detect_planes


def test_detect_horizontal_plane():
    xs = np.linspace(-2, 2, 30)
    zs = np.linspace(1, 6, 30)
    xx, zz = np.meshgrid(xs, zs)
    points = np.column_stack([xx.ravel(), np.zeros(xx.size), zz.ravel()]).astype(np.float32)
    planes = detect_planes(points, iterations=40, threshold=0.01, min_inliers=100)
    assert planes
    ground = choose_ground_plane(planes)
    assert ground is not None
    assert abs(ground["normal"][1]) > 0.9
