import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GizmoHelper, GizmoViewport, Grid, Html, Line, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { artifact, getPoint } from '../api/client'
import type { Cloud, ColorMode, Plane, PointInfo, Scene } from '../types'
import { loadCloud } from './binary'
import { useSceneStore } from '../store/useSceneStore'

const VS = `
attribute vec3 aColor;
attribute vec3 aNormal;
attribute float aDepth;
attribute float aObject;
varying vec3 vColor;
varying vec3 vNormal;
varying float vDepth;
varying float vHeight;
varying float vObject;
uniform float uPointSize;
uniform float uNearDepth;
uniform float uFarDepth;
uniform float uHeightMin;
uniform float uHeightMax;
uniform float uMinX;
uniform float uMaxX;
uniform float uMinY;
uniform float uMaxY;
uniform float uMinZ;
uniform float uMaxZ;
uniform float uDepthExaggeration;
uniform float uDepthCenter;
void main(){
  vec3 p = position;
  float displayDepth = uDepthCenter + (aDepth - uDepthCenter) * uDepthExaggeration;
  p.z = -displayDepth;
  vDepth = aDepth;
  vHeight = p.y;
  vColor = aColor;
  vObject = aObject;
  vNormal = length(aNormal) < 0.001 ? vec3(0.0,1.0,0.0) : normalize(aNormal);
  bool clipped = p.x < uMinX || p.x > uMaxX || p.y < uMinY || p.y > uMaxY || aDepth < uNearDepth || aDepth > uFarDepth || aDepth < uMinZ || aDepth > uMaxZ;
  vec4 mv = modelViewMatrix * vec4(p,1.0);
  if(clipped){
    gl_Position = vec4(2.0,2.0,2.0,1.0);
    gl_PointSize = 0.0;
  } else {
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPointSize * (300.0 / max(0.5,aDepth)), 1.0, 30.0);
  }
}`

const FS = `
precision highp float;
varying vec3 vColor;
varying vec3 vNormal;
varying float vDepth;
varying float vHeight;
varying float vObject;
uniform int uColorMode;
uniform bool uUseRgb;
uniform float uDepthMin;
uniform float uDepthMax;
uniform float uHeightMin;
uniform float uHeightMax;
uniform float uOpacity;
vec3 turbo(float x){
  x=clamp(x,0.0,1.0);
  vec4 r=vec4(.13572138,4.6153926,-42.66032258,132.13108234);
  vec4 g=vec4(.09140261,2.19418839,4.84296658,-14.18503333);
  vec4 b=vec4(.1066733,3.15418769,.55723179,-8.7729729);
  vec2 r2=vec2(-152.94239396,59.28637943),g2=vec2(4.27729857,2.82956604),b2=vec2(15.97846570,-19.58213689);
  vec4 q=vec4(1.0,x,x*x,x*x*x); vec2 z=q.zw*q.z;
  return clamp(vec3(dot(q,r)+dot(z,r2),dot(q,g)+dot(z,g2),dot(q,b)+dot(z,b2)),0.0,1.0);
}
void main(){
  vec2 c=gl_PointCoord-.5;
  if(dot(c,c)>.25) discard;
  vec3 color=vColor;
  if(uColorMode==1) color=turbo(1.0-smoothstep(uDepthMin,uDepthMax,vDepth));
  else if(uColorMode==2) color=turbo(smoothstep(uHeightMin,uHeightMax,vHeight));
  else if(uColorMode==3) color=abs(normalize(vNormal))*.5+.5;
  else if(uColorMode==4) color=vObject>.5?vec3(.25,.92,1.0):vec3(.08,.15,.19);
  if(!uUseRgb && uColorMode==0) color=vec3(.85,.91,.96);
  gl_FragColor=vec4(color,uOpacity);
}`

function cvPoint(p: [number, number, number], exaggeration = 1, centerZ = 0) {
  const displayDepth = centerZ + (p[2] - centerZ) * exaggeration
  return new THREE.Vector3(p[0], p[1], -displayDepth)
}
function cvPlaneNormal(n: [number, number, number]) { return new THREE.Vector3(n[0], n[1], -n[2]).normalize() }
function finiteClip(value: number, fallback: number) { return Number.isFinite(value) ? value : fallback }

