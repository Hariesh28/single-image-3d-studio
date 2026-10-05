import { create } from 'zustand'
import type { Annotation, CameraView, ColorMode, CrossSection, Mode, PointInfo, RegionResult, RegionShape, Scene, ToolMode } from '../types'

interface Store {
  sceneId:string|null; scene:Scene|null; mode:Mode; tool:ToolMode; selected:PointInfo|null; hover:PointInfo|null;
  measurementA:PointInfo|null; measurementB:PointInfo|null; measurementC:PointInfo|null;
  annotations:Annotation[]; selectedAnnotationId:string|null; selectedObjectId:number|null; regionPoints:[number,number][]; regionShape:RegionShape; regionResult:RegionResult|null; profile:CrossSection|null; profileStart:[number,number]|null;
  density:0|1|2|3; pointSize:number; pointBudget:number; pointOpacity:number; colorMode:ColorMode; rgb:boolean;
  nearDepth:number; farDepth:number; background:string; showGrid:boolean; showAxes:boolean; showFrustum:boolean; showPlanes:boolean; showGround:boolean; showMesh:boolean; showCamera:boolean;
  showNormals:boolean; showLabels:boolean; showContours:boolean; adaptiveLod:boolean; depthColormap:'turbo'|'viridis'|'jet'|'magma'|'inferno'|'plasma'|'grayscale'; depthDisplay:'metric'|'inverse'|'log';
  minX:number; maxX:number; minY:number; maxY:number; minZ:number; maxZ:number;
  cameraView:CameraView; resetCameraKey:number; compareScene:Scene|null; parallaxStrength:number; parallaxYaw:number; parallaxPitch:number;
  history:Record<string,unknown>[]; future:Record<string,unknown>[];
  set:(v:Partial<Store>)=>void; reset:()=>void; requestCameraReset:()=>void; snapshot:()=>void; undo:()=>void; redo:()=>void
}

const initial={
 sceneId:null,scene:null,mode:'split' as Mode,tool:'inspect' as ToolMode,selected:null,hover:null,measurementA:null,measurementB:null,measurementC:null,
 annotations:[],selectedAnnotationId:null,selectedObjectId:null,regionPoints:[],regionShape:'polygon' as RegionShape,regionResult:null,profile:null,profileStart:null,
 density:0 as 0,pointSize:2.2,pointBudget:2_000_000,pointOpacity:.96,colorMode:'rgb' as ColorMode,rgb:true,
 nearDepth:.05,farDepth:80,background:'#050b13',showGrid:true,showAxes:true,showFrustum:false,showPlanes:false,showGround:false,showMesh:false,showCamera:true,
 showNormals:false,showLabels:true,showContours:false,adaptiveLod:true,depthColormap:'turbo' as const,depthDisplay:'metric' as const,
 minX:-Infinity,maxX:Infinity,minY:-Infinity,maxY:Infinity,minZ:-Infinity,maxZ:Infinity,cameraView:'home' as CameraView,resetCameraKey:0,
 compareScene:null,parallaxStrength:.65,parallaxYaw:0,parallaxPitch:0,history:[],future:[]
}

const snapshotKeys=(s:Store)=>({
 mode:s.mode,tool:s.tool,selected:s.selected,measurementA:s.measurementA,measurementB:s.measurementB,measurementC:s.measurementC,
 annotations:s.annotations,selectedAnnotationId:s.selectedAnnotationId,selectedObjectId:s.selectedObjectId,regionPoints:s.regionPoints,regionShape:s.regionShape,regionResult:s.regionResult,profile:s.profile,profileStart:s.profileStart,
 density:s.density,pointSize:s.pointSize,pointBudget:s.pointBudget,pointOpacity:s.pointOpacity,colorMode:s.colorMode,rgb:s.rgb,
 nearDepth:s.nearDepth,farDepth:s.farDepth,background:s.background,showGrid:s.showGrid,showAxes:s.showAxes,showFrustum:s.showFrustum,showPlanes:s.showPlanes,showGround:s.showGround,showMesh:s.showMesh,showCamera:s.showCamera,showLabels:s.showLabels,showContours:s.showContours,adaptiveLod:s.adaptiveLod,
 depthColormap:s.depthColormap,depthDisplay:s.depthDisplay,minX:s.minX,maxX:s.maxX,minY:s.minY,maxY:s.maxY,minZ:s.minZ,maxZ:s.maxZ,parallaxStrength:s.parallaxStrength,parallaxYaw:s.parallaxYaw,parallaxPitch:s.parallaxPitch,
})

export const useSceneStore=create<Store>((set,get)=>({
 ...initial,
 set:(v)=>set(v),
 reset:()=>set({...initial}),
 requestCameraReset:()=>set(s=>({resetCameraKey:s.resetCameraKey+1,cameraView:'home'})),
 snapshot:()=>{const s=get();const snap=snapshotKeys(s);set(st=>({history:[...st.history,snap].slice(-50),future:[]}))},
 undo:()=>set(s=>{if(!s.history.length)return s;const history=[...s.history];const previous=history.pop()!;const current=snapshotKeys(s);return {...s,...previous,history,future:[...s.future,current].slice(-50)}}),
 redo:()=>set(s=>{if(!s.future.length)return s;const future=[...s.future];const next=future.pop()!;const current=snapshotKeys(s);return {...s,...next,history:[...s.history,current].slice(-50),future}}),
}))
