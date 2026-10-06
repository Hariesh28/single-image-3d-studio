import { useEffect, useState, type ReactNode } from 'react'
import { calibrateReference, getScene, segment, updateCalibration } from '../api/client'
import { useSceneStore } from '../store/useSceneStore'
import type { ColorMode, RegionShape } from '../types'

const DENSITY = ['Maximum', 'High', 'Balanced', 'Preview']

export function Controls() {
  const s = useSceneStore()
  const [calSource, setCalSource] = useState<'auto' | 'fov' | 'manual'>('auto')
  const [fov, setFov] = useState('70')
  const [fx, setFx] = useState('')
  const [fy, setFy] = useState('')
  const [cx, setCx] = useState('')
  const [cy, setCy] = useState('')
  const [k1, setK1] = useState('0')
  const [k2, setK2] = useState('0')
  const [p1, setP1] = useState('0')
  const [p2, setP2] = useState('0')
  const [k3, setK3] = useState('0')
  const [ref, setRef] = useState('1.00')
  const [segScore, setSegScore] = useState(0.65)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!s.scene) return
    const c = s.scene.calibration
    setCalSource(c.source === 'manual' ? 'manual' : c.source === 'fov' ? 'fov' : 'auto')
    setFov(String(c.fov_x_deg ?? c.fov_deg ?? 70))
    setFx(String(c.fx))
    setFy(String(c.fy))
    setCx(String(c.cx))
    setCy(String(c.cy))
    setK1(String(c.distortion?.k1 ?? 0))
    setK2(String(c.distortion?.k2 ?? 0))
    setP1(String(c.distortion?.p1 ?? 0))
    setP2(String(c.distortion?.p2 ?? 0))
    setK3(String(c.distortion?.k3 ?? 0))
  }, [s.scene])

  const applyCal = async () => {
    if (!s.sceneId) return
    s.snapshot()
    try {
      const payload = {
        source: calSource,
        scale: s.scene?.calibration.scale || 1,
        k1: Number(k1), k2: Number(k2), p1: Number(p1), p2: Number(p2), k3: Number(k3),
        ...(calSource === 'manual' ? { fx: Number(fx), fy: Number(fy), cx: Number(cx), cy: Number(cy) } : { fov_deg: Number(fov) }),
      }
      await updateCalibration(s.sceneId, payload)
      const scene = await getScene(s.sceneId)
      s.set({ scene, selected: null, measurementA: null, measurementB: null, measurementC: null, measurementHistory: [], profile: null, regionResult: null, cameraView: 'home' })
      setMessage('Camera calibration applied and geometry rebuilt.')
    } catch (error) {
      setMessage(String(error))
    }
  }

  const applyRef = async () => {
    if (!s.sceneId || !s.measurementA || !s.measurementB) return
    s.snapshot()
    try {
      await calibrateReference(s.sceneId, {
        x1: s.measurementA.pixel_x,
        y1: s.measurementA.pixel_y,
        x2: s.measurementB.pixel_x,
        y2: s.measurementB.pixel_y,
        known_distance_m: Number(ref),
      })
      const scene = await getScene(s.sceneId)
      s.set({ scene, selected: null })
      setMessage('Reference distance scale applied. Re-check your known measurement after calibration.')
    } catch (error) {
      setMessage(String(error))
    }
  }

  const runSegmentation = async () => {
    if (!s.sceneId) return
    try {
      const out = await segment(s.sceneId, segScore, 12)
      const scene = await getScene(s.sceneId)
      s.set({ scene, selectedObjectId: out.objects?.[0]?.id ?? null })
      setMessage(`Detected ${out.objects?.length ?? 0} objects.`)
    } catch (error) {
      setMessage(String(error))
    }
  }

  const setClip = (key: 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ', value: string) => {
    const n = Number(value)
    s.set({ [key]: value === '' || !Number.isFinite(n) ? (key.startsWith('min') ? -Infinity : Infinity) : n } as any)
  }

  const scene = s.scene
  const calLabel = scene?.calibration?.quality?.label?.toUpperCase() || '—'
  return <aside className="studioPanel panelScroll">
    <PanelHeader title="CONTROLS" subtitle="Rendering, geometry and calibration" />

    <PanelSection title="POINT CLOUD" badge={scene?.point_counts?.[0] ? `${scene.point_counts[0].toLocaleString()} pts` : undefined}>
      <Field label={`Density · ${DENSITY[s.density]}`}><select value={s.density} onChange={(e) => s.set({ density: Number(e.target.value) as 0 | 1 | 2 | 3 })}>{DENSITY.map((v, i) => <option key={v} value={i}>{v}</option>)}</select></Field>
      <Field label={`Point size · ${s.pointSize.toFixed(1)}`}><input type="range" min="0.5" max="8" step="0.1" value={s.pointSize} onChange={(e) => s.set({ pointSize: Number(e.target.value) })} /></Field>
      <Field label={`GPU budget · ${(s.pointBudget / 1e6).toFixed(1)}M`}><input type="range" min="100000" max="5000000" step="100000" value={Math.min(5000000, s.pointBudget)} onChange={(e) => s.set({ pointBudget: Number(e.target.value) })} /></Field>
      <Field label={`Opacity · ${Math.round(s.pointOpacity * 100)}%`}><input type="range" min="0.2" max="1" step="0.01" value={s.pointOpacity} onChange={(e) => s.set({ pointOpacity: Number(e.target.value) })} /></Field>
      <Field label={`Visual depth exaggeration · ${s.depthExaggeration.toFixed(1)}×`}><input type="range" min="1" max="8" step="0.1" value={s.depthExaggeration} onChange={(e) => s.set({ depthExaggeration: Number(e.target.value) })} /></Field>
      <div className="small">Depth exaggeration changes only the visual geometry. Reported metric XYZ remains unchanged.</div>
      <Field label="Color mode"><select value={s.colorMode} onChange={(e) => s.set({ colorMode: e.target.value as ColorMode })}><option value="rgb">RGB</option><option value="depth">Depth</option><option value="height">Height</option><option value="normal">Normals</option><option value="object">Selected object</option></select></Field>
    </PanelSection>

    <PanelSection title="CLIPPING">
      <Field label="Depth (m)"><div className="rangePair"><input type="number" min="0.01" step="0.01" value={s.nearDepth} onChange={(e) => s.set({ nearDepth: Math.max(0.01, Number(e.target.value) || 0.01) })} /><input type="number" min="0.02" step="0.01" value={s.farDepth} onChange={(e) => s.set({ farDepth: Math.max(s.nearDepth + 0.01, Number(e.target.value) || s.nearDepth + 0.01) })} /></div></Field>
      <Field label="X range (m)"><div className="rangePair"><input value={Number.isFinite(s.minX) ? s.minX : ''} placeholder="min" onChange={(e) => setClip('minX', e.target.value)} /><input value={Number.isFinite(s.maxX) ? s.maxX : ''} placeholder="max" onChange={(e) => setClip('maxX', e.target.value)} /></div></Field>
      <Field label="Y range (m)"><div className="rangePair"><input value={Number.isFinite(s.minY) ? s.minY : ''} placeholder="min" onChange={(e) => setClip('minY', e.target.value)} /><input value={Number.isFinite(s.maxY) ? s.maxY : ''} placeholder="max" onChange={(e) => setClip('maxY', e.target.value)} /></div></Field>
      <Field label="Z range (m)"><div className="rangePair"><input value={Number.isFinite(s.minZ) ? s.minZ : ''} placeholder="min" onChange={(e) => setClip('minZ', e.target.value)} /><input value={Number.isFinite(s.maxZ) ? s.maxZ : ''} placeholder="max" onChange={(e) => setClip('maxZ', e.target.value)} /></div></Field>
      <button className="full ghostButton" onClick={() => s.set({ minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity, minZ: -Infinity, maxZ: Infinity, nearDepth: scene?.depth_min_m ?? 0.05, farDepth: scene?.depth_max_m ?? 20 })}>Reset clipping</button>
    </PanelSection>

    <PanelSection title="DEPTH DISPLAY">
      <Field label="Colormap"><select value={s.depthColormap} onChange={(e) => s.set({ depthColormap: e.target.value as any })}><option value="turbo">Turbo</option><option value="viridis">Viridis</option><option value="jet">Jet</option><option value="magma">Magma</option><option value="inferno">Inferno</option><option value="plasma">Plasma</option><option value="grayscale">Grayscale</option></select></Field>
      <Field label="Depth representation"><select value={s.depthDisplay} onChange={(e) => s.set({ depthDisplay: e.target.value as any })}><option value="metric">Metric depth</option><option value="inverse">Inverse depth</option><option value="log">Log depth</option></select></Field>
      <Toggle label="Depth contours" checked={s.showContours} onChange={(v) => s.set({ showContours: v })} />
    </PanelSection>

    <PanelSection title="VIEW & CAMERA">
      <div className="presetGrid"><button onClick={() => s.requestCameraReset('home')}>Frame</button><button onClick={() => s.requestCameraReset('front')}>Front</button><button onClick={() => s.requestCameraReset('top')}>Top</button><button onClick={() => s.requestCameraReset('left')}>Left</button><button onClick={() => s.requestCameraReset('right')}>Right</button><button disabled={!s.selected} onClick={() => s.requestCameraReset('selected')}>Selected</button></div>
      <Toggle label="RGB colors" checked={s.rgb} onChange={(v) => s.set({ rgb: v })} />
      <Toggle label="Grid" checked={s.showGrid} onChange={(v) => s.set({ showGrid: v })} />
      <Toggle label="Axes" checked={s.showAxes} onChange={(v) => s.set({ showAxes: v })} />
      <Toggle label="Camera frustum" checked={s.showFrustum} onChange={(v) => s.set({ showFrustum: v })} />
      <Toggle label="Camera marker" checked={s.showCamera} onChange={(v) => s.set({ showCamera: v })} />
      <Toggle label="Detected planes" checked={s.showPlanes} onChange={(v) => s.set({ showPlanes: v })} />
      <Toggle label="Ground alignment" checked={s.showGround} onChange={(v) => s.set({ showGround: v })} />
      <Toggle label="Surface mesh" checked={s.showMesh} disabled={!scene?.artifacts.mesh_glb} onChange={(v) => s.set({ showMesh: v })} />
      <Toggle label="Adaptive LOD" checked={s.adaptiveLod} onChange={(v) => s.set({ adaptiveLod: v })} />
      <Toggle label="3D labels" checked={s.showLabels} onChange={(v) => s.set({ showLabels: v })} />
      <Field label="Background"><input className="colorInput" type="color" value={s.background} onChange={(e) => s.set({ background: e.target.value })} /></Field>
    </PanelSection>

    <PanelSection title="CAMERA CALIBRATION" badge={`CAL ${calLabel}`}>
      <Field label="Method"><select value={calSource} onChange={(e) => setCalSource(e.target.value as any)}><option value="auto">Automatic / EXIF first</option><option value="fov">FOV estimate</option><option value="manual">Manual intrinsics</option></select></Field>
      {calSource === 'fov' ? <Field label="Horizontal FOV"><input type="number" min="5" max="175" step="0.1" value={fov} onChange={(e) => setFov(e.target.value)} /></Field> : null}
      {calSource === 'manual' ? <>
        <Field label="fx (px)"><input type="number" min="1" value={fx} onChange={(e) => setFx(e.target.value)} /></Field>
        <Field label="fy (px)"><input type="number" min="1" value={fy} onChange={(e) => setFy(e.target.value)} /></Field>
        <Field label="cx (px)"><input type="number" min="0" value={cx} onChange={(e) => setCx(e.target.value)} /></Field>
        <Field label="cy (px)"><input type="number" min="0" value={cy} onChange={(e) => setCy(e.target.value)} /></Field>
      </> : null}
      {calSource === 'auto' ? <div className="calInfo"><b>Best available metadata</b><span>Uses EXIF 35 mm-equivalent focal length when available, otherwise falls back to the documented FOV estimate.</span></div> : null}
      <details className="advancedDetails"><summary>Lens distortion</summary><div className="rangePair"><input value={k1} onChange={(e) => setK1(e.target.value)} placeholder="k1" /><input value={k2} onChange={(e) => setK2(e.target.value)} placeholder="k2" /></div><div className="rangePair"><input value={p1} onChange={(e) => setP1(e.target.value)} placeholder="p1" /><input value={p2} onChange={(e) => setP2(e.target.value)} placeholder="p2" /></div><input value={k3} onChange={(e) => setK3(e.target.value)} placeholder="k3" /></details>
      <button className="full primaryButton" onClick={applyCal}>Apply calibration & rebuild</button>
      <div className="small">Manual intrinsics are the preferred route when you know the camera matrix.</div>
    </PanelSection>

    <PanelSection title="REFERENCE SCALE">
      <div className="small">After assigning A and B in Measure, enter the known real separation to correct the global metric scale.</div>
      <Field label="Known distance (m)"><input type="number" min="0.001" step="0.001" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <button className="full" disabled={!s.measurementA || !s.measurementB} onClick={applyRef}>Apply reference scale</button>
    </PanelSection>

    <PanelSection title="OBJECTS">
      <div className="small">Run on-demand COCO instance segmentation. Object masks can be visualized in 2D and filtered in 3D.</div>
      <Field label={`Score threshold · ${segScore.toFixed(2)}`}><input type="range" min="0.3" max="0.95" step="0.01" value={segScore} onChange={(e) => setSegScore(Number(e.target.value))} /></Field>
      <button className="full" onClick={runSegmentation}>Detect objects</button>
      {scene?.segmentation.objects.length ? <div className="objectList">{scene.segmentation.objects.map((o: any) => <button key={o.id} className={s.selectedObjectId === o.id ? 'activeMini' : ''} onClick={() => s.set({ selectedObjectId: o.id })}><span>{o.label}</span><span>{(o.score * 100).toFixed(0)}%</span></button>)}</div> : <div className="emptyState">No segmentation run yet.</div>}
    </PanelSection>

    <PanelSection title="TOOLS">
      <div className="toolCardGrid"><button onClick={() => s.set({ tool: 'inspect', rightPanel: 'inspect' })}>Inspect</button><button onClick={() => s.set({ tool: 'measure', rightPanel: 'measure' })}>Measure</button><button onClick={() => s.set({ tool: 'annotate', rightPanel: 'tool', toolMessage: '' })}>Annotate</button><button onClick={() => s.set({ tool: 'region', rightPanel: 'tool', regionPoints: [], regionResult: null, mode: ['3d', 'compare', 'parallax'].includes(s.mode) ? 'split' : s.mode, toolMessage: '' })}>Region</button><button onClick={() => s.set({ tool: 'profile', rightPanel: 'tool', profileStart: null, profile: null, mode: ['3d', 'compare', 'parallax'].includes(s.mode) ? 'split' : s.mode, toolMessage: '' })}>Profile</button></div>
      <Field label="Region shape"><select value={s.regionShape} onChange={(e) => s.set({ regionShape: e.target.value as RegionShape, regionPoints: [], regionResult: null })}><option value="polygon">Polygon</option><option value="rectangle">Rectangle</option><option value="lasso">Freehand lasso</option></select></Field>
    </PanelSection>

    <PanelSection title="HISTORY">
      <div className="buttonRow"><button onClick={() => s.snapshot()}>Snapshot</button><button disabled={!s.history.length} onClick={() => s.undo()}>Undo</button><button disabled={!s.future.length} onClick={() => s.redo()}>Redo</button></div>
      <button className="full ghostButton" onClick={() => s.requestCameraReset('home')}>Fit current scene</button>
    </PanelSection>
    {message && <div className="notice">{message}</div>}
  </aside>
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) { return <div className="panelHeaderBlock"><div className="eyebrow">SCENE WORKSPACE</div><h2>{title}</h2><p>{subtitle}</p></div> }
function PanelSection({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) { return <section className="panelSection"><div className="sectionHead"><h3>{title}</h3>{badge && <span className="sectionBadge">{badge}</span>}</div>{children}</section> }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) { return <label className="toggle"><input type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label> }