function cloudBounds(cloud: Cloud, exaggeration: number) {
  const centerZ = (cloud.min[2] + cloud.max[2]) / 2
  const min = cvPoint([cloud.min[0], cloud.min[1], cloud.min[2]], exaggeration, centerZ)
  const max = cvPoint([cloud.max[0], cloud.max[1], cloud.max[2]], exaggeration, centerZ)
  const xMin = Math.min(min.x, max.x); const xMax = Math.max(min.x, max.x)
  const yMin = Math.min(min.y, max.y); const yMax = Math.max(min.y, max.y)
  const zMin = Math.min(min.z, max.z); const zMax = Math.max(min.z, max.z)
  return { box: new THREE.Box3(new THREE.Vector3(xMin, yMin, zMin), new THREE.Vector3(xMax, yMax, zMax)), centerZ }
}

export function PointCloudScene() {
  const s = useSceneStore()
  const scene = s.scene as Scene | null
  const sceneId = s.sceneId
  const { camera, raycaster } = useThree()
  const controls = useRef<any>(null)
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const [fps, setFps] = useState(60)
  const frames = useRef({ n: 0, t: performance.now() })
  const adaptiveBudget = useAdaptiveBudget(s.pointBudget, s.adaptiveLod, fps)

  useEffect(() => {
    if (!scene) return
    let alive = true
    const file = scene.artifacts[`lod${Math.min(3, s.density)}`]
    if (!file) { setCloud(null); return }
    setCloud(null)
    loadCloud(artifact(scene.scene_id, file)).then((value) => alive && setCloud(value)).catch((error) => { console.error('Point cloud load failed', error); if (alive) setCloud(null) })
    return () => { alive = false }
  }, [scene?.scene_id, scene?.artifacts, s.density])

  useEffect(() => {
    if (!cloud) return
    const { box } = cloudBounds(cloud, s.depthExaggeration)
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.05)
    raycaster.params.Points = raycaster.params.Points || {}
    raycaster.params.Points.threshold = Math.max(0.01, Math.min(0.15, radius * 0.018))
  }, [cloud, s.depthExaggeration, raycaster])

  useFrame(() => { frames.current.n += 1 })
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now(); const f = frames.current; const dt = (now - f.t) / 1000
      if (dt > 0.1) { setFps(f.n / dt); f.n = 0; f.t = now }
    }, 500)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!scene || !cloud) return
    const { box } = cloudBounds(cloud, s.depthExaggeration)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const center = sphere.center.clone()
    const radius = Math.max(sphere.radius, 0.05)
    const perspective = camera as THREE.PerspectiveCamera
    const fov = THREE.MathUtils.degToRad(perspective.fov || 55)
    const distance = Math.max((radius / Math.tan(Math.max(fov * 0.5, 0.05))) * 1.55, radius * 2.3, 0.5)
    perspective.position.copy(center).add(new THREE.Vector3(distance * 0.32, distance * 0.16, distance))
    perspective.near = Math.max(0.01, radius * 0.001)
    perspective.far = Math.max(50, distance + radius * 12)
    perspective.updateProjectionMatrix()
    controls.current?.target.copy(center)
    controls.current?.update()
  }, [scene?.scene_id, cloud, s.resetCameraKey, s.cameraView, s.depthExaggeration, camera])

  useEffect(() => {
    if (!scene || !cloud || s.cameraView === 'home') return
    const { box } = cloudBounds(cloud, s.depthExaggeration)
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const center = sphere.center.clone(); const radius = Math.max(sphere.radius, 0.5)
    const perspective = camera as THREE.PerspectiveCamera
    const fov = THREE.MathUtils.degToRad(perspective.fov || 55)
    const d = Math.max((radius / Math.tan(Math.max(fov * .5, .05))) * 1.55, radius * 2.2)
    let pos = center.clone().add(new THREE.Vector3(d * .32, d * .18, d))
    let target = center.clone()
    if (s.cameraView === 'front') pos = center.clone().add(new THREE.Vector3(0, 0, d))
    if (s.cameraView === 'top') pos = center.clone().add(new THREE.Vector3(0, d, 0))
    if (s.cameraView === 'left') pos = center.clone().add(new THREE.Vector3(-d, 0, 0))
    if (s.cameraView === 'right') pos = center.clone().add(new THREE.Vector3(d, 0, 0))
    if (s.cameraView === 'selected' && s.selected) {
      const centerZ = (cloud.min[2] + cloud.max[2]) / 2
      target = cvPoint([s.selected.x_m, s.selected.y_m, s.selected.z_m], s.depthExaggeration, centerZ)
      pos = target.clone().add(new THREE.Vector3(d * .32, d * .2, d))
    }
    perspective.position.copy(pos); perspective.near = Math.max(0.01, radius * 0.001); perspective.far = Math.max(50, d + radius * 12); perspective.lookAt(target); perspective.updateProjectionMatrix()
    controls.current?.target.copy(target); controls.current?.update()
  }, [scene?.scene_id, cloud, s.cameraView, s.resetCameraKey, s.selected, s.depthExaggeration, camera])

  if (!scene) return null
  const ground = groundThreeTransform(scene)
  const heightRange: [number, number] = cloud ? [cloud.min[1], Math.max(cloud.max[1], cloud.min[1] + 0.01)] : [-1, 1]
  const selectedObject = scene.segmentation.objects.find((o: any) => o.id === s.selectedObjectId)
  const centerZ = cloud ? (cloud.min[2] + cloud.max[2]) / 2 : scene.depth_max_m / 2

  return <>
    <color attach="background" args={[s.background]} />
    <ambientLight intensity={0.8} />
    <directionalLight position={[5, 8, 4]} intensity={1} />
    {s.showGrid && <Grid args={[40, 40]} cellSize={.5} cellThickness={.35} sectionSize={5} sectionThickness={.9} fadeDistance={50} fadeStrength={1} />}
    {s.showAxes && <axesHelper args={[3]} />}
    {!cloud && <Html center style={{ pointerEvents: 'none' }}><div className="webglFallback">Loading 3D point cloud…</div></Html>}
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.08} minDistance={.03} maxDistance={500} />
    {cloud && <group quaternion={s.showGround && ground ? ground.q : undefined} position={s.showGround && ground ? ground.pos : undefined}>
      <CloudObject
        cloud={cloud}
        sceneId={sceneId}
        selectedObjectMask={selectedObject ? artifact(scene.scene_id, selectedObject.mask_artifact) : undefined}
        pointSize={s.pointSize}
        pointBudget={adaptiveBudget}
        colorMode={s.colorMode}
        rgb={s.rgb}
        nearDepth={s.nearDepth}
        farDepth={s.farDepth}
        opacity={s.pointOpacity}
        heightRange={heightRange}
        minX={s.minX} maxX={s.maxX} minY={s.minY} maxY={s.maxY} minZ={s.minZ} maxZ={s.maxZ}
        depthExaggeration={s.depthExaggeration}
        depthCenter={centerZ}
      />
      {s.selected && <SelectionMarker point={s.selected} showLabel={s.showLabels} exaggeration={s.depthExaggeration} centerZ={centerZ} />}
      {s.showLabels && s.annotations.map((a) => <AnnotationMarker key={a.id} annotation={a} exaggeration={s.depthExaggeration} centerZ={centerZ} />)}
      {s.selected && <CameraRay point={s.selected} exaggeration={s.depthExaggeration} centerZ={centerZ} />}
      {s.measurementA && s.measurementB && <MeasurementLine a={s.measurementA} b={s.measurementB} exaggeration={s.depthExaggeration} centerZ={centerZ} />}
      {s.measurementA && s.measurementB && s.measurementC && <AngleOverlay a={s.measurementA} b={s.measurementB} c={s.measurementC} exaggeration={s.depthExaggeration} centerZ={centerZ} />}
      {s.showPlanes && scene.planes.map((p) => <PlaneOverlay key={p.id} plane={p} exaggeration={s.depthExaggeration} centerZ={centerZ} />)}
      {selectedObject && <ObjectBounds object={selectedObject} exaggeration={s.depthExaggeration} centerZ={centerZ} />}
      {s.showMesh && scene.artifacts.mesh_glb && <MeshObject url={artifact(scene.scene_id, scene.artifacts.mesh_glb)} exaggeration={s.depthExaggeration} centerZ={centerZ} />}
    </group>}
    {s.showFrustum && <CameraFrustum scene={scene} exaggeration={s.depthExaggeration} centerZ={centerZ} />}
    {s.showCamera && <CameraMarker />}
    <GizmoHelper alignment="bottom-right" margin={[70, 70]}><GizmoViewport labelColor="#eefaff" axisColors={['#ff677b', '#6be58e', '#72aaff']} /></GizmoHelper>
    <Html position={[0, 0, 0]} style={{ pointerEvents: 'none' }}><div className="fpsHud">{fps.toFixed(0)} FPS · source {cloud?.count.toLocaleString() || 0} · render {Math.min(adaptiveBudget, cloud?.count || 0).toLocaleString()} · depth x{s.depthExaggeration.toFixed(1)}</div></Html>
  </>
}

