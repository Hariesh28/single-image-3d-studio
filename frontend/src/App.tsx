import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnalysisPanel } from './components/AnalysisPanel'
import { Controls } from './components/Controls'
import { DepthPanel } from './components/DepthPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ImagePanel } from './components/ImagePanel'
import { Inspector } from './components/Inspector'
import { MeasurePanel } from './components/MeasurePanel'
import { ToolWorkspace } from './components/ToolWorkspace'
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
import { useSceneStore, type RightPanel } from './store/useSceneStore'
import './styles.css'

const PROCESS_CONFIG = {
  scene_mode: 'auto',
  quality: 'maximum',
  generate_mesh: true,
  detect_planes: true,
  include_normals: true,
  max_points: 1_500_000,
}

export default function App() {
  const s = useSceneStore()
  const [sceneMode, setSceneMode] = useState('auto')
  const [quality, setQuality] = useState('maximum')
  const [error, setError] = useState('')
  const restoreGeneration = useRef(0)
  const userInteractedDuringRestore = useRef(false)

  const markUserInteraction = useCallback(() => {
    // Any explicit interaction must beat an in-flight async UI-state restore.
    userInteractedDuringRestore.current = true
  }, [])
  const { status, error: statusError } = useSceneProgress(s.sceneId)

  useEffect(() => {
    if (!s.scene) return
    const generation = ++restoreGeneration.current
    userInteractedDuringRestore.current = false
    const c = s.scene.calibration
    s.set({
      nearDepth: Math.max(0.05, s.scene.depth_min_m),
      farDepth: Math.max(s.scene.depth_max_m, c.source === 'default_fov' ? 20 : 80),
    })

    const activeSceneId = s.scene.scene_id
    getAnnotations(activeSceneId).then((x) => {
      if (generation === restoreGeneration.current && useSceneStore.getState().sceneId === activeSceneId) {
        s.set({ annotations: x.items || [] })
      }
    }).catch(() => {})
    getState(s.scene.scene_id).then((ui: any) => {
      if (generation !== restoreGeneration.current) return
      if (!ui || typeof ui !== 'object') return
      // A restore request is asynchronous. If the user clicks a workspace
      // before that request returns, never let the stale server snapshot
      // overwrite the user's current UI/tool choice.
      if (userInteractedDuringRestore.current) return
      if (useSceneStore.getState().sceneId !== s.sceneId) return
      s.set({
        mode: ui.mode,
        tool: ui.tool,
        rightPanel: ui.right_panel === 'controls' && ['annotate', 'region', 'profile'].includes(ui.tool)
          ? 'tool'
          : ui.right_panel || (ui.tool === 'measure' ? 'measure' : ui.tool === 'inspect' ? 'inspect' : 'tool'),
        density: ui.density,
        pointSize: ui.point_size,
        pointBudget: ui.point_budget,
        colorMode: ui.color_mode,
        pointOpacity: ui.point_opacity,
        rgb: ui.rgb,
        depthExaggeration: ui.depth_exaggeration ?? 1,
        nearDepth: ui.near_depth,
        farDepth: ui.far_depth,
        background: ui.background,
        showGrid: ui.show_grid,
        showAxes: ui.show_axes,
        showFrustum: ui.show_frustum,
        showGround: ui.show_ground,
        showMesh: ui.show_mesh,
        showCamera: ui.show_camera,
        showPlanes: ui.show_planes,
        showLabels: ui.show_labels,
        adaptiveLod: ui.adaptive_lod,
        showContours: ui.show_contours,
        minX: Number.isFinite(ui.min_x) ? ui.min_x : -Infinity,
        maxX: Number.isFinite(ui.max_x) ? ui.max_x : Infinity,
        minY: Number.isFinite(ui.min_y) ? ui.min_y : -Infinity,
        maxY: Number.isFinite(ui.max_y) ? ui.max_y : Infinity,
        minZ: Number.isFinite(ui.min_z) ? ui.min_z : -Infinity,
        maxZ: Number.isFinite(ui.max_z) ? ui.max_z : Infinity,
        depthColormap: ui.depth_colormap,
        depthDisplay: ui.depth_display,
        parallaxStrength: ui.parallax_strength,
        parallaxYaw: ui.parallax_yaw,
        parallaxPitch: ui.parallax_pitch,
        cameraView: ui.camera_view || 'home',
        selectedObjectId: ui.selected_object_id ?? null,
        regionShape: ui.region_shape || 'polygon',
        measureSlot: ui.measure_slot || 'A',
        measurementA: ui.measurement_a || null,
        measurementB: ui.measurement_b || null,
        measurementC: ui.measurement_c || null,
        measurementHistory: Array.isArray(ui.measurement_history) ? ui.measurement_history : [],
      })
    }).catch(() => {})
  }, [s.scene, s.sceneId])

  useKeyboardShortcuts(markUserInteraction)

  useEffect(() => {
    if (!s.sceneId) return
    const payload = {
      mode: s.mode,
      tool: s.tool,
      right_panel: s.rightPanel,
      region_shape: s.regionShape,
      density: s.density,
      point_size: s.pointSize,
      point_budget: s.pointBudget,
      color_mode: s.colorMode,
      rgb: s.rgb,
      point_opacity: s.pointOpacity,
      depth_exaggeration: s.depthExaggeration,
      near_depth: s.nearDepth,
      far_depth: s.farDepth,
      background: s.background,
      show_grid: s.showGrid,
      show_axes: s.showAxes,
      show_frustum: s.showFrustum,
      show_ground: s.showGround,
      show_mesh: s.showMesh,
      show_camera: s.showCamera,
      show_planes: s.showPlanes,
      show_labels: s.showLabels,
      adaptive_lod: s.adaptiveLod,
      show_contours: s.showContours,
      min_x: Number.isFinite(s.minX) ? s.minX : null,
      max_x: Number.isFinite(s.maxX) ? s.maxX : null,
      min_y: Number.isFinite(s.minY) ? s.minY : null,
      max_y: Number.isFinite(s.maxY) ? s.maxY : null,
      min_z: Number.isFinite(s.minZ) ? s.minZ : null,
      max_z: Number.isFinite(s.maxZ) ? s.maxZ : null,
      depth_colormap: s.depthColormap,
      depth_display: s.depthDisplay,
      parallax_strength: s.parallaxStrength,
      parallax_yaw: s.parallaxYaw,
      parallax_pitch: s.parallaxPitch,
      camera_view: s.cameraView,
      selected_object_id: s.selectedObjectId,
      measure_slot: s.measureSlot,
      measurement_a: s.measurementA,
      measurement_b: s.measurementB,
      measurement_c: s.measurementC,
      measurement_history: s.measurementHistory,
    }
    const id = window.setTimeout(() => saveState(s.sceneId!, payload).catch(() => {}), 450)
    return () => clearTimeout(id)
  }, [s.sceneId, s.mode, s.tool, s.rightPanel, s.regionShape, s.density, s.pointSize, s.pointBudget, s.colorMode, s.rgb, s.pointOpacity, s.depthExaggeration, s.nearDepth, s.farDepth, s.background, s.showGrid, s.showAxes, s.showFrustum, s.showGround, s.showMesh, s.showCamera, s.showPlanes, s.showLabels, s.adaptiveLod, s.showContours, s.minX, s.maxX, s.minY, s.maxY, s.minZ, s.maxZ, s.depthColormap, s.depthDisplay, s.parallaxStrength, s.parallaxYaw, s.parallaxPitch, s.cameraView, s.selectedObjectId, s.measureSlot, s.measurementA, s.measurementB, s.measurementC, s.measurementHistory])

  const onFile = useCallback(async (file: File) => {
    setError('')
    try {
      const r = await (await import('./api/client')).createScene(file, { ...PROCESS_CONFIG, scene_mode: sceneMode, quality })
      s.set({
        sceneId: r.scene_id,
        scene: null,
        selected: null,
        hover: null,
        measurementA: null,
        measurementB: null,
        measurementC: null,
        measureSlot: 'A',
        measurementHistory: [],
        annotations: [],
        selectedAnnotationId: null,
        selectedObjectId: null,
        regionPoints: [],
        regionResult: null,
        profile: null,
        profileStart: null,
        toolMessage: '',
        mode: 'split',
        tool: 'inspect',
        rightPanel: 'inspect',
      })
    } catch (e) {
      setError(String(e))
    }
  }, [sceneMode, quality, s])

  if (!s.sceneId) {
    return <div className="app landingApp">
      <header className="topHeader">
        <div className="brand"><span>SINGLE IMAGE</span><strong>3D</strong><i>STUDIO</i></div>
        <div className="headerBadge">METRIC · LOCAL · V2-LARGE</div>
      </header>
      <main className="landing"><div className="hero">
        <div className="eyebrow">SINGLE-IMAGE 3D ANALYSIS PLATFORM</div>
        <h1>One image.<br /><em>A complete 3D workspace.</em></h1>
        <p>Metric depth, calibrated geometry, GPU point-cloud visualization, inspect, measure, annotate, region analysis, profiles, planes, mesh, objects and export — locally on your machine.</p>
        <Upload onFile={onFile} mode={sceneMode} quality={quality} setMode={setSceneMode} setQuality={setQuality} />
        {error && <div className="error">{error}</div>}
        <div className="heroFoot"><span>Depth Anything V2 · ViT-L</span><span>Indoor + Outdoor metric</span><span>CUDA / RTX-ready</span></div>
      </div></main>
    </div>
  }

  if (!s.scene || status?.status !== 'complete') {
    return <div className="app processingApp">
      <header className="topHeader"><div className="brand"><span>SINGLE IMAGE</span><strong>3D</strong><i>STUDIO</i></div><button className="headerGhost" onClick={() => s.reset()}>Cancel / new scene</button></header>
      <Processing status={status} error={statusError} />
    </div>
  }

  const scene = s.scene
  const image = artifact(scene.scene_id, scene.artifacts.image || 'image.png')
  const depthKey = `depth_${s.depthDisplay}_${s.depthColormap}`
  const depth = artifact(scene.scene_id, scene.artifacts[depthKey] || scene.artifacts.depth_image || 'depth.png')
  const rawDepth = artifact(scene.scene_id, scene.artifacts.depth || 'depth.f32')
  const contours = s.showContours && scene.artifacts.depth_contours ? artifact(scene.scene_id, scene.artifacts.depth_contours) : depth

  const setTool = (tool: any, panel?: RightPanel) => {
    // User interaction becomes authoritative over any in-flight persisted
    // state restoration request.
    markUserInteraction()
    const payload: any = { tool }
    if (panel) payload.rightPanel = panel
    if (tool === 'region') {
      payload.regionPoints = []
      payload.regionResult = null
    }
    if (tool === 'profile') {
      payload.profileStart = null
      payload.profile = null
    }
    if (tool === 'annotate' || tool === 'region' || tool === 'profile') payload.toolMessage = ''
    if ((tool === 'region' || tool === 'profile') && ['3d', 'compare', 'parallax'].includes(s.mode)) payload.mode = 'split'
    s.set(payload)
  }

  return <div className="app viewerApp">
    <header className="topHeader">
      <div className="brand"><span>SINGLE IMAGE</span><strong>3D</strong><i>STUDIO</i></div>
      <div className="sceneHeaderInfo">
        <span>{scene.scene_type.toUpperCase()} · {scene.width}×{scene.height}</span>
        <span>{scene.calibration.source.toUpperCase()} · CAL {scene.calibration.quality?.label?.toUpperCase() || '—'}</span>
      </div>
      <div className="headerActions">
        <button className="headerBtn" onClick={() => { markUserInteraction(); s.set({ rightPanel: 'analysis' }) }}>Analytics</button>
        <button className="headerBtn" onClick={() => { markUserInteraction(); s.set({ rightPanel: 'controls' }) }}>Controls</button>
        <button className="headerBtn" onClick={() => { markUserInteraction(); s.set({ rightPanel: 'project' }) }}>Project</button>
        <button className="headerGhost" onClick={() => s.reset()}>New scene</button>
      </div>
    </header>

    <Toolbar
      onNew={() => { markUserInteraction(); s.reset() }}
      onProject={() => { markUserInteraction(); s.set({ rightPanel: 'project' }) }}
      onUserInteraction={markUserInteraction}
      onTool={(tool) => setTool(tool, tool === 'measure' ? 'measure' : tool === 'inspect' ? 'inspect' : 'tool')}
    />

    <main className={`workspace mode-${s.mode}`}>
      <div className="stageArea">
        {s.mode === 'image' && <ImagePanel src={image} />}
        {s.mode === 'depth' && <DepthPanel src={s.showContours ? contours : depth} min={scene.depth_min_m} max={scene.depth_max_m} />}
        {s.mode === '3d' && <ThreeViewport />}
        {s.mode === 'split' && <div className="splitGrid"><ImagePanel src={image} /><DepthPanel src={s.showContours ? contours : depth} min={scene.depth_min_m} max={scene.depth_max_m} /><ThreeViewport /></div>}
        {s.mode === 'compare' && <ComparePanel />}
        {s.mode === 'parallax' && <ParallaxView imageUrl={image} depthUrl={rawDepth} />}
        <div className="stageHint"><b>{s.tool.toUpperCase()}</b><span>{stageHint(s.tool)}</span></div>
      </div>

      <div className="sidePanel">
        {s.rightPanel === 'controls' && <Controls />}
        {s.rightPanel === 'inspect' && <Inspector />}
        {s.rightPanel === 'measure' && <MeasurePanel />}
        {s.rightPanel === 'tool' && <ToolWorkspace />}
        {s.rightPanel === 'analysis' && <AnalysisPanel />}
        {s.rightPanel === 'project' && <ProjectPanel />}
      </div>
    </main>
    <StatusBar />
  </div>
}

