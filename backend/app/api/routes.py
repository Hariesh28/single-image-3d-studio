from __future__ import annotations
import asyncio, io, json, math, shutil, tempfile, time, uuid, struct
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import cv2, numpy as np
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image

from ..config import settings
from ..core.analysis import cross_section, depth_histogram, depth_stats, region_stats, project_point
from ..core.calibration import calibration_quality, estimate_intrinsics
from ..core.geometry import depth_to_points, point_from_pixel, write_obj_points, write_ply, write_pointcloud
from ..core.mesh import depth_to_mesh, export_glb, export_obj_mesh
from ..core.measurements import measure_points
from ..core.planes import choose_ground_plane, detect_planes, ground_transform
from ..core.segmentation import ENGINE, encode_mask_png, enrich_objects
from ..core.scene_ops import apply_scene_transform
from ..ml.bootstrap import ensure_model, ensure_source, model_status
from ..schemas.models import CalibrationInput, CrossSectionRequest, EvaluationRequest, MeasurementRequest, ProcessSettings, ReferenceCalibrationRequest, RegionRequest, ReprojectionRequest, SceneState, SegmentationRequest, AnnotationsPayload
from ..schemas.scene import SceneStatus
from ..services.jobs import JobManager
from ..services.processing import MODEL_MANAGER, process_scene
from ..services.storage import ArtifactNotFound, new_scene_dir, read_json, safe_child, save_json

router=APIRouter(); jobs=JobManager()

def _dir(sid:str)->Path:
    if not sid or len(sid)!=32 or any(c not in '0123456789abcdef' for c in sid): raise HTTPException(400,'Invalid scene id')
    p=settings.scene_dir/sid
    if not p.is_dir(): raise HTTPException(404,'Scene not found')
    return p

def _depth(root:Path,meta:dict)->np.memmap:
    p=root/'depth.f32'
    if not p.exists(): raise HTTPException(409,'Depth artifact unavailable')
    return np.memmap(p,dtype=np.float32,mode='r',offset=12,shape=(meta['height'],meta['width']))

def _rebuild(root:Path,meta:dict,cal:dict)->dict:
    rgb=np.asarray(Image.open(root/'image.png').convert('RGB'),dtype=np.uint8); depth=np.asarray(_depth(root,meta),dtype=np.float32)
    max_depth=float(meta['max_depth_m']); cfg=meta.get('settings',{}); max_points=min(int(cfg.get('max_points') or settings.default_max_points),settings.max_points)
    pts,col,pix,norm=depth_to_points(depth,rgb,cal,max_points,max_depth,bool(cfg.get('include_normals',True)))
    for i,stride in enumerate((1,2,4,8)):
        pp,cc,px,nn=pts[::stride],col[::stride],pix[::stride],norm[::stride] if norm is not None else None
        write_pointcloud(root/f'pointcloud_lod{i}.bin',pp,cc,px,meta['width'],meta['height'],nn)
    write_ply(root/'pointcloud.ply',pts,col,norm); write_obj_points(root/'pointcloud.obj',pts,col)
    planes=detect_planes(pts,sample_limit=settings.max_planes_points) if bool(cfg.get('detect_planes',True)) and len(pts)>=300 else []
    ground=choose_ground_plane(planes); transform=ground_transform(ground)
    mesh_ready=False
    if bool(cfg.get('generate_mesh',True)):
        try:
            mesh=depth_to_mesh(depth,rgb,cal,max_dim=settings.max_mesh_dimension)
            if len(mesh.vertices) and len(mesh.faces): export_glb(mesh,root/'mesh.glb'); export_obj_mesh(mesh,root/'mesh.obj'); mesh_ready=True
        except Exception: pass
    scale=float(cal.get('scale',1.0)); stats=depth_stats(depth,max_depth,scale); meta.update({'calibration':cal,'depth_min_m':stats['min_m'],'depth_max_m':stats['max_m'],'depth_percentiles':stats['percentiles_m'],'point_counts':[len(pts),len(pts[::2]),len(pts[::4]),len(pts[::8])],'planes':planes,'ground_plane':ground,'ground_transform':transform})
    meta['quality']['calibration']=calibration_quality(cal['source']); meta['quality']['calibration_source']=cal['source']; meta['quality']['point_count']=len(pts); meta['quality']['planes_detected']=len(planes); meta['artifacts']['mesh_glb']='mesh.glb' if mesh_ready else None; meta['artifacts']['mesh_obj']='mesh.obj' if mesh_ready else None
    save_json(root/'scene.json',meta); return {'calibration':cal,'point_counts':meta['point_counts'],'planes':planes,'ground_plane':ground,'ground_transform':transform}