function useAdaptiveBudget(base: number, adaptive: boolean, fps: number) {
  const [value, setValue] = useState(base)
  useEffect(() => {
    if (!adaptive) { setValue(base); return }
    if (fps < 24) setValue(Math.max(100000, Math.floor(base * .35)))
    else if (fps < 32) setValue(Math.max(100000, Math.floor(base * .55)))
    else if (fps < 42) setValue(Math.max(100000, Math.floor(base * .78)))
    else setValue(base)
  }, [base, adaptive, fps])
  return value
}

function CloudObject(p: {
  cloud: Cloud
  sceneId: string | null
  selectedObjectMask?: string
  pointSize: number
  pointBudget: number
  colorMode: ColorMode
  rgb: boolean
  nearDepth: number
  farDepth: number
  opacity: number
  heightRange: [number, number]
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number
  depthExaggeration: number
  depthCenter: number
}) {
  const geometry = useMemo(() => {
    const budget = Math.max(1, p.pointBudget)
    const stride = Math.max(1, Math.ceil(p.cloud.count / budget))
    const count = Math.ceil(p.cloud.count / stride)
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const nor = new Float32Array(count * 3)
    const dep = new Float32Array(count)
    const obj = new Float32Array(count)
    const pix = new Uint32Array(count)
    let j = 0
    for (let i = 0; i < p.cloud.count; i += stride) {
      const rawX = p.cloud.positions[i * 3]
      const rawY = p.cloud.positions[i * 3 + 1]
      const rawZ = p.cloud.positions[i * 3 + 2]
      const displayZ = p.depthCenter + (rawZ - p.depthCenter) * p.depthExaggeration
      pos[j * 3] = rawX
      pos[j * 3 + 1] = rawY
      pos[j * 3 + 2] = -displayZ
      col[j * 3] = p.cloud.colors[i * 3] / 255
      col[j * 3 + 1] = p.cloud.colors[i * 3 + 1] / 255
      col[j * 3 + 2] = p.cloud.colors[i * 3 + 2] / 255
      if (p.cloud.normals) {
        nor[j * 3] = p.cloud.normals[i * 3]
        nor[j * 3 + 1] = p.cloud.normals[i * 3 + 1]
        nor[j * 3 + 2] = -p.cloud.normals[i * 3 + 2]
      }
      dep[j] = rawZ
      pix[j] = p.cloud.pixels[i]
      j++
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const colorAttr = new THREE.BufferAttribute(col, 3)
    g.setAttribute('color', colorAttr)
    g.setAttribute('aColor', colorAttr)
    g.setAttribute('aNormal', new THREE.BufferAttribute(nor, 3))
    g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1))
    g.setAttribute('aObject', new THREE.BufferAttribute(obj, 1))
    g.userData.pixelIds = pix
    g.userData.sourceCount = p.cloud.count
    g.computeBoundingSphere()
    return g
  }, [p.cloud, p.pointBudget, p.depthExaggeration, p.depthCenter])

  useEffect(() => () => geometry.dispose(), [geometry])

  const uniformValues = useMemo(() => ({
    uPointSize: Math.max(.25, p.pointSize), uNearDepth: Math.max(.001, p.nearDepth), uFarDepth: Math.max(p.farDepth, p.nearDepth + .01),
    uColorMode: ({ rgb: 0, depth: 1, height: 2, normal: 3, object: 4 } as Record<string, number>)[p.colorMode], uUseRgb: p.rgb,
    uDepthMin: Math.max(p.nearDepth, .01), uDepthMax: Math.max(p.farDepth, p.nearDepth + .01), uHeightMin: p.heightRange[0], uHeightMax: Math.max(p.heightRange[1], p.heightRange[0] + .01), uOpacity: p.opacity,
    uMinX: finiteClip(p.minX, -1e9), uMaxX: finiteClip(p.maxX, 1e9), uMinY: finiteClip(p.minY, -1e9), uMaxY: finiteClip(p.maxY, 1e9), uMinZ: finiteClip(p.minZ, -1e9), uMaxZ: finiteClip(p.maxZ, 1e9),
    uDepthExaggeration: Math.max(.1, p.depthExaggeration), uDepthCenter: p.depthCenter,
  }), [p.pointSize,p.nearDepth,p.farDepth,p.colorMode,p.rgb,p.heightRange,p.opacity,p.minX,p.maxX,p.minY,p.maxY,p.minZ,p.maxZ,p.depthExaggeration,p.depthCenter])

  const rgbMaterial = useMemo(() => new THREE.PointsMaterial({ size: Math.max(.018, Math.min(.14, p.pointSize * .028)), sizeAttenuation: true, vertexColors: true, transparent: true, opacity: p.opacity, depthWrite: true, depthTest: true, alphaTest: .01, toneMapped: false }), [p.pointSize,p.opacity])
  useEffect(() => () => rgbMaterial.dispose(), [rgbMaterial])

  const shaderMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    uniforms: Object.fromEntries(Object.entries(uniformValues).map(([key, value]) => [key, { value }])),
  }), [])
  useEffect(() => { Object.entries(uniformValues).forEach(([key, value]) => { if (shaderMaterial.uniforms[key]) shaderMaterial.uniforms[key].value = value }) }, [shaderMaterial, uniformValues])
  useEffect(() => () => shaderMaterial.dispose(), [shaderMaterial])

  useEffect(() => {
    const attr = geometry.getAttribute('aObject') as THREE.BufferAttribute | undefined
    if (!attr) return
    const values = attr.array as Float32Array
    values.fill(0); attr.needsUpdate = true
    if (!p.selectedObjectMask) return
    let live = true
    const image = new Image(); image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (!live) return
      const canvas = document.createElement('canvas'); canvas.width = p.cloud.width; canvas.height = p.cloud.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return
      ctx.drawImage(image, 0, 0, p.cloud.width, p.cloud.height)
      const data = ctx.getImageData(0,0,p.cloud.width,p.cloud.height).data
      const ids = geometry.userData.pixelIds as Uint32Array
      for (let i = 0; i < ids.length; i++) values[i] = data[ids[i] * 4] > 32 ? 1 : 0
      attr.needsUpdate = true; canvas.width = 1; canvas.height = 1
    }
    image.onerror = () => console.warn('Object mask failed to load')
    image.src = p.selectedObjectMask
    return () => { live = false; image.onload = null }
  }, [geometry, p.cloud.width, p.cloud.height, p.selectedObjectMask])

  const click = async (event: any) => {
    event.stopPropagation()
    if (!p.sceneId || event.index == null) return
    const ids = geometry.userData.pixelIds as Uint32Array
    const pointIndex = Math.max(0, Math.min(ids.length - 1, event.index))
    const pixelId = ids[pointIndex]
    const x = pixelId % p.cloud.width
    const y = Math.floor(pixelId / p.cloud.width)
    try {
      const info = await getPoint(p.sceneId, x, y)
      const state = useSceneStore.getState()
      if (state.tool === 'measure') {
        const slot = state.measureSlot
        const payload: any = { selected: info, hover: info, rightPanel: 'measure' }
        if (slot === 'A') { payload.measurementA = info; payload.measureSlot = 'B' }
        else if (slot === 'B') { payload.measurementB = info; payload.measureSlot = 'C' }
        else { payload.measurementC = info; payload.measureSlot = 'A' }
        state.set(payload)
      } else state.set({ selected: info, hover: info })
    } catch (error) { console.error('Point lookup failed', error) }
  }

  if (!p.cloud.count || !geometry.attributes.position) return null
  return <points geometry={geometry} material={p.colorMode === 'rgb' ? rgbMaterial : shaderMaterial} frustumCulled={false} onClick={click} />
}

