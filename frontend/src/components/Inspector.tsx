import { useEffect, useState } from 'react'
import { artifact, getSegmentation, reproject, saveAnnotations } from '../api/client'
import { useSceneStore } from '../store/useSceneStore'
import type { PointInfo } from '../types'

export function Inspector() {
  const s = useSceneStore()
  const scene = s.scene
  const [reproj, setReproj] = useState<any>(null)
  const [objectStatus, setObjectStatus] = useState('')

  useEffect(() => {
    if (!scene || !s.selected) { setReproj(null); return }
    reproject(scene.scene_id, [s.selected.x_m, s.selected.y_m, s.selected.z_m]).then(setReproj).catch(() => setReproj(null))
  }, [scene?.scene_id, s.selected])

  if (!scene) return null

  const selectedObject = s.selectedObjectId != null ? scene.segmentation.objects.find((o: any) => o.id === s.selectedObjectId) : null
  const copyXYZ = async () => {
    if (!s.selected) return
    const value = `${s.selected.x_m.toFixed(6)}, ${s.selected.y_m.toFixed(6)}, ${s.selected.z_m.toFixed(6)} m`
    try { await navigator.clipboard.writeText(value); setObjectStatus('XYZ copied to clipboard.') } catch { setObjectStatus(value) }
  }

  const addAnnotation = async () => {
    if (!s.sceneId || !s.selected) return
    const name = window.prompt('Annotation name', `Point ${s.annotations.length + 1}`)
    if (!name?.trim()) return
    const next = [...s.annotations, { id: crypto.randomUUID(), name: name.trim(), point: s.selected, color: '#67e8f9', note: '' }]
    s.set({ annotations: next })
    await saveAnnotations(s.sceneId, next).catch(() => {})
    setObjectStatus('Annotation saved.')
  }

  const setMeasure = () => {
    if (!s.selected) return
    s.set({ rightPanel: 'measure', tool: 'measure', [`measurement${s.measureSlot}`]: s.selected } as any)
  }

  const reloadSegmentation = async () => {
    if (!scene) return
    try {
      const result = await getSegmentation(scene.scene_id)
      const fresh = await (await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000/api'}/scenes/${scene.scene_id}`, { cache: 'no-store' })).json()
      s.set({ scene: fresh, selectedObjectId: result.objects?.[0]?.id ?? s.selectedObjectId })
      setObjectStatus(`Loaded ${result.objects?.length ?? 0} segmented objects.`)
    } catch (error) {
      setObjectStatus(String(error))
    }
  }

  return <aside className="studioPanel panelScroll">
    <div className="panelHeaderBlock"><div className="eyebrow">ANALYSIS TOOL</div><h2>INSPECT</h2><p>Pixel, depth and metric 3D correspondence.</p></div>

    <section className="inspectHero">
      <div className="inspectHeroTop"><span>SELECTED POINT</span><span className={`qualityPill ${s.selected?.quality || 'none'}`}>{s.selected?.quality?.toUpperCase() || 'NONE'}</span></div>
      {!s.selected ? <div className="emptyState largeEmpty">Click a point in the Image, Depth or 3D view.</div> : <>
        <div className="coordPrimary"><span>{s.selected.x_m.toFixed(3)}</span><span>{s.selected.y_m.toFixed(3)}</span><span>{s.selected.z_m.toFixed(3)}</span></div>
        <div className="coordLabels"><span>X (m)</span><span>Y (m)</span><span>Z (m)</span></div>
        <div className="inspectMeta"><div><span>Pixel</span><b>{s.selected.pixel_x}, {s.selected.pixel_y}</b></div><div><span>Depth</span><b>{s.selected.depth_m.toFixed(3)} m</b></div><div><span>Radial distance</span><b>{s.selected.radial_distance_m.toFixed(3)} m</b></div><div><span>Calibration</span><b>{s.selected.calibration_source}</b></div><div><span>Snapped</span><b>{s.selected.snapped ? 'YES' : 'NO'}</b></div></div>
      </>}
    </section>

    <section>
      <SectionTitle title="POINT ACTIONS" />
      <div className="toolCardGrid"><button disabled={!s.selected} onClick={copyXYZ}>Copy XYZ</button><button disabled={!s.selected} onClick={() => s.requestCameraReset('selected')}>Focus 3D</button><button disabled={!s.selected} onClick={setMeasure}>Send to Measure</button><button disabled={!s.selected} onClick={addAnnotation}>Annotate</button></div>
      {objectStatus && <div className="notice">{objectStatus}</div>}
    </section>

    {reproj && s.selected && <section><SectionTitle title="REPROJECTION" /><div className="metricGrid"><Metric label="Original X" value={String(s.selected.pixel_x)} /><Metric label="Projected X" value={reproj.pixel_x.toFixed(2)} /><Metric label="Original Y" value={String(s.selected.pixel_y)} /><Metric label="Projected Y" value={reproj.pixel_y.toFixed(2)} /></div><div className={`validationBox ${reproj.inside ? 'good' : 'warn'}`}><span>Inside image</span><b>{reproj.inside ? 'YES' : 'NO'}</b></div></section>}

    <section>
      <SectionTitle title="POINT QUALITY" />
      {s.selected ? <div className="qualityList"><Row n="Local quality" v={s.selected.quality} /><Row n="Score" v={`${Math.round((s.selected.quality_score ?? 0) * 100)}%`} /><Row n="Depth estimate" v={`${s.selected.depth_m.toFixed(3)} m`} /><Row n="Coordinate frame" v="Camera-relative / meters" /></div> : <div className="emptyState">No point selected.</div>}
    </section>

    <section>
      <SectionTitle title="SEGMENTATION" />
      <div className="small">Object masks are optional and computed on demand. Click an object to highlight its pixels and 3D bounds.</div>
      <button className="full" onClick={reloadSegmentation}>Refresh objects</button>
      {selectedObject && <div className="objectInspector"><div><span>Selected</span><b>{selectedObject.label}</b></div><div><span>Score</span><b>{(selectedObject.score * 100).toFixed(0)}%</b></div><div><span>Median depth</span><b>{selectedObject.depth_median_m == null ? '—' : `${selectedObject.depth_median_m.toFixed(2)} m`}</b></div><div><span>Dimensions</span><b>{selectedObject.dimensions_m ? selectedObject.dimensions_m.map((x: number) => x.toFixed(2)).join(' × ') + ' m' : '—'}</b></div></div>}
      {scene.segmentation.objects.length ? <div className="objectList">{scene.segmentation.objects.map((o: any) => <button key={o.id} className={selectedObject?.id === o.id ? 'activeMini' : ''} onClick={() => s.set({ selectedObjectId: o.id })}><span>{o.label}</span><span>{(o.score * 100).toFixed(0)}%</span></button>)}</div> : <div className="emptyState">No objects available. Run Detect objects in Controls.</div>}
    </section>

    <section><SectionTitle title="COORDINATE CONVENTION" /><div className="axisLegend"><div><b>X</b><span>right</span></div><div><b>Y</b><span>up</span></div><div><b>Z</b><span>forward</span></div></div><p className="small">The browser renderer mirrors camera Z internally for Three.js. The displayed XYZ values remain in the backend camera-relative metric frame.</p></section>
  </aside>
}

function SectionTitle({ title }: { title: string }) { return <div className="sectionTitle"><span>{title}</span></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><b>{value}</b></div> }
function Row({ n, v }: { n: string; v: string }) { return <div className="simpleRow"><span>{n}</span><b>{v}</b></div> }