@router.post('/scenes',status_code=202)
async def create_scene(file:UploadFile=File(...),config:str=Query(default='{}')):
    if file.content_type not in {'image/jpeg','image/png','image/webp'}: raise HTTPException(415,'Only JPEG, PNG and WebP are supported')
    data=await file.read()
    if not data: raise HTTPException(400,'Empty image')
    if len(data)>settings.max_upload_mb*1024*1024: raise HTTPException(413,f'Image exceeds {settings.max_upload_mb} MB')
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in {'JPEG','PNG','WEBP'}: raise ValueError('Unsupported format')
            if im.width*im.height>max(settings.max_pixels*4,48_000_000): raise ValueError('Image contains too many pixels')
    except Exception as exc: raise HTTPException(400,f'Invalid image: {exc}') from exc
    try: cfg=ProcessSettings.model_validate(json.loads(config))
    except Exception as exc: raise HTTPException(400,f'Invalid processing settings: {exc}') from exc
    cfg.max_points=min(cfg.max_points or settings.default_max_points,settings.max_points); sid,root=new_scene_dir(); (root/'upload.bin').write_bytes(data); jobs.create(sid,process_scene,sid,root,data,cfg); return {'scene_id':sid,'status':'queued'}

@router.get('/scenes')
def list_scenes(limit:int=Query(default=50,ge=1,le=200)):
    rows=[]
    for p in sorted(settings.scene_dir.iterdir(),key=lambda x:x.stat().st_mtime,reverse=True):
        if len(rows)>=limit or not p.is_dir() or not (p/'scene.json').exists(): continue
        try:
            m=read_json(p/'scene.json'); rows.append({'scene_id':m['scene_id'],'width':m['width'],'height':m['height'],'scene_type':m['scene_type'],'model':m['model'],'created_at':m['created_at'],'point_count':m['point_counts'][0],'calibration_source':m['calibration']['source']})
        except Exception: continue
    return rows

@router.post('/scenes/import',status_code=201)
async def import_scene(file:UploadFile=File(...)):
    data=await file.read()
    if len(data)>1500*1024*1024: raise HTTPException(413,'Scene package is too large')
    sid,root=new_scene_dir(); archive=root/'incoming.s3d'
    archive.write_bytes(data)
    try:
        with ZipFile(io.BytesIO(data)) as z:
            names=z.namelist(); total=0
            for n in names:
                p=Path(n)
                if p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe archive path')
                info=z.getinfo(n); total += info.file_size
                if total>2_000_000_000: raise ValueError('Archive expands beyond safety limit')
            if 'scene.json' not in names: raise ValueError('scene.json missing')
            z.extractall(root)
        meta=read_json(root/'scene.json'); meta['scene_id']=sid; save_json(root/'scene.json',meta); archive.unlink(missing_ok=True); return meta
    except Exception as exc:
        shutil.rmtree(root,ignore_errors=True); raise HTTPException(400,f'Invalid scene package: {exc}') from exc

@router.get('/scenes/{scene_id}/status',response_model=SceneStatus)
def scene_status(scene_id:str):
    root=_dir(scene_id); j=jobs.snapshot(scene_id)
    if j is None and (root/'scene.json').exists(): return SceneStatus(scene_id=scene_id,status='complete',progress=100,stage='complete',message='Scene ready')
    if j is None: raise HTTPException(404,'Scene job not found')
    return SceneStatus(**{k:j[k] for k in ('scene_id','status','progress','stage','message','error','started_at','finished_at')})

@router.get('/scenes/{scene_id}/events')
async def scene_events(scene_id:str):
    _dir(scene_id)
    async def stream():
        sent=0
        while True:
            snap=jobs.snapshot(scene_id)
            if snap is None: yield 'event: terminal\ndata: {"status":"complete","progress":100}\n\n'; return
            for event in snap.get('events',[])[sent:]: yield f"event: progress\ndata: {json.dumps(event)}\n\n"
            sent=len(snap.get('events',[]))
            if snap['status'] in {'complete','failed'}: yield f"event: terminal\ndata: {json.dumps(snap)}\n\n"; return
            await asyncio.sleep(.4)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

@router.get('/scenes/{scene_id}')
def get_scene(scene_id:str):
    root=_dir(scene_id); p=root/'scene.json'
    if not p.exists(): raise HTTPException(409,'Scene is still processing')
    return read_json(p)