function stageHint(tool: string) {
  if (tool === 'measure') return 'Choose slot A/B/C in the Measure panel, then click Image, Depth or 3D. '
  if (tool === 'annotate') return 'Click a point in Image, Depth or 3D to save a named annotation.'
  if (tool === 'region') return 'Draw on Image or Depth; use polygon vertices, two rectangle corners, or a lasso drag.'
  if (tool === 'profile') return 'Click a start and end point in Image or Depth to generate a metric depth profile.'
  return 'Hover/click Image or Depth for XYZ; click the 3D cloud for linked pixel selection.'
}

function ThreeViewport() {
  const [webglLost, setWebglLost] = useState(false)
  return <div className="canvas">
    <ErrorBoundary>
      <Canvas
        camera={{ position: [0, 1.2, 6], fov: 55, near: 0.01, far: 200 }}
        dpr={[1, 1.35]}
        gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
        onCreated={({ gl }) => {
          const canvas = gl.domElement
          const handleLost = (event: Event) => { event.preventDefault(); console.error('WebGL context lost'); setWebglLost(true) }
          const handleRestored = () => { console.info('WebGL context restored'); setWebglLost(false) }
          canvas.addEventListener('webglcontextlost', handleLost, false)
          canvas.addEventListener('webglcontextrestored', handleRestored, false)
        }}
        fallback={<div className="webglFallback">WebGL 2 could not be initialized. Enable hardware acceleration in the browser.</div>}
      >
        <PointCloudScene />
      </Canvas>
    </ErrorBoundary>
    {webglLost && <div className="webglLostOverlay"><b>WebGL context lost</b><span>The browser GPU process stopped the renderer. Reload after hardware acceleration is available.</span></div>}
  </div>
}