function AnnotationMarker({ annotation, exaggeration, centerZ }: { annotation: any; exaggeration: number; centerZ: number }) {
  const q = cvPoint([annotation.point.x_m, annotation.point.y_m, annotation.point.z_m], exaggeration, centerZ)
  return <><mesh position={q}><sphereGeometry args={[.045,12,12]} /><meshBasicMaterial color={annotation.color || '#67e8f9'} /></mesh><Html position={q} distanceFactor={10} style={{ pointerEvents: 'none' }}><div className="annotation3DLabel"><b>{annotation.name}</b><span>{annotation.point.x_m.toFixed(2)}, {annotation.point.y_m.toFixed(2)}, {annotation.point.z_m.toFixed(2)} m</span></div></Html></>
}
function CameraRay({ point, exaggeration, centerZ }: { point: PointInfo; exaggeration: number; centerZ: number }) { return <Line points={[new THREE.Vector3(0,0,0), cvPoint([point.x_m, point.y_m, point.z_m], exaggeration, centerZ)]} color="#5de1ff" lineWidth={1} transparent opacity={.38} /> }
function SelectionMarker({ point, showLabel, exaggeration, centerZ }: { point: PointInfo; showLabel: boolean; exaggeration: number; centerZ: number }) {
  const q = cvPoint([point.x_m, point.y_m, point.z_m], exaggeration, centerZ)
  return <><mesh position={q}><sphereGeometry args={[.06,16,16]} /><meshStandardMaterial color="#dffcff" emissive="#39ddff" emissiveIntensity={2.8} /></mesh>{showLabel&&<Html position={q} distanceFactor={8}><div className="threeLabel"><b>Selected</b><span>{point.x_m.toFixed(3)}, {point.y_m.toFixed(3)}, {point.z_m.toFixed(3)} m</span></div></Html>}</>
}
function MeasurementLine({ a,b,exaggeration,centerZ }:{a:PointInfo;b:PointInfo;exaggeration:number;centerZ:number}) { const p1=cvPoint([a.x_m,a.y_m,a.z_m],exaggeration,centerZ),p2=cvPoint([b.x_m,b.y_m,b.z_m],exaggeration,centerZ),m=p1.clone().add(p2).multiplyScalar(.5);return <><Line points={[p1,p2]} color="#f4fbff" lineWidth={2}/><Html position={m} distanceFactor={9}><div className="measureLabel">{Math.hypot(b.x_m-a.x_m,b.y_m-a.y_m,b.z_m-a.z_m).toFixed(3)} m</div></Html></> }
function AngleOverlay({a,b,c,exaggeration,centerZ}:{a:PointInfo;b:PointInfo;c:PointInfo;exaggeration:number;centerZ:number}) { const pa=cvPoint([a.x_m,a.y_m,a.z_m],exaggeration,centerZ),pb=cvPoint([b.x_m,b.y_m,b.z_m],exaggeration,centerZ),pc=cvPoint([c.x_m,c.y_m,c.z_m],exaggeration,centerZ);const v1=new THREE.Vector3(a.x_m-b.x_m,a.y_m-b.y_m,a.z_m-b.z_m),v2=new THREE.Vector3(c.x_m-b.x_m,c.y_m-b.y_m,c.z_m-b.z_m);const n1=v1.length(),n2=v2.length();const ang=n1<1e-12||n2<1e-12?null:THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v1.dot(v2)/(n1*n2),-1,1)));return <><Line points={[pa,pb,pc]} color="#ffcc66" lineWidth={1.5}/>{ang!=null&&<Html position={pb} distanceFactor={8}><div className="measureLabel">∠ {ang.toFixed(1)}°</div></Html>}</> }
function PlaneOverlay({ plane, exaggeration, centerZ }: { plane: Plane; exaggeration: number; centerZ: number }) { const pos=cvPoint(plane.center, exaggeration, centerZ); const n0=new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]*exaggeration).normalize(); const n=new THREE.Vector3(n0.x,n0.y,-n0.z); const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),n.normalize()); const size=Math.max(.5,Math.min(8,Math.sqrt(plane.inliers)/80)); return <mesh position={pos} quaternion={q}><planeGeometry args={[size,size]}/><meshBasicMaterial transparent opacity={.12} side={THREE.DoubleSide}/></mesh> }
function ObjectBounds({ object, exaggeration, centerZ }:{object:any;exaggeration:number;centerZ:number}) { if(!object.xyz_min||!object.xyz_max)return null;const mn=cvPoint([object.xyz_min[0],object.xyz_min[1],object.xyz_min[2]],exaggeration,centerZ),mx=cvPoint([object.xyz_max[0],object.xyz_max[1],object.xyz_max[2]],exaggeration,centerZ),center=mn.clone().add(mx).multiplyScalar(.5),size=new THREE.Vector3(Math.abs(mx.x-mn.x),Math.abs(mx.y-mn.y),Math.abs(mx.z-mn.z));return <mesh position={center}><boxGeometry args={[Math.max(size.x,.001),Math.max(size.y,.001),Math.max(size.z,.001)]}/><meshBasicMaterial wireframe transparent opacity={.65}/></mesh> }
function CameraFrustum({scene, exaggeration, centerZ}:{scene:Scene; exaggeration:number; centerZ:number}) { const z=Math.min(Math.max(scene.depth_max_m*.18,2),12),fx=scene.calibration.fx,fy=scene.calibration.fy,cx=scene.calibration.cx,cy=scene.calibration.cy,w=scene.width,h=scene.height;const far=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>cvPoint([(x-cx)*z/fx,-(y-cy)*z/fy,z], exaggeration, centerZ));const origin=new THREE.Vector3(0,0,0);return <>{far.length&&<Line points={[...far,far[0]]} color="#63e2ff" lineWidth={1.2} transparent opacity={.7}/>} {far.map((p,i)=><Line key={i} points={[origin,p]} color="#63e2ff" lineWidth={1.1} transparent opacity={.55}/>)}</> }
function CameraMarker(){return <mesh position={[0,0,0]}><sphereGeometry args={[.08,16,16]}/><meshBasicMaterial color="#63e2ff"/></mesh>}
function MeshObject({url, exaggeration, centerZ}:{url:string; exaggeration:number; centerZ:number}){const[obj,setObj]=useState<THREE.Object3D|null>(null);useEffect(()=>{let live=true;import('three/examples/jsm/loaders/GLTFLoader.js').then(({GLTFLoader})=>new GLTFLoader().load(url,g=>{if(!live)return;g.scene.traverse((node:any)=>{const mats=node.material?(Array.isArray(node.material)?node.material:[node.material]):[];mats.forEach((m:any)=>{m.side=THREE.DoubleSide;m.transparent=true;m.opacity=.42;m.depthWrite=false})});g.scene.scale.z=-1;setObj(g.scene)}));return()=>{live=false}},[url]);useEffect(()=>{if(!obj)return;obj.scale.z=-1*exaggeration;obj.position.z=centerZ*(exaggeration-1);return()=>{if(obj) obj.position.z=0}},[obj,exaggeration,centerZ]);return obj?<primitive object={obj}/>:null}
function groundThreeTransform(scene: Scene) { if(!scene.ground_transform)return null;const r=scene.ground_transform.rotation;const C=new THREE.Matrix4().set(1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1);const Rcv=new THREE.Matrix4().set(r[0][0],r[0][1],r[0][2],0,r[1][0],r[1][1],r[1][2],0,r[2][0],r[2][1],r[2][2],0,0,0,0,1);const q=new THREE.Quaternion().setFromRotationMatrix(C.clone().multiply(Rcv).multiply(C));const t=scene.ground_transform.translation;return{q,pos:new THREE.Vector3(t[0],t[1],-t[2])}}