@router.delete('/scenes/{scene_id}',status_code=204)
def delete_scene(scene_id:str): shutil.rmtree(_dir(scene_id),ignore_errors=True)

@router.get('/scenes/{scene_id}/file/{name:path}')
def get_file(scene_id:str,name:str):
    root=_dir(scene_id)
    try: p=safe_child(root,name)
    except ArtifactNotFound as exc: raise HTTPException(404,'Artifact not found') from exc
    if not p.is_file() or p.name in {'upload.bin','incoming.s3d'}: raise HTTPException(404,'Artifact not found')
    return FileResponse(p)

@router.get('/scenes/{scene_id}/point')
def point_lookup(scene_id:str,x:int=Query(ge=0),y:int=Query(ge=0),radius:int=Query(default=4,ge=0,le=12)):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); w,h=meta['width'],meta['height']
    if x>=w or y>=h: raise HTTPException(400,'Pixel out of bounds')
    depth=_depth(root,meta); ox,oy=x,y; value=float(depth[y,x]); snapped=False
    if not np.isfinite(value) or value<=.05 or value>meta['max_depth_m']*1.02:
        found=None
        for r in range(1,radius+1):
            x0,x1=max(0,x-r),min(w-1,x+r); y0,y1=max(0,y-r),min(h-1,y+r)
            cand=[]
            for yy in range(y0,y1+1):
                for xx in range(x0,x1+1):
                    v=float(depth[yy,xx])
                    if np.isfinite(v) and v>.05 and v<=meta['max_depth_m']*1.02: cand.append(((xx-x)**2+(yy-y)**2,yy,xx,v))
            if cand: _,y,x,value=min(cand); found=True; break
        if not found: raise HTTPException(404,'No valid depth near this pixel')
        snapped=True
    cal=meta['calibration']; p=point_from_pixel(value,x,y,cal)
    local=np.asarray(depth[max(0,y-2):min(h,y+3),max(0,x-2):min(w,x+3)],np.float32); good=local[np.isfinite(local)&(local>.05)]
    variation=float(np.std(good)/max(np.mean(good),1e-6)) if good.size else 1.0; qs=float(np.clip(1-variation*2,0,1)); quality='high' if qs>=.8 else 'medium' if qs>=.5 else 'low'
    return {'pixel_x':int(x),'pixel_y':int(y),'requested_pixel_x':ox,'requested_pixel_y':oy,'snapped':snapped,'depth_m':float(value*cal.get('scale',1.0)),'x_m':float(p[0]),'y_m':float(p[1]),'z_m':float(p[2]),'radial_distance_m':float(np.linalg.norm(p)),'quality':quality,'quality_score':qs,'calibration_source':cal['source'],'scale':float(cal.get('scale',1.0))}

@router.post('/scenes/{scene_id}/calibration')
def update_calibration(scene_id:str,calibration:CalibrationInput):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); exif=read_json(root/'exif.json') if (root/'exif.json').exists() else {}; cal=estimate_intrinsics(meta['width'],meta['height'],exif,calibration); return _rebuild(root,meta,cal)

@router.post('/scenes/{scene_id}/calibration/reference')
def reference_calibration(scene_id:str,req:ReferenceCalibrationRequest):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); depth=_depth(root,meta); cal=dict(meta['calibration']); w,h=meta['width'],meta['height']
    for x,y in ((req.x1,req.y1),(req.x2,req.y2)):
        if not(0<=x<w and 0<=y<h): raise HTTPException(400,'Reference pixel out of bounds')
    def rawp(x,y):
        v=float(depth[y,x]);
        if not np.isfinite(v) or v<=.05: raise HTTPException(400,'Reference point has invalid depth')
        c=dict(cal); c['scale']=1.0; return point_from_pixel(v,x,y,c)
    a,b=rawp(req.x1,req.y1),rawp(req.x2,req.y2); pred=float(np.linalg.norm(a-b));
    if pred<=1e-8: raise HTTPException(400,'Reference points have zero predicted distance')
    factor=req.known_distance_m/pred; cal['scale']=float(cal.get('scale',1.0))*factor; cal['scale_source']='reference_distance'; result=_rebuild(root,meta,cal); return {'predicted_distance_m':pred*float(meta['calibration'].get('scale',1.0)),'known_distance_m':req.known_distance_m,'scale_factor':factor,**result}

@router.post('/scenes/{scene_id}/reconstruct')
def reconstruct(scene_id:str):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); return _rebuild(root,meta,meta['calibration'])

