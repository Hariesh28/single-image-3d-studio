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
void main(){
  vec3 p = position;
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
  }else{
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPointSize * (300.0 / max(0.5,aDepth)), 1.0, 26.0);
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
  vec4 q=vec4(1.0,x,x*x,x*x*x);
  vec2 z=q.zw*q.z;
  return vec3(dot(q,r)+dot(z,r2),dot(q,g)+dot(z,g2),dot(q,b)+dot(z,b2));
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
  if(uColorMode!=4 && vObject>.5) color=mix(color,vec3(.35,.95,1.0),.14);
  gl_FragColor=vec4(color,uOpacity);
}`

function cvPoint(p: [number, number, number]) { return new THREE.Vector3(p[0], p[1], -p[2]) }
function cvPlaneNormal(n: [number, number, number]) { return new THREE.Vector3(n[0], n[1], -n[2]).normalize() }

function groundThreeTransform(scene: Scene) {
  if (!scene.ground_transform) return null
  const r = scene.ground_transform.rotation
  const c = new THREE.Matrix4().fromArray([1,0,0,0,0,1,0,0,0,0,-1,0,0,0,0,1])
  const Rcv = new THREE.Matrix4().set(
    r[0][0],r[0][1],r[0][2],0,
    r[1][0],r[1][1],r[1][2],0,
    r[2][0],r[2][1],r[2][2],0,
    0,0,0,1,
  )
  const Rthree = c.clone().multiply(Rcv).multiply(c)
  const q = new THREE.Quaternion().setFromRotationMatrix(Rthree)
  const t = scene.ground_transform.translation
  return { q, pos: new THREE.Vector3(t[0], t[1], -t[2]) }
}

function finiteClip(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

export function PointCloudScene() {
  const s = useSceneStore()
  const scene = s.scene
  const sceneId = s.sceneId
  const { camera, raycaster } = useThree()
  const controls = useRef<any>(null)
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const [fps, setFps] = useState(60)
  const frames = useRef({ n: 0, t: performance.now() })
  const adaptiveBudget = useAdaptiveBudget(s.pointBudget, s.adaptiveLod, fps)

  useEffect(() => {
    raycaster.params.Points = raycaster.params.Points || { threshold: 0.1 }
  }, [raycaster])

  useEffect(() => {
    if (!scene) return
    let alive = true
    const file = scene.artifacts[`lod${Math.min(3, s.density)}`]
    if (!file) {
      setCloud(null)
      return
    }
    setCloud(null)
    loadCloud(artifact(scene.scene_id, file))
      .then((c) => alive && setCloud(c))
      .catch((e) => { console.error('Point cloud load failed', e); alive && setCloud(null) })
    return () => { alive = false }
  }, [scene, scene?.scene_id, s.density])

  useFrame(() => { frames.current.n++ })

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now()
      const f = frames.current
      const dt = (now - f.t) / 1000
      if (dt > 0.1) {
        setFps(f.n / dt)
        f.n = 0
        f.t = now
      }
    }, 500)
    return () => clearInterval(id)
  }, [])

  // Keep the camera focused on the actual reconstructed bounds, not merely on
  // the scalar max-depth value. This is essential for portrait/small scenes.
  useEffect(() => {
    if (!scene || !cloud || s.cameraView !== 'home') return
    const min = cvPoint([cloud.min[0], cloud.min[1], cloud.max[2]])
    const max = cvPoint([cloud.max[0], cloud.max[1], cloud.min[2]])
    const box = new THREE.Box3(min, max)
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.5)
    const distance = Math.max(radius * 2.4, 2.0)
    camera.position.copy(center).add(new THREE.Vector3(distance * 0.35, distance * 0.22, distance))
    camera.lookAt(center)
    camera.near = Math.max(0.01, radius / 100)
    camera.far = Math.max(200, radius * 20)
    if (controls.current) {
      controls.current.target.copy(center)
      controls.current.update()
    }
  }, [camera, cloud, scene, s.cameraView])

  useEffect(() => {
    if (!scene) return
    if (s.cameraView === 'home') return
    const center = cloud
      ? new THREE.Box3(cvPoint([cloud.min[0], cloud.min[1], cloud.max[2]]), cvPoint([cloud.max[0], cloud.max[1], cloud.min[2]])).getCenter(new THREE.Vector3())
      : new THREE.Vector3(0, 0, -Math.max(scene.depth_max_m * 0.4, 1))
    const sphereRadius = cloud
      ? Math.max(new THREE.Box3(cvPoint([cloud.min[0], cloud.min[1], cloud.max[2]]), cvPoint([cloud.max[0], cloud.max[1], cloud.min[2]])).getBoundingSphere(new THREE.Sphere()).radius, 0.5)
      : Math.max(scene.depth_max_m * 0.3, 1)
    const d = Math.max(sphereRadius * 2.5, 2)
    let pos = center.clone().add(new THREE.Vector3(d * .35, d * .2, d))
    let target = center.clone()
    if (s.cameraView === 'front') pos = center.clone().add(new THREE.Vector3(0, 0, d))
    else if (s.cameraView === 'top') pos = center.clone().add(new THREE.Vector3(0, d, 0))
    else if (s.cameraView === 'left') pos = center.clone().add(new THREE.Vector3(-d, 0, 0))
    else if (s.cameraView === 'right') pos = center.clone().add(new THREE.Vector3(d, 0, 0))
    else if (s.cameraView === 'selected' && s.selected) {
      target = cvPoint([s.selected.x_m, s.selected.y_m, s.selected.z_m])
      pos = target.clone().add(new THREE.Vector3(d * .35, d * .25, d))
    }
    camera.position.copy(pos)
    camera.lookAt(target)
    camera.near = Math.max(.01, sphereRadius / 100)
    camera.far = Math.max(200, sphereRadius * 20)
    if (controls.current) {
      controls.current.target.copy(target)
      controls.current.update()
    }
  }, [camera, cloud, scene, s.cameraView, s.resetCameraKey, s.selected])

  if (!scene) return null

  const ground = groundThreeTransform(scene)
  const heightRange: [number, number] = cloud
    ? [cloud.min[1], Math.max(cloud.max[1], cloud.min[1] + 0.01)]
    : [-1, 1]
  const selectedObject = scene.segmentation.objects.find((o) => o.id === s.selectedObjectId)

  return <>
    <color attach="background" args={[s.background]} />
    <ambientLight intensity={0.7} />
    <directionalLight position={[5, 8, 4]} intensity={1} />
    {s.showGrid && <Grid args={[40, 40]} cellSize={.5} cellThickness={.35} sectionSize={5} sectionThickness={.9} fadeDistance={50} fadeStrength={1} />}
    {s.showAxes && <axesHelper args={[3]} />}
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.08} minDistance={.08} maxDistance={300} />

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
        minX={s.minX}
        maxX={s.maxX}
        minY={s.minY}
        maxY={s.maxY}
        minZ={s.minZ}
        maxZ={s.maxZ}
      />
      {s.selected && <SelectionMarker point={s.selected} showLabel={s.showLabels} />}
      {s.showLabels && s.annotations.map((a) => <AnnotationMarker key={a.id} annotation={a} />)}
      {s.selected && <CameraRay point={s.selected} />}
      {s.measurementA && s.measurementB && <MeasurementLine a={s.measurementA} b={s.measurementB} />}
      {s.measurementA && s.measurementB && s.measurementC && <AngleOverlay a={s.measurementA} b={s.measurementB} c={s.measurementC} />}
      {s.showPlanes && scene.planes.map((p) => <PlaneOverlay key={p.id} plane={p} />)}
      {selectedObject && <ObjectBounds object={selectedObject} />}
      {s.showMesh && scene.artifacts.mesh_glb && <MeshObject url={artifact(scene.scene_id, scene.artifacts.mesh_glb)} />}
    </group>}

    {s.showFrustum && <CameraFrustum scene={scene} />}
    {s.showCamera && <CameraMarker />}
    <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
      <GizmoViewport labelColor="#eefaff" axisColors={['#ff677b', '#6be58e', '#72aaff']} labelStyle={{ fontSize: '11px', fontWeight: 700 }} />
    </GizmoHelper>
    <Html position={[.01, -.01, .01]} style={{ pointerEvents: 'none' }}>
      <div className="fpsHud">{fps.toFixed(0)} FPS · {cloud?.count.toLocaleString() || 0} points · render {Math.min(adaptiveBudget, cloud?.count || 0).toLocaleString()}</div>
    </Html>
  </>
}

function useAdaptiveBudget(base: number, adaptive: boolean, fps: number) {
  const [v, setV] = useState(base)
  useEffect(() => {
    if (!adaptive) { setV(base); return }
    if (fps < 24) setV(Math.max(100000, Math.floor(base * .4)))
    else if (fps < 32) setV(Math.max(100000, Math.floor(base * .65)))
    else if (fps < 42) setV(Math.max(100000, Math.floor(base * .82)))
    else setV(base)
  }, [base, adaptive, fps])
  return v
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
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}) {
  const geometry = useMemo(() => {
    const pointBudget = Math.max(1, p.pointBudget)
    const stride = Math.max(1, Math.ceil(p.cloud.count / pointBudget))
    const count = Math.ceil(p.cloud.count / stride)
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const nor = new Float32Array(count * 3)
    const dep = new Float32Array(count)
    const obj = new Float32Array(count)
    const pix = new Uint32Array(count)
    let j = 0
    for (let i = 0; i < p.cloud.count; i += stride) {
      pos[j * 3] = p.cloud.positions[i * 3]
      pos[j * 3 + 1] = p.cloud.positions[i * 3 + 1]
      pos[j * 3 + 2] = -p.cloud.positions[i * 3 + 2]
      col[j * 3] = p.cloud.colors[i * 3] / 255
      col[j * 3 + 1] = p.cloud.colors[i * 3 + 1] / 255
      col[j * 3 + 2] = p.cloud.colors[i * 3 + 2] / 255
      if (p.cloud.normals) {
        nor[j * 3] = p.cloud.normals[i * 3]
        nor[j * 3 + 1] = p.cloud.normals[i * 3 + 1]
        nor[j * 3 + 2] = -p.cloud.normals[i * 3 + 2]
      }
      dep[j] = p.cloud.positions[i * 3 + 2]
      pix[j] = p.cloud.pixels[i]
      j++
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aNormal', new THREE.BufferAttribute(nor, 3))
    g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1))
    g.setAttribute('aObject', new THREE.BufferAttribute(obj, 1))
    g.userData.pixelIds = pix
    g.userData.sourceCount = p.cloud.count
    g.computeBoundingSphere()
    return g
  }, [p.cloud, p.pointBudget])

  useEffect(() => () => geometry.dispose(), [geometry])

  const uniformValues = useMemo(() => ({
    uPointSize: Math.max(.25, p.pointSize),
    uNearDepth: Math.max(0.001, p.nearDepth),
    uFarDepth: Math.max(p.farDepth, p.nearDepth + .01),
    uColorMode: ({ rgb: 0, depth: 1, height: 2, normal: 3, object: 4 } as Record<string, number>)[p.colorMode],
    uUseRgb: p.rgb,
    uDepthMin: Math.max(p.nearDepth, .01),
    uDepthMax: Math.max(p.farDepth, p.nearDepth + .01),
    uHeightMin: p.heightRange[0],
    uHeightMax: Math.max(p.heightRange[1], p.heightRange[0] + .01),
    uOpacity: p.opacity,
    uMinX: finiteClip(p.minX, -1e9),
    uMaxX: finiteClip(p.maxX, 1e9),
    uMinY: finiteClip(p.minY, -1e9),
    uMaxY: finiteClip(p.maxY, 1e9),
    uMinZ: finiteClip(p.minZ, -1e9),
    uMaxZ: finiteClip(p.maxZ, 1e9),
  }), [p.pointSize,p.nearDepth,p.farDepth,p.colorMode,p.rgb,p.heightRange,p.opacity,p.minX,p.maxX,p.minY,p.maxY,p.minZ,p.maxZ])

  // RGB uses the battle-tested built-in material. The shader is still used for
  // the analytical color modes. This gives us a robust visual fallback while
  // preserving depth/height/normal/object rendering.
  const rgbMaterial = useMemo(() => new THREE.PointsMaterial({
    size: Math.max(.006, p.pointSize * .012),
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: p.opacity,
    depthWrite: false,
    toneMapped: false,
  }), [p.pointSize, p.opacity])
  useEffect(() => () => rgbMaterial.dispose(), [rgbMaterial])

  const shaderMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    uniforms: {
      uPointSize: { value: uniformValues.uPointSize },
      uNearDepth: { value: uniformValues.uNearDepth },
      uFarDepth: { value: uniformValues.uFarDepth },
      uColorMode: { value: uniformValues.uColorMode },
      uUseRgb: { value: uniformValues.uUseRgb },
      uDepthMin: { value: uniformValues.uDepthMin },
      uDepthMax: { value: uniformValues.uDepthMax },
      uHeightMin: { value: uniformValues.uHeightMin },
      uHeightMax: { value: uniformValues.uHeightMax },
      uOpacity: { value: uniformValues.uOpacity },
      uMinX: { value: uniformValues.uMinX },
      uMaxX: { value: uniformValues.uMaxX },
      uMinY: { value: uniformValues.uMinY },
      uMaxY: { value: uniformValues.uMaxY },
      uMinZ: { value: uniformValues.uMinZ },
      uMaxZ: { value: uniformValues.uMaxZ },
    },
  }), [])

  useEffect(() => {
    const u = shaderMaterial.uniforms
    u.uPointSize.value = uniformValues.uPointSize
    u.uNearDepth.value = uniformValues.uNearDepth
    u.uFarDepth.value = uniformValues.uFarDepth
    u.uColorMode.value = uniformValues.uColorMode
    u.uUseRgb.value = uniformValues.uUseRgb
    u.uDepthMin.value = uniformValues.uDepthMin
    u.uDepthMax.value = uniformValues.uDepthMax
    u.uHeightMin.value = uniformValues.uHeightMin
    u.uHeightMax.value = uniformValues.uHeightMax
    u.uOpacity.value = uniformValues.uOpacity
    u.uMinX.value = uniformValues.uMinX
    u.uMaxX.value = uniformValues.uMaxX
    u.uMinY.value = uniformValues.uMinY
    u.uMaxY.value = uniformValues.uMaxY
    u.uMinZ.value = uniformValues.uMinZ
    u.uMaxZ.value = uniformValues.uMaxZ
  }, [shaderMaterial, uniformValues])

  useEffect(() => () => shaderMaterial.dispose(), [shaderMaterial])

  useEffect(() => {
    const attr = geometry.getAttribute('aObject') as THREE.BufferAttribute | undefined
    if (!attr) return
    const array = attr.array as Float32Array
    array.fill(0)
    attr.needsUpdate = true
    if (!p.selectedObjectMask) return

    let live = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!live) return
      const canvas = document.createElement('canvas')
      canvas.width = p.cloud.width
      canvas.height = p.cloud.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0, p.cloud.width, p.cloud.height)
      const data = ctx.getImageData(0, 0, p.cloud.width, p.cloud.height).data
      const ids = geometry.userData.pixelIds as Uint32Array
      for (let j = 0; j < ids.length; j++) {
        const off = ids[j] * 4
        array[j] = data[off] > 32 ? 1 : 0
      }
      attr.needsUpdate = true
      canvas.width = 1
      canvas.height = 1
    }
    img.onerror = () => console.warn('Object mask failed to load')
    img.src = p.selectedObjectMask
    return () => { live = false; img.onload = null }
  }, [geometry, p.cloud.width, p.cloud.height, p.selectedObjectMask])

  const click = async (e: any) => {
    e.stopPropagation()
    if (!p.sceneId || e.index === undefined) return
    const ids = geometry.userData.pixelIds as Uint32Array
    const pointIndex = Math.max(0, Math.min(ids.length - 1, e.index))
    const id = ids[pointIndex]
    const x = id % p.cloud.width
    const y = Math.floor(id / p.cloud.width)
    try {
      const info = await getPoint(p.sceneId, x, y)
      const state = useSceneStore.getState()
      if (state.tool === 'measure') {
        if (!state.measurementA) state.set({ selected: info, measurementA: info, measurementB: null, measurementC: null })
        else if (!state.measurementB) state.set({ selected: info, measurementB: info })
        else if (!state.measurementC) state.set({ selected: info, measurementC: info })
        else state.set({ selected: info, measurementA: info, measurementB: null, measurementC: null })
      } else {
        state.set({ selected: info, hover: info })
      }
    } catch (err) {
      console.error('Point lookup failed', err)
    }
  }

  if (!p.cloud.count || !geometry.attributes.position) return null
  const useBuiltIn = p.colorMode === 'rgb'
  return <points
    geometry={geometry}
    material={useBuiltIn ? rgbMaterial : shaderMaterial}
    frustumCulled={false}
    onClick={click}
  />
}

function AnnotationMarker({ annotation }: { annotation: any }) {
  const q = cvPoint([annotation.point.x_m, annotation.point.y_m, annotation.point.z_m])
  return <>
    <mesh position={q}><sphereGeometry args={[.045,12,12]} /><meshBasicMaterial color={annotation.color || '#67e8f9'} /></mesh>
    <Html position={q} distanceFactor={10} style={{ pointerEvents: 'none' }}>
      <div className="annotation3DLabel"><b>{annotation.name}</b><span>{annotation.point.x_m.toFixed(2)}, {annotation.point.y_m.toFixed(2)}, {annotation.point.z_m.toFixed(2)} m</span></div>
    </Html>
  </>
}
function CameraRay({ point }: { point: PointInfo }) {
  return <Line points={[new THREE.Vector3(0,0,0), cvPoint([point.x_m, point.y_m, point.z_m])]} color="#5de1ff" lineWidth={1} transparent opacity={.38} />
}
function SelectionMarker({ point, showLabel }: { point: PointInfo; showLabel: boolean }) {
  const q = cvPoint([point.x_m, point.y_m, point.z_m])
  return <>
    <mesh position={q}><sphereGeometry args={[.06,16,16]} /><meshStandardMaterial color="#dffcff" emissive="#39ddff" emissiveIntensity={2.8} /></mesh>
    {showLabel && <Html position={q} distanceFactor={8}><div className="threeLabel"><b>Selected</b><span>{point.x_m.toFixed(3)}, {point.y_m.toFixed(3)}, {point.z_m.toFixed(3)} m</span></div></Html>}
  </>
}
function MeasurementLine({ a, b }: { a: PointInfo; b: PointInfo }) {
  const p1 = cvPoint([a.x_m,a.y_m,a.z_m]), p2 = cvPoint([b.x_m,b.y_m,b.z_m]), d = p1.distanceTo(p2), m = p1.clone().add(p2).multiplyScalar(.5)
  return <><Line points={[p1,p2]} color="#f4fbff" lineWidth={2}/><Html position={m} distanceFactor={9}><div className="measureLabel">{d.toFixed(3)} m</div></Html></>
}
function AngleOverlay({ a, b, c }: { a: PointInfo; b: PointInfo; c: PointInfo }) {
  const pa=cvPoint([a.x_m,a.y_m,a.z_m]), pb=cvPoint([b.x_m,b.y_m,b.z_m]), pc=cvPoint([c.x_m,c.y_m,c.z_m])
  const v1=pa.clone().sub(pb).normalize(), v2=pc.clone().sub(pb).normalize(), ang=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v1.dot(v2),-1,1)))
  return <><Line points={[pa,pb,pc]} color="#ffcc66" lineWidth={1.5}/><Html position={pb} distanceFactor={8}><div className="measureLabel">∠ {ang.toFixed(1)}°</div></Html></>
}
function PlaneOverlay({ plane }: { plane: Plane }) {
  const pos=cvPoint(plane.center), n=cvPlaneNormal(plane.normal), q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),n), size=Math.max(1,Math.min(8,Math.sqrt(plane.inliers)/80))
  return <mesh position={pos} quaternion={q}><planeGeometry args={[size,size]}/><meshBasicMaterial transparent opacity={.12} side={THREE.DoubleSide}/></mesh>
}
function ObjectBounds({ object }: { object: any }) {
  if (!object.xyz_min || !object.xyz_max) return null
  const mn=cvPoint([object.xyz_min[0],object.xyz_min[1],object.xyz_min[2]]), mx=cvPoint([object.xyz_max[0],object.xyz_max[1],object.xyz_max[2]])
  const center=mn.clone().add(mx).multiplyScalar(.5), size=new THREE.Vector3(Math.abs(mx.x-mn.x),Math.abs(mx.y-mn.y),Math.abs(mx.z-mn.z))
  return <mesh position={center}><boxGeometry args={[Math.max(size.x,.001),Math.max(size.y,.001),Math.max(size.z,.001)]}/><meshBasicMaterial wireframe transparent opacity={.65}/></mesh>
}
function CameraFrustum({ scene }: { scene: Scene }) {
  const z=Math.min(Math.max(scene.depth_max_m*.18,2),12), fx=scene.calibration.fx, fy=scene.calibration.fy, cx=scene.calibration.cx, cy=scene.calibration.cy, w=scene.width, h=scene.height
  const corners:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[w,0],[w,h],[0,h]]
  const far=corners.map(([x,y])=>cvPoint([(x-cx)*z/fx,-(y-cy)*z/fy,z])), origin=new THREE.Vector3(0,0,0), lines=far.map((p)=>[origin,p])
  return <><Line points={[far[0],far[1],far[2],far[3],far[0]]} color="#63e2ff" lineWidth={1.2} transparent opacity={.7}/>{lines.map((p,i)=><Line key={i} points={p} color="#63e2ff" lineWidth={1.1} transparent opacity={.55}/>)}</>
}
function CameraMarker(){return <mesh position={[0,0,0]}><sphereGeometry args={[.08,16,16]}/><meshBasicMaterial color="#63e2ff"/></mesh>}
function MeshObject({url}:{url:string}){
  const [obj,setObj]=useState<THREE.Object3D|null>(null)
  useEffect(()=>{let live=true;import('three/examples/jsm/loaders/GLTFLoader.js').then(({GLTFLoader})=>new GLTFLoader().load(url,g=>{if(!live)return;g.scene.traverse((n:any)=>{const ms=n.material?Array.isArray(n.material)?n.material:[n.material]:[];ms.forEach((m:any)=>{m.side=THREE.DoubleSide;m.transparent=true;m.opacity=.42})});g.scene.scale.z=-1;setObj(g.scene)}));return()=>{live=false}},[url])
  return obj?<primitive object={obj}/>:null
}
