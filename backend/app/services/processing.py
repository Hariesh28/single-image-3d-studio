from __future__ import annotations

import hashlib, json, shutil, time
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

from ..config import settings
from ..core.analysis import depth_histogram, depth_quality, depth_stats
from ..core.artifacts import save_depth_visuals
from ..core.calibration import calibration_quality, estimate_intrinsics
from ..core.depth_processing import depth_percentiles, sanitize_depth
from ..core.geometry import depth_to_points, write_depth, write_obj_points, write_ply, write_pointcloud
from ..core.image import extract_exif, open_image, pil_to_bgr, pil_to_rgb, resize_to_max_pixels
from ..core.mesh import depth_to_mesh, export_glb, export_obj_mesh
from ..core.planes import choose_ground_plane, detect_planes, ground_transform
from ..core.scene import classify_scene
from ..ml.bootstrap import MODEL_SPECS
from ..ml.model_manager import ModelManager
from ..schemas.models import ProcessSettings
from .storage import save_json

MODEL_MANAGER = ModelManager()
QUALITY_INPUT_SIZES = {"fast": 518, "balanced": 560, "high": 644, "maximum": 700}

def _cache_key(image_bytes: bytes, cfg: ProcessSettings) -> str:
    payload = json.dumps(cfg.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(hashlib.sha256(image_bytes).digest() + b"|" + payload + b"|" + settings.da_commit.encode()).hexdigest()

def _copy_files(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    for p in src.iterdir():
        if p.is_file() and p.name not in {"upload.bin", "COMPLETE"}: shutil.copy2(p, dst / p.name)

def _restore_cache(cache_dir: Path, scene_dir: Path, scene_id: str) -> bool:
    if not (cache_dir / "COMPLETE").exists() or not (cache_dir / "scene.json").exists(): return False
    _copy_files(cache_dir, scene_dir)
    meta = json.loads((cache_dir / "scene.json").read_text(encoding="utf-8")); meta["scene_id"] = scene_id
    save_json(scene_dir / "scene.json", meta); return True

def _save_cache(cache_dir: Path, scene_dir: Path) -> None:
    if cache_dir.exists(): return
    tmp = cache_dir.with_suffix(".tmp")
    if tmp.exists(): shutil.rmtree(tmp, ignore_errors=True)
    _copy_files(scene_dir, tmp); (tmp / "COMPLETE").write_text("ok", encoding="utf-8"); tmp.rename(cache_dir)

def _write_depth_preview(depth: np.ndarray, valid: np.ndarray, scene_dir: Path) -> dict[str, str]:
    artifacts = save_depth_visuals(depth, valid, scene_dir)
    shutil.copy2(scene_dir / artifacts["depth_turbo"], scene_dir / "depth.png")
    artifacts["depth_image"] = "depth.png"
    return artifacts

def _checkpoint_digest(scene_type: str) -> str | None:
    try:
        from ..ml.bootstrap import MODEL_SPECS, ensure_model
        p = ensure_model(scene_type).with_suffix(ensure_model(scene_type).suffix + ".sha256")
        if p.exists():
            return p.read_text(encoding="utf-8").strip()
    except Exception:
        return None
    return None

def _select_model(mode: str, label: str, conf: float) -> tuple[str, str]:
    if mode in {"indoor", "outdoor"}: return mode, "manual"
    if label == "outdoor" and conf >= .60: return "outdoor", "auto_classifier"
    return "indoor", "auto_default_indoor"

def process_scene(scene_id: str, scene_dir: Path, image_bytes: bytes, cfg: ProcessSettings, progress) -> None:
    original = open_image(image_bytes); exif = extract_exif(image_bytes)
    ow, oh = original.size
    progress("preprocess", 5, "Normalizing image and reading camera metadata")
    cache_key = _cache_key(image_bytes, cfg); cache_dir = settings.cache_dir / cache_key
    if _restore_cache(cache_dir, scene_dir, scene_id): progress("cache", 99, "Loaded identical reconstruction from local cache"); return
    processed, resize_scale = resize_to_max_pixels(original, settings.max_pixels)
    w, h = processed.size; rgb = pil_to_rgb(processed); bgr = pil_to_bgr(processed)
    original.save(scene_dir / "original.jpg", quality=96, optimize=True); processed.save(scene_dir / "image.png", optimize=True); save_json(scene_dir / "exif.json", exif)
    label, conf, diag = classify_scene(rgb); scene_type, selection_source = _select_model(cfg.scene_mode, label, conf)
    progress("model", 14, f"Loading Depth Anything V2 Metric Large · {scene_type}")
    input_size = QUALITY_INPUT_SIZES[cfg.quality]
    t0 = time.perf_counter(); depth, actual_size = MODEL_MANAGER.infer(bgr, scene_type, input_size); inference_seconds = time.perf_counter() - t0
    if depth.shape != (h, w): depth = cv2.resize(depth, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    depth, valid = sanitize_depth(depth, MODEL_SPECS[scene_type]["max_depth"])
    if not valid.any(): raise RuntimeError("Depth model produced no valid metric depth values")
    progress("depth", 43, f"Metric depth ready · model input {actual_size}px")
    calibration = estimate_intrinsics(w, h, exif, cfg.calibration); calibration["quality"] = calibration_quality(calibration["source"])
    progress("calibration", 49, f"Camera calibration: {calibration['source']}")

    max_points = min(cfg.max_points or settings.default_max_points, settings.max_points)
    points, colors, pixels, normals = depth_to_points(depth, rgb, calibration, max_points=max_points, max_depth=MODEL_SPECS[scene_type]["max_depth"], include_normals=cfg.include_normals)
    progress("pointcloud", 65, f"Generated {len(points):,} metric 3D points")
    write_depth(scene_dir / "depth.f32", depth); np.save(scene_dir / "depth.npy", depth)
    artifacts = _write_depth_preview(depth, valid, scene_dir)
    lod_items = [(points, colors, pixels, normals), (points[::2], colors[::2], pixels[::2], normals[::2] if normals is not None else None), (points[::4], colors[::4], pixels[::4], normals[::4] if normals is not None else None), (points[::8], colors[::8], pixels[::8], normals[::8] if normals is not None else None)]
    counts=[]
    for i,(p,c,px,n) in enumerate(lod_items): write_pointcloud(scene_dir/f"pointcloud_lod{i}.bin",p,c,px,w,h,n); counts.append(int(len(p)))
    write_ply(scene_dir/"pointcloud.ply",points,colors,normals); write_obj_points(scene_dir/"pointcloud.obj",points,colors)
    artifacts.update({"depth":"depth.f32","depth_npy":"depth.npy","lod0":"pointcloud_lod0.bin","lod1":"pointcloud_lod1.bin","lod2":"pointcloud_lod2.bin","lod3":"pointcloud_lod3.bin","ply":"pointcloud.ply","obj":"pointcloud.obj"})

    planes=[]; ground=None; transform=None
    if cfg.detect_planes and len(points)>=300:
        progress("analysis", 78, "Analyzing planes and scene geometry")
        planes=detect_planes(points,sample_limit=settings.max_planes_points); ground=choose_ground_plane(planes); transform=ground_transform(ground)
    mesh_ready=False
    if cfg.generate_mesh:
        progress("mesh", 86, "Generating edge-aware textured surface mesh")
        try:
            mesh=depth_to_mesh(depth,rgb,calibration,max_dim=settings.max_mesh_dimension)
            if len(mesh.vertices) and len(mesh.faces): export_glb(mesh,scene_dir/"mesh.glb"); export_obj_mesh(mesh,scene_dir/"mesh.obj"); mesh_ready=True
        except Exception as exc:
            progress("mesh", 88, f"Mesh export skipped: {exc}")
    artifacts.update({"mesh_glb":"mesh.glb" if mesh_ready else None,"mesh_obj":"mesh.obj" if mesh_ready else None,"original":"original.jpg","image":"image.png","exif":"exif.json"})
    scale=float(calibration.get("scale",1.0))
    stats=depth_stats(depth,MODEL_SPECS[scene_type]["max_depth"],scale); histogram=depth_histogram(depth,MODEL_SPECS[scene_type]["max_depth"],scale,64); dq=depth_quality(depth,MODEL_SPECS[scene_type]["max_depth"])
    quality={"depth_valid_fraction":stats["valid_fraction"],"depth_quality":dq,"calibration":calibration["quality"],"calibration_source":calibration["source"],"scene_classifier":diag,"point_count":len(points),"normal_attribute":cfg.include_normals,"mesh_generated":mesh_ready,"planes_detected":len(planes),"inference_seconds":round(inference_seconds,3),"model_input_size":actual_size,"model_requested_input_size":input_size,"max_points_budget":max_points,"coordinate_frame":"camera","units":"meters","accuracy_notice":"Metric depth is an estimate; X/Y depends on camera intrinsics and all geometry is camera-relative unless ground alignment is enabled.","device":MODEL_MANAGER.system_info().get("device"),"gpu_name":MODEL_MANAGER.system_info().get("gpu_name")}
    metadata={"scene_id":scene_id,"source_sha256":hashlib.sha256(image_bytes).hexdigest(),"schema_version":"4.0","application_version":settings.version,"cache_key":cache_key,"checkpoint_sha256":_checkpoint_digest(scene_type),"width":w,"height":h,"original_width":ow,"original_height":oh,"resize_scale":resize_scale,"model":f"Depth Anything V2 Metric Large / {scene_type}","model_dataset":MODEL_SPECS[scene_type]["dataset"],"model_source_commit":settings.da_commit,"scene_type":scene_type,"scene_confidence":float(conf),"scene_selection_source":selection_source,"max_depth_m":MODEL_SPECS[scene_type]["max_depth"],"depth_min_m":stats["min_m"],"depth_max_m":stats["max_m"],"depth_percentiles":{k.replace("p","p"):v for k,v in stats["percentiles_m"].items()},"point_counts":counts,"calibration":calibration,"planes":planes,"ground_plane":ground,"ground_transform":transform,"quality":quality,"analysis":{"stats":stats,"histogram":histogram,"contours_supported":True,"profile_supported":True},"segmentation":{"status":"not_run","objects":[]},"settings":cfg.model_dump(mode="json"),"artifacts":artifacts,"created_at":time.time()}
    save_json(scene_dir/"scene.json",metadata); progress("finalize",98,"Finalizing scene package"); _save_cache(cache_dir,scene_dir)