@router.post('/scenes/{scene_id}/analysis/region')
def analyze_region(scene_id:str,req:RegionRequest):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); depth=np.asarray(_depth(root,meta),np.float32); rgb=np.asarray(Image.open(root/'image.png').convert('RGB'))
    poly=np.asarray(req.polygon,np.int32)
    if np.any(poly[:,0]<0)|np.any(poly[:,1]<0)|np.any(poly[:,0]>=meta['width'])|np.any(poly[:,1]>=meta['height']): raise HTTPException(400,'Polygon out of bounds')
    mask=np.zeros(depth.shape,np.uint8); cv2.fillPoly(mask,[poly],255)
    if int((mask>0).sum())>settings.max_region_pixels: raise HTTPException(413,'Region is too large')
    result=region_stats(mask>0,depth,rgb,meta['calibration'],meta['max_depth_m'],req.polygon); result['polygon']=req.polygon; return result

@router.post('/scenes/{scene_id}/analysis/profile')
def analyze_profile(scene_id:str,req:CrossSectionRequest):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); depth=np.asarray(_depth(root,meta),np.float32); rgb=np.asarray(Image.open(root/'image.png').convert('RGB')); 
    return cross_section(depth,rgb,meta['calibration'],(req.x1,req.y1),(req.x2,req.y2),meta['max_depth_m'],req.samples)

@router.get('/scenes/{scene_id}/analysis/histogram')
def get_histogram(scene_id:str,bins:int=Query(default=64,ge=8,le=256)):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); return depth_histogram(np.asarray(_depth(root,meta),np.float32),meta['max_depth_m'],meta['calibration'].get('scale',1.0),bins)

@router.get('/scenes/{scene_id}/analysis/stats')
def get_stats(scene_id:str):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); return depth_stats(np.asarray(_depth(root,meta),np.float32),meta['max_depth_m'],meta['calibration'].get('scale',1.0))

@router.post('/scenes/{scene_id}/analysis/reproject')
def reproject(scene_id:str,req:ReprojectionRequest):
    meta=read_json(_dir(scene_id)/'scene.json'); uv=project_point(np.array([req.x,req.y,req.z],np.float64),meta['calibration']); return {'pixel_x':uv[0],'pixel_y':uv[1],'inside':0<=uv[0]<meta['width'] and 0<=uv[1]<meta['height']}

@router.post('/scenes/{scene_id}/measure')
def measure(scene_id: str, req: MeasurementRequest):
    _dir(scene_id)
    try:
        return measure_points(req.a, req.b, req.c)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

@router.post('/scenes/{scene_id}/analysis/evaluate-distance')
def evaluate_distance(scene_id:str,req:EvaluationRequest):
    predicted=float(req.predicted_distance_m); known=float(req.known_distance_m)
    if known<=0: raise HTTPException(400,'known_distance_m must be positive')
    absolute=abs(predicted-known); relative=absolute/known
    return {'predicted_distance_m':predicted,'known_distance_m':known,'absolute_error_m':absolute,'relative_error':relative,'relative_error_percent':relative*100,'within_1cm':absolute<=0.01,'within_5cm':absolute<=0.05}

@router.post('/scenes/{scene_id}/segment')
def segment(scene_id:str,req:SegmentationRequest):
    root=_dir(scene_id); meta=read_json(root/'scene.json'); rgb=np.asarray(Image.open(root/'image.png').convert('RGB')); depth=np.asarray(_depth(root,meta),np.float32)
    try:
        # Serialize segmentation against Depth Anything inference. The same GPU is
        # shared by both large models on 8 GB-class cards.
        with MODEL_MANAGER.lock:
            MODEL_MANAGER.release_gpu()
            try:
                raw_objects=ENGINE.predict(rgb,req.score_threshold,min(req.max_objects,settings.max_segmentation_objects))
            finally:
                ENGINE.release_gpu()
    except Exception as exc:
        raise HTTPException(503,f'Instance segmentation unavailable: {type(exc).__name__}: {exc}') from exc
    enriched=enrich_objects(raw_objects,depth,rgb,meta['calibration'],meta['max_depth_m'])
    for raw,item in zip(raw_objects,enriched):
        mask_name=f"mask_{item['id']}.png"
        encode_mask_png(raw['mask'],root/mask_name)
        item['mask_artifact']=mask_name
    meta['segmentation']={'status':'complete','objects':enriched,'model':'TorchVision Mask R-CNN ResNet50 FPN v2 / COCO'}
    save_json(root/'scene.json',meta)
    return meta['segmentation']

