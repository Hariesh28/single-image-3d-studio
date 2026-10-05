import type { CrossSection, Histogram, Measurement, PointInfo, RegionResult, Scene, SceneStatus, SceneSummary } from '../types'
export const API=import.meta.env.VITE_API_URL||'http://localhost:8000/api'
export class ApiError extends Error{status:number;constructor(message:string,status:number){super(message);this.name='ApiError';this.status=status}}
async function parse<T>(r:Response):Promise<T>{if(r.ok)return r.json(); const t=await r.text(); let m=t; try{const j=JSON.parse(t);m=j.detail||j.message||t}catch{} throw new ApiError(m||`HTTP ${r.status}`,r.status)}
export async function createScene(file:File,config:Record<string,unknown>){const q=new URLSearchParams({config:JSON.stringify(config)});const f=new FormData();f.append('file',file,file.name);return parse<{scene_id:string;status:string}>(await fetch(`${API}/scenes?${q}`,{method:'POST',body:f}))}
export async function getStatus(id:string){return parse<SceneStatus>(await fetch(`${API}/scenes/${id}/status`,{cache:'no-store'}))}
export async function getScene(id:string){return parse<Scene>(await fetch(`${API}/scenes/${id}`,{cache:'no-store'}))}
export async function listScenes(){return parse<SceneSummary[]>(await fetch(`${API}/scenes`,{cache:'no-store'}))}
export async function deleteScene(id:string){const r=await fetch(`${API}/scenes/${id}`,{method:'DELETE'});if(!r.ok)await parse(r)}
export async function importScene(file:File){const f=new FormData();f.append('file',file,file.name);return parse<Scene>(await fetch(`${API}/scenes/import`,{method:'POST',body:f}))}
export async function getPoint(id:string,x:number,y:number){return parse<PointInfo>(await fetch(`${API}/scenes/${id}/point?x=${x}&y=${y}`,{cache:'no-store'}))}
export async function updateCalibration(id:string,payload:unknown){return parse(await fetch(`${API}/scenes/${id}/calibration`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}))}
export async function calibrateReference(id:string,payload:unknown){return parse(await fetch(`${API}/scenes/${id}/calibration/reference`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}))}
export async function measure(id:string,a:number[],b:number[],c?:number[]){return parse<Measurement>(await fetch(`${API}/scenes/${id}/measure`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c?{a,b,c}:{a,b})}))}
export async function region(id:string,polygon:number[][]){return parse<RegionResult>(await fetch(`${API}/scenes/${id}/analysis/region`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({polygon})}))}
export async function profile(id:string,p:[number,number],q:[number,number],samples=512){return parse<CrossSection>(await fetch(`${API}/scenes/${id}/analysis/profile`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x1:p[0],y1:p[1],x2:q[0],y2:q[1],samples})}))}
export async function histogram(id:string,bins=64){return parse<Histogram>(await fetch(`${API}/scenes/${id}/analysis/histogram?bins=${bins}`))}
export async function stats(id:string){return parse(await fetch(`${API}/scenes/${id}/analysis/stats`))}
export async function reproject(id:string,p:number[]){return parse(await fetch(`${API}/scenes/${id}/analysis/reproject`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:p[0],y:p[1],z:p[2]})}))}
export async function segment(id:string,score_threshold=.65,max_objects=12){return parse<{status:string;objects:any[]}>(await fetch(`${API}/scenes/${id}/segment`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score_threshold,max_objects})}))}
export async function getSegmentation(id:string){return parse<{status:string;objects:any[]}>(await fetch(`${API}/scenes/${id}/segmentation`))}
export async function getAnnotations(id:string){return parse<{items:any[]}>(await fetch(`${API}/scenes/${id}/annotations`))}
export async function saveAnnotations(id:string,items:any[]){return parse(await fetch(`${API}/scenes/${id}/annotations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})}))}
export async function getState(id:string){return parse(await fetch(`${API}/scenes/${id}/state`))}
export async function saveState(id:string,state:any){return parse(await fetch(`${API}/scenes/${id}/state`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)}))}
export function artifact(id:string,name:string){return `${API}/scenes/${id}/file/${name.split('/').map(encodeURIComponent).join('/')}`}
export function exportZip(id:string){return `${API}/scenes/${id}/export.zip`}
export function eventsUrl(id:string){return `${API}/scenes/${id}/events`}
export async function evaluateDistance(id:string,predicted_distance_m:number,known_distance_m:number){return parse(await fetch(`${API}/scenes/${id}/analysis/evaluate-distance`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({predicted_distance_m,known_distance_m})}))}

export function exportPointsCsv(id:string,limit=200000,lod=0){return `${API}/scenes/${id}/export/points.csv?limit=${limit}&lod=${lod}`}

export async function systemInfo(){return parse<any>(await fetch(`${API}/system`,{cache:"no-store"}))}
