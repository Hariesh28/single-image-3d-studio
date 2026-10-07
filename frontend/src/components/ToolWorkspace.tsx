import { region, saveAnnotations } from '../api/client'
import { useSceneStore } from '../store/useSceneStore'
import type { RegionShape } from '../types'

export function ToolWorkspace() {
  const s = useSceneStore()
  const tool = s.tool
  const title = tool === 'annotate' ? 'ANNOTATE' : tool === 'region' ? 'REGION ANALYSIS' : 'DEPTH PROFILE'

  const finishRegion = async () => {
    if (!s.sceneId || s.regionPoints.length < 3) return
    s.set({ toolMessage: '' })
    try {
      const result = await region(s.sceneId, s.regionPoints)
      s.set({ regionResult: result })
      s.set({ toolMessage: 'Region analysis complete.' })
    } catch (error) {
      s.set({ toolMessage: String(error) })
    }
  }

  const removeAnnotation = async (id: string) => {
    if (!s.sceneId) return
    const next = s.annotations.filter((annotation) => annotation.id !== id)
    s.set({ toolMessage: '' })
    try {
      await saveAnnotations(s.sceneId, next)
      s.set({ annotations: next, selectedAnnotationId: s.selectedAnnotationId === id ? null : s.selectedAnnotationId })
      s.set({ toolMessage: 'Annotation deleted.' })
    } catch (error) {
      s.set({ toolMessage: String(error) })
    }
  }

  const selectAnnotation = (annotation: (typeof s.annotations)[number]) => {
    s.set({
      selected: annotation.point,
      selectedAnnotationId: annotation.id,
      tool: 'inspect',
      rightPanel: 'inspect',
    })
    s.requestCameraReset('selected')
  }

  return (
    <aside className="studioPanel panelScroll">
      <div className="panelHeaderBlock">
        <div className="eyebrow">IMAGE-SPACE WORKFLOW</div>
        <h2>{title}</h2>
        <p>{toolDescription(tool)}</p>
      </div>

      {tool === 'annotate' && (
        <>
          <section className="toolCard highlightCard">
            <div className="toolCardHeader"><div><h4>ADD ANNOTATION</h4><p>Click a valid point in Image, Depth or 3D, then enter a name.</p></div></div>
            <div className="validationBox"><span>Saved annotations</span><b>{s.annotations.length}</b></div>
            <button className="full ghostButton" disabled={!s.selected} onClick={() => s.set({ tool: 'inspect', rightPanel: 'inspect' })}>Inspect selected point</button>
          </section>
          <section>
            <SectionTitle title="ANNOTATIONS" />
            {s.annotations.length ? <div className="annotationList">{s.annotations.map((annotation) => (
              <div className="annotationItem" key={annotation.id}>
                <button className="annotationSelect" onClick={() => selectAnnotation(annotation)}>
                  <b>{annotation.name}</b>
                  <span>Pixel {annotation.point.pixel_x}, {annotation.point.pixel_y}</span>
                  <small>{annotation.point.x_m.toFixed(2)}, {annotation.point.y_m.toFixed(2)}, {annotation.point.z_m.toFixed(2)} m</small>
                </button>
                <button className="dangerMini" aria-label={`Delete ${annotation.name}`} onClick={() => removeAnnotation(annotation.id)}>×</button>
              </div>
            ))}</div> : <div className="emptyState">No annotations yet. Choose a visible point to create the first one.</div>}
          </section>
        </>
      )}

      {tool === 'region' && (
        <>
          <section className="toolCard highlightCard">
            <SectionTitle title="DRAW REGION" />
            <label className="field"><span>Shape</span><select value={s.regionShape} onChange={(event) => s.set({ regionShape: event.target.value as RegionShape, regionPoints: [], regionResult: null, toolMessage: '' })}>
              <option value="polygon">Polygon</option><option value="rectangle">Rectangle</option><option value="lasso">Freehand lasso</option>
            </select></label>
            <div className="small">{regionInstructions(s.regionShape)}</div>
            {s.regionPoints.length > 0 && <div className="validationBox"><span>Boundary points</span><b>{s.regionPoints.length}</b></div>}
            <div className="buttonRow">
              <button className="primaryButton" disabled={s.regionPoints.length < 3} onClick={finishRegion}>Analyze region</button>
              <button className="ghostButton" disabled={!s.regionPoints.length && !s.regionResult} onClick={() => s.set({ regionPoints: [], regionResult: null, toolMessage: '' })}>Clear</button>
            </div>
          </section>
          {s.regionResult && <section>
            <SectionTitle title="REGION RESULTS" />
            <div className="metricGrid">
              <Metric label="Pixels" value={s.regionResult.pixel_count.toLocaleString()} />
              <Metric label="Valid depth" value={s.regionResult.valid_depth_pixels.toLocaleString()} />
              <Metric label="Coverage" value={`${(s.regionResult.coverage_fraction * 100).toFixed(1)}%`} />
              <Metric label="Median depth" value={s.regionResult.depth_median_m == null ? '—' : `${s.regionResult.depth_median_m.toFixed(2)} m`} />
              <Metric label="Dimensions" value={s.regionResult.dimensions_m ? s.regionResult.dimensions_m.map((value) => value.toFixed(2)).join(' × ') + ' m' : '—'} />
              <Metric label="Surface area" value={s.regionResult.surface_area_m2 == null ? '—' : `${s.regionResult.surface_area_m2.toFixed(2)} m²`} />
              <Metric label="BBox volume" value={s.regionResult.bbox_volume_m3 == null ? '—' : `${s.regionResult.bbox_volume_m3.toFixed(3)} m³`} />
            </div>
          </section>}
        </>
      )}

      {tool === 'profile' && (
        <>
          <section className="toolCard highlightCard">
            <SectionTitle title="CROSS-SECTION" />
            <div className="small">{s.profile ? 'Profile generated. Click a new start point to create another.' : s.profileStart ? 'Start point set. Click the end point in Image or Depth.' : 'Click a start point, then an end point in Image or Depth.'}</div>
            {s.profileStart && <div className="validationBox"><span>Start pixel</span><b>{s.profileStart[0]}, {s.profileStart[1]}</b></div>}
            <button className="full ghostButton" disabled={!s.profileStart && !s.profile} onClick={() => s.set({ profileStart: null, profile: null, toolMessage: '' })}>Clear profile</button>
          </section>
          {s.profile && <section>
            <SectionTitle title="PROFILE RESULTS" />
            <ProfileChart values={s.profile.depth_m} />
            <div className="metricGrid profileMetrics">
              <Metric label="Start" value={s.profile.start.join(', ')} />
              <Metric label="End" value={s.profile.end.join(', ')} />
              <Metric label="Pixel length" value={`${s.profile.pixel_length.toFixed(1)} px`} />
              <Metric label="Valid samples" value={`${s.profile.depth_m.filter((value) => value != null).length} / ${s.profile.samples}`} />
              <Metric label="Path length" value={`${(s.profile.distance_m.at(-1) ?? 0).toFixed(3)} m`} />
            </div>
          </section>}
        </>
      )}

      {s.toolMessage && <div className={s.toolMessage.endsWith('complete.') || s.toolMessage.endsWith('generated.') || s.toolMessage.endsWith('saved.') || s.toolMessage.endsWith('deleted.') ? 'notice' : 'error'} role="status">{s.toolMessage}</div>}
      <button className="full ghostButton" onClick={() => s.set({ rightPanel: 'controls' })}>Open scene controls</button>
    </aside>
  )
}

