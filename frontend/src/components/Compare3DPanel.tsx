import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import { artifact } from '../api/client'
import { loadCloud } from '../three/binary'
import type { Scene } from '../types'

function MiniCloud({scene}:{scene:Scene}){
  const [cloud,setCloud]=useState<any>(null)
  useEffect(()=>{let live=true;const url=artifact(scene.scene_id,scene.artifacts.lod2||scene.artifacts.lod3||'pointcloud_lod2.bin');loadCloud(url).then(c=>{if(live)setCloud(c)}).catch(console.error);return()=>{live=false}},[scene.scene_id,scene.artifacts.lod2,scene.artifacts.lod3])
  const geometry=useMemo(()=>{if(!cloud)return null;const budget=Math.min(350000,cloud.count);const stride=Math.max(1,Math.ceil(cloud.count/budget));const n=Math.ceil(cloud.count/stride);const pos=new Float32Array(n*3);const col=new Float32Array(n*3);let j=0;for(let i=0;i<cloud.count;i+=stride){pos[j*3]=cloud.positions[i*3];pos[j*3+1]=cloud.positions[i*3+1];pos[j*3+2]=-cloud.positions[i*3+2];col[j*3]=cloud.colors[i*3]/255;col[j*3+1]=cloud.colors[i*3+1]/255;col[j*3+2]=cloud.colors[i*3+2]/255;j++}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeBoundingSphere();return g},[cloud])
  useEffect(()=>()=>geometry?.dispose(),[geometry])
  return geometry?<points geometry={geometry}><pointsMaterial size={0.028} sizeAttenuation vertexColors transparent opacity={0.92}/></points>:null
}
function MiniScene({scene}:{scene:Scene}){const span=Math.max(scene.depth_max_m,2);return <><color attach="background" args={["#040a11"]}/><ambientLight intensity={.9}/><directionalLight position={[4,6,4]} intensity={1}/><MiniCloud scene={scene}/><gridHelper args={[20,20,"#163647","#0b1b27"]}/><axesHelper args={[2]}/><OrbitControls makeDefault enableDamping dampingFactor={.08} minDistance={.2} maxDistance={Math.max(30,span*4)}/></>}
export function Compare3DPanel({a,b}:{a:Scene;b:Scene}){return <div className="compare3DGrid"><div className="compare3DCard"><div className="compare3DLabel"><b>ACTIVE SCENE</b><span>{a.model_dataset} · {a.calibration.source}</span></div><Canvas camera={{position:[0,1.1,5],fov:55,near:.01,far:200}} dpr={[1,1.5]} fallback={<div className="webglFallback">WebGL unavailable</div>}><MiniScene scene={a}/></Canvas></div><div className="compare3DCard"><div className="compare3DLabel"><b>COMPARE SCENE</b><span>{b.model_dataset} · {b.calibration.source}</span></div><Canvas camera={{position:[0,1.1,5],fov:55,near:.01,far:200}} dpr={[1,1.5]} fallback={<div className="webglFallback">WebGL unavailable</div>}><MiniScene scene={b}/></Canvas></div></div>}