function useKeyboardShortcuts(markUserInteraction: () => void) {
  const set = useSceneStore((s) => s.set)
  const reset = useSceneStore((s) => s.requestCameraReset)
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const k = event.key.toLowerCase()
      if (k === '1') { markUserInteraction(); set({ mode: 'image' }) }
      else if (k === '2') { markUserInteraction(); set({ mode: 'depth' }) }
      else if (k === '3') { markUserInteraction(); set({ mode: '3d' }) }
      else if (k === '4') { markUserInteraction(); set({ mode: 'split' }) }
      else if (k === '5') { markUserInteraction(); set({ mode: 'parallax' }) }
      else if (k === 'i') { markUserInteraction(); set({ tool: 'inspect', rightPanel: 'inspect' }) }
      else if (k === 'm') { markUserInteraction(); set({ tool: 'measure', rightPanel: 'measure' }) }
      else if (k === 'a') { markUserInteraction(); set({ tool: 'annotate', rightPanel: 'tool', toolMessage: '' }) }
      else if (k === 'r') { markUserInteraction(); const state = useSceneStore.getState(); set({ tool: 'region', rightPanel: 'tool', regionPoints: [], regionResult: null, mode: ['3d', 'compare', 'parallax'].includes(state.mode) ? 'split' : state.mode, toolMessage: '' }) }
      else if (k === 'p') { markUserInteraction(); const state = useSceneStore.getState(); set({ tool: 'profile', rightPanel: 'tool', profileStart: null, profile: null, mode: ['3d', 'compare', 'parallax'].includes(state.mode) ? 'split' : state.mode, toolMessage: '' }) }
      else if (k === 'f') { markUserInteraction(); reset('home') }
      else if (k === 'escape') { markUserInteraction(); set({ selected: null, hover: null, measurementA: null, measurementB: null, measurementC: null, regionPoints: [], profileStart: null, measureSlot: 'A' }) }
      else if (k === 'g') { markUserInteraction(); const state = useSceneStore.getState(); state.set({ showGrid: !state.showGrid }) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [set, reset, markUserInteraction])
}
