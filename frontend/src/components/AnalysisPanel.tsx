import { useEffect, useMemo, useState } from 'react'
import { evaluateDistance, histogram, reproject, saveAnnotations, stats, systemInfo } from '../api/client'
import { useSceneStore } from '../store/useSceneStore'

export function AnalysisPanel() {
  const s = useSceneStore()
  const scene = s.scene
  const [hist, setHist] = useState<any>(null)
  const [stat, setStat] = useState<any>(null)
  const [sys, setSys] = useState<any>(null)
  const [known, setKnown] = useState('')
  const [evalResult, setEvalResult] = useState<any>(null)
  const [reproj, setReproj] = useState<any>(null)

  useEffect(() => {
    if (!scene) return
    Promise.all([histogram(scene.scene_id), stats(scene.scene_id), systemInfo()]).then(([h, st, si]) => { setHist(h); setStat(st); setSys(si) }).catch(() => {})
  }, [scene?.scene_id])

  useEffect(() => {
    if (!scene || !s.selected) { setReproj(null); return }
    reproject(scene.scene_id, [s.selected.x_m, s.selected.y_m, s.selected.z_m]).then(setReproj).catch(() => setReproj(null))
  }, [scene?.scene_id, s.selected])

  const currentMeasurement = useMemo(() => {
    if (!s.measurementA || !s.measurementB) return null
    const a = s.measurementA; const b = s.measurementB
    return Math.hypot(b.x_m-a.x_m,b.y_m-a.y_m,b.z_m-a.z_m)
  }, [s.measurementA,s.measurementB])

  const evaluate = async () => {
    if (!scene || currentMeasurement == null || !known) return
    try { setEvalResult(await evaluateDistance(scene.scene_id, currentMeasurement, Number(known))) } catch { setEvalResult(null) }
  }

  const maxBin = Math.max(...(hist?.counts || [1]))
  if (!scene) return null
  const dims = scene.width / Math.max(scene.height, 1)

  return <aside className="studioPanel panelScroll">
    <div className="panelHeaderBlock"><div className="eyebrow">SCENE INSIGHTS</div><h2>ANALYTICS</h2><p>Depth, geometry, calibration and runtime diagnostics.</p></div>

    <section>
      <SectionTitle title="SCENE SNAPSHOT" />
      <div className="metricGrid">
        <Metric label="Image" value={`${scene.width} × ${scene.height}`} />
        <Metric label="Aspect" value={dims.toFixed(2)} />
        <Metric label="Points" value={scene.point_counts[0].toLocaleString()} />
        <Metric label="Depth span" value={`${scene.depth_min_m.toFixed(2)}–${scene.depth_max_m.toFixed(2)} m`} />
        <Metric label="Planes" value={String(scene.planes.length)} />
        <Metric label="Mesh" value={scene.quality.mesh_generated ? 'Ready' : 'Not generated'} />
      </div>
    </section>

    <section>
      <SectionTitle title="DEPTH STATISTICS" />
      {stat && <div className="metricGrid"><Metric label="Min" value={`${stat.min_m.toFixed(2)} m`} /><Metric label="Median" value={`${stat.median_m.toFixed(2)} m`} /><Metric label="Mean" value={`${stat.mean_m.toFixed(2)} m`} /><Metric label="Std dev" value={`${stat.std_m.toFixed(2)} m`} /><Metric label="P95" value={`${stat.percentiles_m?.p95?.toFixed(2) ?? '—'} m`} /><Metric label="Valid" value={`${(stat.valid_fraction*100).toFixed(1)}%`} /></div>}
      {hist && <><div className="histogram analyticsHistogram">{hist.counts.map((value:number,index:number)=><i key={index} role="button" style={{height:`${Math.max(2,value/maxBin*100)}%`}} title={`${hist.edges_m[index]?.toFixed(2)}–${hist.edges_m[index+1]?.toFixed(2)} m`} onClick={()=>s.set({nearDepth:Math.max(.05,hist.edges_m[index]||.05),farDepth:Math.max(hist.edges_m[index+1]||scene.depth_max_m,(hist.edges_m[index]||.05)+.01),rightPanel:'controls'})}/>)}</div><div className="small">Click a depth bin to isolate that range in the point cloud.</div></>}
    </section>

    <section>
      <SectionTitle title="QUALITY & CALIBRATION" />
      <div className="qualityBox">
        <Row n="Depth quality" v={scene.quality.depth_quality?.label ?? '—'} />
        <Row n="Valid pixels" v={`${((scene.quality.depth_valid_fraction ?? 0)*100).toFixed(1)}%`} />
        <Row n="Depth smoothness" v={`${((scene.quality.depth_quality?.smoothness ?? 0)*100).toFixed(0)}%`} />
        <Row n="Calibration source" v={scene.calibration.source} />
        <Row n="Calibration quality" v={scene.calibration.quality?.label ?? '—'} />
        <Row n="Scene classification" v={`${Math.round(scene.scene_confidence*100)}% · ${scene.scene_selection_source}`} />
      </div>
      <div className={`validationBox ${scene.calibration.quality?.label === 'high' ? 'good' : 'warn'}`}><span>Metric-coordinate caveat</span><b>{scene.calibration.quality?.label === 'high' ? 'Manual intrinsics active' : 'Calibration can limit XY accuracy'}</b></div>
    </section>

    {s.selected && <section>
      <SectionTitle title="REPROJECTION CHECK" />
      <div className="small">The selected metric point is projected through the current camera matrix.</div>
      {reproj && <div className="metricGrid"><Metric label="Original" value={`${s.selected.pixel_x}, ${s.selected.pixel_y}`} /><Metric label="Projected" value={`${reproj.pixel_x.toFixed(2)}, ${reproj.pixel_y.toFixed(2)}`} /><Metric label="Inside image" value={reproj.inside ? 'YES' : 'NO'} /></div>}
    </section>}

    <section>
      <SectionTitle title="MEASUREMENT VALIDATION" />
      <div className="small">Compare current A→B geometry against a known real-world measurement.</div>
      <div className="inputRow"><input type="number" min="0.001" step="0.001" placeholder="Known distance (m)" value={known} onChange={(e)=>setKnown(e.target.value)} /><button disabled={!currentMeasurement || !known} onClick={evaluate}>Evaluate</button></div>
      {currentMeasurement != null && <div className="measurementHero"><span>CURRENT PREDICTED DISTANCE</span><strong>{currentMeasurement.toFixed(3)} m</strong></div>}
      {evalResult && <div className="verifyBox"><span>Known {evalResult.known_distance_m.toFixed(3)} m</span><span>Absolute error {evalResult.absolute_error_m.toFixed(3)} m</span><span>Relative error {evalResult.relative_error_percent.toFixed(2)}%</span><span>Within 5 cm: {evalResult.within_5cm ? 'YES' : 'NO'}</span></div>}
    </section>

    {s.regionResult && <section><SectionTitle title="REGION / ROI" /><div className="metricGrid"><Metric label="Pixels" value={s.regionResult.pixel_count.toLocaleString()} /><Metric label="Valid depth" value={s.regionResult.valid_depth_pixels.toLocaleString()} /><Metric label="Median depth" value={s.regionResult.depth_median_m == null ? '—' : `${s.regionResult.depth_median_m.toFixed(2)} m`} /><Metric label="Width" value={s.regionResult.dimensions_m ? `${s.regionResult.dimensions_m[0].toFixed(2)} m` : '—'} /><Metric label="Height" value={s.regionResult.dimensions_m ? `${s.regionResult.dimensions_m[1].toFixed(2)} m` : '—'} /><Metric label="Area" value={s.regionResult.surface_area_m2 == null ? '—' : `${s.regionResult.surface_area_m2.toFixed(2)} m²`} /></div></section>}

    {s.profile && <section><SectionTitle title="DEPTH PROFILE" /><Profile data={s.profile.depth_m} /><div className="small">{s.profile.start.join(', ')} → {s.profile.end.join(', ')} · {s.profile.samples} samples · path ≈ {(s.profile.distance_m.at(-1) ?? 0).toFixed(2)} m</div></section>}

    <section>
      <SectionTitle title="ANNOTATIONS" />
      {s.annotations.length ? <div className="historyList">{s.annotations.map((a) => <div className="historyItem" key={a.id}><button onClick={()=>s.set({selected:a.point,cameraView:'selected',rightPanel:'inspect'})}><b>{a.name}</b><span>{a.point.x_m.toFixed(2)}, {a.point.y_m.toFixed(2)}, {a.point.z_m.toFixed(2)} m</span></button><button className="dangerMini" onClick={async()=>{const next=s.annotations.filter(x=>x.id!==a.id);s.set({annotations:next});await saveAnnotations(scene.scene_id,next).catch(()=>{})}}>×</button></div>)}</div> : <div className="emptyState">No annotations yet.</div>}
    </section>

    <section>
      <SectionTitle title="RUNTIME" />
      <div className="qualityBox"><Row n="Model" v={scene.model} /><Row n="Dataset" v={scene.model_dataset} /><Row n="Input" v={`${scene.quality.model_input_size ?? '—'} px`} /><Row n="Inference" v={`${scene.quality.inference_seconds ?? '—'} s`} /><Row n="Device" v={sys?.gpu_name || sys?.device || '—'} /><Row n="VRAM allocated" v={sys?.gpu_memory ? `${(sys.gpu_memory.allocated_bytes / 1073741824).toFixed(2)} GB` : '—'} /><Row n="Source revision" v={scene.model_source_commit.slice(0,8)} /></div>
    </section>
  </aside>
}

function SectionTitle({ title }: { title: string }) { return <div className="sectionTitle"><span>{title}</span></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><b>{value}</b></div> }
function Row({ n, v }: { n: string; v: string }) { return <div className="simpleRow"><span>{n}</span><b>{v}</b></div> }
function Profile({ data }: { data: (number | null)[] }) { const values=data.filter((v):v is number=>v!=null);const mn=values.length?Math.min(...values):0;const mx=values.length?Math.max(...values):1;const pts=data.map((v,i)=>v==null?null:[i/Math.max(data.length-1,1)*100,100-(v-mn)/Math.max(mx-mn,1e-6)*92]).filter(Boolean) as [number,number][];return <div className="profileChart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={pts.map(([x,y])=>`${x},${y}`).join(' ')} /></svg><div className="profileAxis"><span>{mn.toFixed(2)} m</span><span>{mx.toFixed(2)} m</span></div></div> }
