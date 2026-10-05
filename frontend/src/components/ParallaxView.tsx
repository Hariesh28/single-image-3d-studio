import * as THREE from 'three'
import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { artifact } from '../api/client'
import { useSceneStore } from '../store/useSceneStore'

const VERT=`
precision highp float;
uniform sampler2D uDepth;
uniform float uNear,uFar,uStrength,uYaw,uPitch;
varying vec2 vUv;
void main(){
  vUv=uv;
  float d=texture2D(uDepth,vec2(uv.x,1.0-uv.y)).r;
  float n=clamp((d-uNear)/max(uFar-uNear,0.0001),0.0,1.0);
  float relief=(1.0-n)*uStrength;
  vec3 p=position;
  p.z -= relief;
  p.x += (uv.x-0.5)*relief*0.12*uYaw;
  p.y += (uv.y-0.5)*relief*0.12*uPitch;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`
const FRAG=`
precision highp float;
uniform sampler2D uColor;
uniform float uOpacity;
varying vec2 vUv;
void main(){vec4 c=texture2D(uColor,vUv);gl_FragColor=vec4(c.rgb,c.a*uOpacity);}`

function Plane({imageUrl,depthUrl}:{imageUrl:string;depthUrl:string}){
 const color=useMemo(()=>new THREE.TextureLoader().load(imageUrl),[imageUrl])
 const [depth,setDepth]=useState<THREE.Texture|null>(null)
 const [loaded,setLoaded]=useState(false)
 useEffect(()=>()=>{color.dispose()},[color])
 useEffect(()=>{let live=true;fetch(depthUrl).then(r=>r.arrayBuffer()).then(buf=>{if(!live)return;const dv=new DataView(buf);const magic=dv.getUint32(0,true),w=dv.getUint32(4,true),h=dv.getUint32(8,true);if(magic!==0x44455031)throw new Error('Invalid depth artifact');const values=new Float32Array(buf,12,w*h);const tex=new THREE.DataTexture(values,w,h,THREE.RedFormat,THREE.FloatType);tex.colorSpace=THREE.NoColorSpace;tex.needsUpdate=true;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearFilter;setDepth(tex);setLoaded(true)}).catch(console.error);return()=>{live=false}},[depthUrl])
 const s=useSceneStore();
 const geometry=useMemo(()=>new THREE.PlaneGeometry(4,4,240,180),[])
 useEffect(()=>()=>geometry.dispose(),[geometry])
 useEffect(()=>()=>{if(depth)depth.dispose()},[depth])
 if(!loaded||!depth)return null
 return <mesh geometry={geometry} rotation={[0,0,0]}><shaderMaterial vertexShader={VERT} fragmentShader={FRAG} transparent uniforms={{uColor:{value:color},uDepth:{value:depth},uNear:{value:s.nearDepth},uFar:{value:Math.max(s.farDepth,s.nearDepth+.01)},uStrength:{value:s.parallaxStrength},uYaw:{value:s.parallaxYaw},uPitch:{value:s.parallaxPitch},uOpacity:{value:1}}}/></mesh>
}

export function ParallaxView({imageUrl,depthUrl}:{imageUrl:string;depthUrl:string}){
 const s=useSceneStore()
 const [drag,setDrag]=useState<{x:number;y:number}|null>(null)
 return <div className="parallaxWrap" onPointerDown={e=>setDrag({x:e.clientX,y:e.clientY})} onPointerMove={e=>{if(!drag)return;s.set({parallaxYaw:s.parallaxYaw+(e.clientX-drag.x)*.35,parallaxPitch:s.parallaxPitch+(e.clientY-drag.y)*.35});setDrag({x:e.clientX,y:e.clientY})}} onPointerUp={()=>setDrag(null)} onPointerLeave={()=>setDrag(null)}>
  <Canvas camera={{position:[0,0,5],fov:42}} dpr={[1,1.5]} gl={{antialias:true,powerPreference:'high-performance'}}><ambientLight intensity={1}/><Plane imageUrl={imageUrl} depthUrl={depthUrl}/></Canvas>
  <div className="parallaxHud"><b>DEPTH PARALLAX</b><span>Drag to move the virtual view</span><label>Strength <input type="range" min="0" max="2" step=".01" value={s.parallaxStrength} onChange={e=>s.set({parallaxStrength:+e.target.value})}/></label><button onClick={()=>s.set({parallaxStrength:.65,parallaxYaw:0,parallaxPitch:0})}>Reset</button></div>
 </div>
}
