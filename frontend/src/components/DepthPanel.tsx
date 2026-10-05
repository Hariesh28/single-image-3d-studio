import { MediaPanel } from './MediaPanel'
export function DepthPanel({src,min,max}:{src:string;min:number;max:number}){return <MediaPanel src={src} title="METRIC DEPTH" depth min={min} max={max}/>} 