function toolDescription(tool: string) {
  if (tool === 'annotate') return 'Name and revisit meaningful points in the reconstructed scene.'
  if (tool === 'region') return 'Draw an image-space region and inspect its metric depth and 3D bounds.'
  return 'Sample metric depth and cumulative 3D path length along an image-space line.'
}

function regionInstructions(shape: RegionShape) {
  if (shape === 'rectangle') return 'Click two opposite corners in Image or Depth. The region is analyzed when the second corner is set.'
  if (shape === 'lasso') return 'Press and drag across Image or Depth to draw a freehand region.'
  return 'Click vertices in Image or Depth, then choose Analyze region or DONE on the viewport.'
}

function SectionTitle({ title }: { title: string }) { return <div className="sectionTitle"><span>{title}</span></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><b>{value}</b></div> }

function ProfileChart({ values }: { values: (number | null)[] }) {
  const valid = values.filter((value): value is number => value != null)
  if (!valid.length) return <div className="emptyState">This line contains no valid depth samples.</div>
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const points = values.map((value, index) => value == null ? null : `${(index / Math.max(1, values.length - 1)) * 100},${96 - ((value - min) / Math.max(max - min, 1e-6)) * 88}`).filter(Boolean).join(' ')
  return <div className="profileChart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Depth profile from ${min.toFixed(2)} to ${max.toFixed(2)} meters`}><polyline points={points} /></svg><div className="profileAxis"><span>{min.toFixed(2)} m</span><span>{max.toFixed(2)} m</span></div></div>
}
