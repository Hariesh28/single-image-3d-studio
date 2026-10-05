from backend.app.core.calibration import estimate_intrinsics, focal_to_fov, fov_to_focal


def test_fov_roundtrip():
    f = fov_to_focal(1920, 70)
    assert 1370 < f < 1372
    assert abs(focal_to_fov(1920, f) - 70.0) < 1e-6


def test_manual_calibration_wins():
    class C:
        source = "manual"
        fx = 1200
        fy = 1180
        cx = 900
        cy = 500
        scale = 1.0
        fov_deg = None

    result = estimate_intrinsics(1920, 1080, {"FocalLengthIn35mmFilm": 35}, C())
    assert result["source"] == "manual"
    assert result["fx"] == 1200
    assert result["fy"] == 1180


def test_fov_calibration_uses_image_geometry():
    class C:
        source = "fov"
        fx = fy = cx = cy = None
        scale = 1.0
        fov_deg = 90

    result = estimate_intrinsics(1600, 900, {}, C())
    assert abs(result["cx"] - 800) < 1e-6
    assert abs(result["cy"] - 450) < 1e-6
    assert abs(result["fx"] - fov_to_focal(1600, 90)) < 1e-6


def test_manual_calibration_preserves_distortion():
    from backend.app.core.calibration import estimate_intrinsics
    class C:
        source='manual'; fx=800; fy=810; cx=320; cy=240; scale=1.0; fov_deg=70; k1=.01; k2=-.02; p1=.001; p2=.002; k3=.003
    out=estimate_intrinsics(640,480,{},C())
    assert out['distortion']['k1'] == .01
    assert out['distortion']['k3'] == .003
