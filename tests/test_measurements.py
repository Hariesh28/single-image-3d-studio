import math

from backend.app.core.measurements import measure_points


def test_measure_points_distance_components():
    result = measure_points((0, 0, 0), (3, 4, 12))
    assert math.isclose(result['distance_m'], 13.0)
    assert math.isclose(result['horizontal_distance_m'], 12.3693168768, rel_tol=1e-9)
    assert math.isclose(result['vertical_difference_m'], 4.0)
    assert math.isclose(result['depth_difference_m'], 12.0)


def test_measure_points_angle():
    result = measure_points((1, 0, 0), (0, 0, 0), (0, 1, 0))
    assert math.isclose(result['angle_deg'], 90.0)


def test_measure_points_degenerate_angle():
    result = measure_points((0, 0, 0), (0, 0, 0), (1, 0, 0))
    assert result['angle_deg'] is None
