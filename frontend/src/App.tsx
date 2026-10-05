import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useState } from 'react'
import { AnalysisPanel } from './components/AnalysisPanel'
import { Controls } from './components/Controls'
import { DepthPanel } from './components/DepthPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ImagePanel } from './components/ImagePanel'
import { Inspector } from './components/Inspector'
import { Processing } from './components/Processing'
import { ProjectPanel } from './components/ProjectPanel'
import { ComparePanel } from './components/ComparePanel'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { Upload } from './components/Upload'
import { PointCloudScene } from './three/PointCloud'
import { artifact, getAnnotations, getState, saveState } from './api/client'
import { ParallaxView } from './components/ParallaxView'
import { useSceneProgress } from './hooks/useSceneProgress'
import { useSceneStore } from './store/useSceneStore'
import './styles.css'

const config={scene_mode:'auto',quality:'maximum',generate_mesh:true,detect_planes:true,include_normals:true,max_points:1_500_000}

type RightPanel='controls'|'analysis'|'project'
export default function App(){
 const s=useSceneStore(),[sceneMode,setSceneMode]=useState('auto'),[quality,setQuality]=useState('maximum'),[error,setError]=useState(''),[right,setRight]=useState<RightPanel>('controls')
 const {status,error:statusError}=useSceneProgress(s.sceneId)
 useEffect(()=>{if(!s.scene)return;const c=s.scene.calibration; s.set({nearDepth:Math.max(.05,s.scene.depth_min_m),farDepth:Math.max(s.scene.depth_max_m,c.source==='default_fov'?20:80)});getAnnotations(s.scene.scene_id).then(x=>s.set({annotations:x.items||[]})).catch(()=>{});getState(s.scene.scene_id).then((ui:any)=>{if(!ui||typeof ui!=='object')return;s.set({mode:ui.mode,tool:ui.tool,density:ui.density,pointSize:ui.point_size,pointBudget:ui.point_budget,colorMode:ui.color_mode,pointOpacity:ui.point_opacity,rgb:ui.rgb,nearDepth:ui.near_depth,farDepth:ui.far_depth,background:ui.background,showGrid:ui.show_grid,showAxes:ui.show_axes,showFrustum:ui.show_frustum,showGround:ui.show_ground,showMesh:ui.show_mesh,showCamera:ui.show_camera,showPlanes:ui.show_planes,showLabels:ui.show_labels,adaptiveLod:ui.adaptive_lod,showContours:ui.show_contours,minX:Number.isFinite(ui.min_x)?ui.min_x:-Infinity,maxX:Number.isFinite(ui.max_x)?ui.max_x:Infinity,minY:Number.isFinite(ui.min_y)?ui.min_y:-Infinity,maxY:Number.isFinite(ui.max_y)?ui.max_y:Infinity,minZ:Number.isFinite(ui.min_z)?ui.min_z:-Infinity,maxZ:Number.isFinite(ui.max_z)?ui.max_z:Infinity,depthColormap:ui.depth_colormap,depthDisplay:ui.depth_display,parallaxStrength:ui.parallax_strength,parallaxYaw:ui.parallax_yaw,parallaxPitch:ui.parallax_pitch,cameraView:ui.camera_view||'home',selectedObjectId:ui.selected_object_id??null,regionShape:ui.region_shape||'polygon'})}).catch(()=>{});},[s.sceneId,s.scene])
 useKeyboardShortcuts()
 useEffect(()=>{if(!s.sceneId)return;const payload={mode:s.mode,tool:s.tool,region_shape:s.regionShape,density:s.density,point_size:s.pointSize,point_budget:s.pointBudget,color_mode:s.colorMode,rgb:s.rgb,point_opacity:s.pointOpacity,near_depth:s.nearDepth,far_depth:s.farDepth,background:s.background,show_grid:s.showGrid,show_axes:s.showAxes,show_frustum:s.showFrustum,show_ground:s.showGround,show_mesh:s.showMesh,show_camera:s.showCamera,show_planes:s.showPlanes,show_labels:s.showLabels,adaptive_lod:s.adaptiveLod,show_contours:s.showContours,min_x:Number.isFinite(s.minX)?s.minX:null,max_x:Number.isFinite(s.maxX)?s.maxX:null,min_y:Number.isFinite(s.minY)?s.minY:null,max_y:Number.isFinite(s.maxY)?s.maxY:null,min_z:Number.isFinite(s.minZ)?s.minZ:null,max_z:Number.isFinite(s.maxZ)?s.maxZ:null,depth_colormap:s.depthColormap,depth_display:s.depthDisplay,parallax_strength:s.parallaxStrength,parallax_yaw:s.parallaxYaw,parallax_pitch:s.parallaxPitch,camera_view:s.cameraView,selected_object_id:s.selectedObjectId};const id=window.setTimeout(()=>saveState(s.sceneId!,payload).catch(()=>{}),500);return()=>clearTimeout(id)},[s.sceneId,s.mode,s.tool,s.density,s.rgb,s.parallaxStrength,s.parallaxYaw,s.parallaxPitch,s.pointSize,s.pointBudget,s.colorMode,s.pointOpacity,s.nearDepth,s.farDepth,s.background,s.showGrid,s.showAxes,s.showFrustum,s.showGround,s.showMesh,s.showCamera,s.showPlanes,s.showLabels,s.adaptiveLod,s.showContours,s.regionShape,s.minX,s.maxX,s.minY,s.maxY,s.minZ,s.maxZ,s.depthColormap,s.depthDisplay])
 const onFile=useCallback(async(file:File)=>{setError('');try{const r=await (await import('./api/client')).createScene(file,{...config,scene_mode:sceneMode,quality});s.set({sceneId:r.scene_id,scene:null,selected:null,hover:null,measurementA:null,measurementB:null,measurementC:null,annotations:[],regionPoints:[],regionResult:null,profile:null,profileStart:null})}catch(e){setError(String(e))}},[sceneMode,quality,s])
 if(!s.sceneId)return <div className="app landingApp"><header className="topHeader"><div className="brand"><span>SINGLE IMAGE</span><strong>3D</strong><i>STUDIO</i></div><div className="headerBadge">METRIC · LOCAL · V2-L</div></header><main className="landing"><div className="hero"><div className="eyebrow">SINGLE-IMAGE 3D ANALYSIS PLATFORM</div><h1>One image.<br/><em>A complete 3D workspace.</em></h1><p>Metric depth, calibrated geometry, point-cloud inspection, measurements, segmentation, planes, mesh and export — all processed locally.</p><Upload onFile={onFile} mode={sceneMode} quality={quality} setMode={setSceneMode} setQuality={setQuality}/>{error&&<div className="error">{error}</div>}<div className="heroFoot"><span>Depth Anything V2 · ViT-L</span><span>Indoor + Outdoor metric</span><span>CUDA / RTX-ready</span></div></div></main></div>
 if(!s.scene||status?.status!=='complete')return <div className="app processingApp"><header className="topHeader"><div className="brand"><span>SINGLE IMAGE</span><strong>3D</strong><i>STUDIO</i></div><button className="headerGhost" onClick={()=>s.reset()}>Cancel / new scene</button></header><Processing status={status} error={statusError}/></div>
 const scene=s.scene,image=artifact(scene.scene_id,scene.artifacts.image||'image.png'),depthKey=`depth_${s.depthDisplay}_${s.depthColormap}`,depth=artifact(scene.scene_id,scene.artifacts[depthKey]||scene.artifacts.depth_image||'depth.png'),rawDepth=artifact(scene.scene_id,scene.artifacts.depth||'depth.f32'),contours=s.showContours&&scene.artifacts.depth_contours?artifact(scene.scene_id,scene.artifacts.depth_contours):depth
 return <div className="app viewerApp"><header className="topHeader"><div className="brand"><span>SINGLE IMAGE</span><strong>3D</strong><i>STUDIO</i></div><div className="sceneHeaderInfo"><span>{scene.scene_type.toUpperCase()} · {scene.width}×{scene.height}</span><span>{scene.calibration.source.toUpperCase()} · {scene.quality.depth_quality?.label?.toUpperCase()||'DEPTH'}</span></div><div className="headerActions"><button className="headerBtn" onClick={()=>setRight('analysis')}>Analytics</button><button className="headerBtn" onClick={()=>setRight('project')}>Project</button><button className="headerGhost" onClick={()=>s.reset()}>New scene</button></div></header><Toolbar onNew={()=>s.reset()} onProject={()=>setRight('project')}/><main className={`workspace mode-${s.mode}`}><div className="stageArea">{s.mode==='image'&&<ImagePanel src={image}/>} {s.mode==='depth'&&<DepthPanel src={s.showContours?contours:depth} min={scene.depth_min_m} max={scene.depth_max_m}/>} {s.mode==='3d'&&<ThreeViewport/>} {s.mode==='split'&&<div className="splitGrid"><ImagePanel src={image}/><DepthPanel src={s.showContours?contours:depth} min={scene.depth_min_m} max={scene.depth_max_m}/><ThreeViewport/></div>} {s.mode==='compare'&&<ComparePanel/>} {s.mode==='parallax'&&<ParallaxView imageUrl={image} depthUrl={rawDepth}/>}<div className="stageHint"><b>{s.tool.toUpperCase()}</b><span>{s.tool==='region'?'Click polygon vertices, double-click or press DONE.':s.tool==='profile'?'Click two points to generate a depth profile.':'Image/depth click → XYZ · 3D click → linked pixel · wheel zoom · drag pan/orbit'}</span></div></div><div className="sidePanel">{right==='controls'?<Controls/>:right==='analysis'?<AnalysisPanel/>:<ProjectPanel/>}</div><Inspector/></main><StatusBar/></div>
}
function ThreeViewport(){
 const [webglLost,setWebglLost]=useState(false)
 return <div className="canvas">
  <ErrorBoundary>
   <Canvas
    camera={{position:[0,1.2,6],fov:55,near:.01,far:200}}
    dpr={[1,1.5]}
    gl={{antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:false}}
    onCreated={({gl})=>{
      const canvas=gl.domElement
      const handleLost=(event:Event)=>{event.preventDefault();console.error('WebGL context lost');setWebglLost(true)}
      const handleRestored=()=>{console.info('WebGL context restored');setWebglLost(false)}
      canvas.addEventListener('webglcontextlost',handleLost,false)
      canvas.addEventListener('webglcontextrestored',handleRestored,false)
    }}
    fallback={<div className="webglFallback">WebGL 2 could not be initialized. Enable hardware acceleration in the browser.</div>}
   >
    <PointCloudScene/>
   </Canvas>
  </ErrorBoundary>
  {webglLost&&<div className="webglLostOverlay"><b>WebGL context lost</b><span>The browser GPU process stopped the 3D renderer. Try Chrome with hardware acceleration enabled, then reload.</span></div>}
 </div>
}
function useKeyboardShortcuts(){const set=useSceneStore(s=>s.set),tool=useSceneStore(s=>s.tool),reset=useSceneStore(s=>s.requestCameraReset);useEffect(()=>{const h=(e:KeyboardEvent)=>{const t=e.target as HTMLElement|null;if(t&&['INPUT','TEXTAREA','SELECT'].includes(t.tagName))return;const k=e.key.toLowerCase();if(k==='1')set({mode:'image'});else if(k==='2')set({mode:'depth'});else if(k==='3')set({mode:'3d'});else if(k==='4')set({mode:'split'});else if(k==='5')set({mode:'parallax'});else if(k==='i')set({tool:'inspect'});else if(k==='m')set({tool:tool==='measure'?'inspect':'measure'});else if(k==='a')set({tool:'annotate'});else if(k==='r')set({tool:'region',regionPoints:[]});else if(k==='p')set({tool:'profile',profileStart:null,profile:null});else if(k==='f')reset();else if(k==='g'){const cur=useSceneStore.getState();cur.set({showGrid:!cur.showGrid})}else if(k==='escape')set({selected:null,hover:null,measurementA:null,measurementB:null,measurementC:null,regionPoints:[],profileStart:null,regionShape:'polygon'})};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h)},[set,tool,reset])}