@router.get('/scenes/{scene_id}/segmentation')
def segmentation(scene_id:str): return read_json(_dir(scene_id)/'scene.json').get('segmentation',{'status':'not_run','objects':[]})

@router.get('/scenes/{scene_id}/state')
def get_state(scene_id:str):
    root=_dir(scene_id); p=root/'ui_state.json'; return read_json(p) if p.exists() else SceneState().model_dump()

@router.post('/scenes/{scene_id}/state')
def save_state(scene_id:str,state:SceneState):
    root=_dir(scene_id); save_json(root/'ui_state.json',state.model_dump()); return state

@router.get('/scenes/{scene_id}/annotations')
def get_annotations(scene_id:str):
    root=_dir(scene_id); p=root/'annotations.json'; return read_json(p) if p.exists() else {'items':[]}

@router.post('/scenes/{scene_id}/annotations')
def save_annotations(scene_id:str,payload:AnnotationsPayload):
    root=_dir(scene_id); items=[item.model_dump(mode='json') for item in payload.items]
    save_json(root/'annotations.json',{'items':items}); return {'items':items}


@router.get('/scenes/{scene_id}/export/points.csv')
def export_points_csv(scene_id: str, limit: int = Query(default=200000, ge=1000, le=500000), lod: int = Query(default=0, ge=0, le=3)):
    root = _dir(scene_id)
    meta = read_json(root/'scene.json')
    path = root / f"pointcloud_lod{lod}.bin"
    if not path.exists(): raise HTTPException(404, 'Point cloud artifact not found')
    with path.open('rb') as f:
        header = f.read(20)
        magic,count,width,height,flags = struct.unpack('<IIIII', header)
        if magic != 0x50334332: raise HTTPException(400, 'Invalid point cloud artifact')
        count = min(count, limit)
        positions = np.frombuffer(f.read(min(int(meta['point_counts'][lod]), limit)*3*4), dtype='<f4').reshape(-1,3)
        colors = np.frombuffer(f.read(positions.shape[0]*3), dtype=np.uint8).reshape(-1,3)
        normals = None
        current = f.tell()
        pad = (-current) % 4
        if pad: f.seek(pad, 1)
        if flags & 1:
            normals = np.frombuffer(f.read(positions.shape[0]*3*4), dtype='<f4').reshape(-1,3)
            pad = (-f.tell()) % 4
            if pad: f.seek(pad, 1)
        pixels = np.frombuffer(f.read(positions.shape[0]*4), dtype='<u4')
    import csv
    output = io.StringIO(); writer = csv.writer(output)
    headers=['pixel_x','pixel_y','x_m','y_m','z_m','r','g','b'] + (['nx','ny','nz'] if normals is not None else [])
    writer.writerow(headers)
    for i,(p,c,pix) in enumerate(zip(positions,colors,pixels)):
        x=int(pix)%width; y=int(pix)//width
        row=[x,y,float(p[0]),float(p[1]),float(p[2]),int(c[0]),int(c[1]),int(c[2])]
        if normals is not None: row += [float(v) for v in normals[i]]
        writer.writerow(row)
    return StreamingResponse(iter([output.getvalue()]), media_type='text/csv', headers={'Content-Disposition':f'attachment; filename=scene_{scene_id}_points_lod{lod}.csv'})

@router.get('/scenes/{scene_id}/export.zip')
def export_zip(scene_id:str):
    root=_dir(scene_id); p=root/'scene_export.s3d';
    with ZipFile(p,'w',ZIP_DEFLATED) as z:
        for f in root.iterdir():
            if f.is_file() and f.name not in {'upload.bin','scene_export.s3d','incoming.s3d'}: z.write(f,arcname=f.name)
    return FileResponse(p,filename=f'scene_{scene_id}.s3d',media_type='application/octet-stream')

@router.post('/models/bootstrap')
def bootstrap_models(kind:str=Query(default='all',pattern='^(all|indoor|outdoor|segmentation)$')):
    ensure_source()
    if kind in {'all','indoor','outdoor'}:
        targets=['indoor','outdoor'] if kind=='all' else [kind]
        for target in targets: ensure_model(target)
    if kind in {'all','segmentation'}:
        from ..ml.bootstrap import ensure_segmentation_model
        ensure_segmentation_model()
    return {'models':model_status()}

@router.get('/health')
def health(): return {'status':'ok','version':settings.version,'system':MODEL_MANAGER.system_info()}

@router.get('/system')
def system(): return MODEL_MANAGER.system_info()
