import { useMemo, useState } from 'react'
import { measure } from '../api/client'
import { useSceneStore, type MeasureSlot, type MeasurementRecord } from '../store/useSceneStore'
import type { PointInfo } from '../types'

function xyz(p: PointInfo | null) {
  return p ? [p.x_m, p.y_m, p.z_m] as [number, number, number] : null
}

function distance(a: PointInfo, b: PointInfo) {
  const dx = b.x_m - a.x_m
  const dy = b.y_m - a.y_m
  const dz = b.z_m - a.z_m
  return {
    dx,
    dy,
    dz,
    distance: Math.hypot(dx, dy, dz),
    horizontal: Math.hypot(dx, dz),
    vertical: Math.abs(dy),
    depth: Math.abs(dz),
  }
}

function angle(a: PointInfo, b: PointInfo, c: PointInfo) {
  const v1 = [a.x_m - b.x_m, a.y_m - b.y_m, a.z_m - b.z_m]
  const v2 = [c.x_m - b.x_m, c.y_m - b.y_m, c.z_m - b.z_m]
  const n1 = Math.hypot(...v1)
  const n2 = Math.hypot(...v2)
  if (n1 < 1e-12 || n2 < 1e-12) return null
  const dot = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2)
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
}

export function MeasurePanel() {
  const s = useSceneStore()
  const [name, setName] = useState('Measurement')
  const [knownDistance, setKnownDistance] = useState('')
  const [message, setMessage] = useState('')
  const [verified, setVerified] = useState<any>(null)

  const current = useMemo(() => {
    if (!s.measurementA || !s.measurementB) return null
    const d = distance(s.measurementA, s.measurementB)
    return {
      ...d,
      angle: s.measurementC ? angle(s.measurementA, s.measurementB, s.measurementC) : null,
    }
  }, [s.measurementA, s.measurementB, s.measurementC])

  const assignSelected = (slot: MeasureSlot) => {
    if (!s.selected) return
    s.set({ [`measurement${slot}`]: s.selected } as any)
  }

  const clearSlot = (slot: MeasureSlot) => {
    s.set({ [`measurement${slot}`]: null } as any)
    if (s.measureSlot === slot) s.set({ measureSlot: slot })
  }

  const saveCurrent = () => {
    if (!s.measurementA || !s.measurementB || !current) return
    const record: MeasurementRecord = {
      id: crypto.randomUUID(),
      name: name.trim() || `Measurement ${s.measurementHistory.length + 1}`,
      created_at: Date.now(),
      a: xyz(s.measurementA)!,
      b: xyz(s.measurementB)!,
      c: xyz(s.measurementC) ?? undefined,
      delta: [current.dx, current.dy, current.dz],
      distance_m: current.distance,
      horizontal_distance_m: current.horizontal,
      vertical_difference_m: current.vertical,
      depth_difference_m: current.depth,
      angle_deg: current.angle,
    }
    s.set({ measurementHistory: [record, ...s.measurementHistory].slice(0, 100), rightPanel: 'measure' })
    setMessage('Saved to measurement history.')
  }

  const verify = async () => {
    if (!s.scene || !s.measurementA || !s.measurementB) return
    try {
      const out = await measure(
        s.scene.scene_id,
        xyz(s.measurementA)!,
        xyz(s.measurementB)!,
        s.measurementC ? xyz(s.measurementC)! : undefined,
      )
      setVerified(out)
      setMessage('Backend geometry check passed.')
    } catch (error) {
      setVerified(null)
      setMessage(String(error))
    }
  }

  const difference = knownDistance && current ? Math.abs(current.distance - Number(knownDistance)) : null
  const percent = difference != null && Number(knownDistance) > 0 ? (difference / Number(knownDistance)) * 100 : null

  return (
    <aside className="studioPanel panelScroll">
      <PanelHeader title="MEASURE" subtitle="Metric 3D measurements" />

      <section className="toolCard highlightCard">
        <div className="toolCardHeader">
          <div>
            <h4>CLICK WORKFLOW</h4>
            <p>Choose a slot, then click a point in Image, Depth or 3D.</p>
          </div>
          <span className="liveBadge">LIVE</span>
        </div>
        <div className="slotGrid">
          {(['A', 'B', 'C'] as MeasureSlot[]).map((slot) => {
            const point = slot === 'A' ? s.measurementA : slot === 'B' ? s.measurementB : s.measurementC
            return (
              <button key={slot} className={`measureSlot ${s.measureSlot === slot ? 'active' : ''}`} onClick={() => s.set({ measureSlot: slot })}>
                <span className="slotLetter">{slot}</span>
                <span>{point ? `${point.x_m.toFixed(2)}, ${point.y_m.toFixed(2)}, ${point.z_m.toFixed(2)}` : 'Click to set'}</span>
              </button>
            )
          })}
        </div>
        <div className="buttonRow">
          <button disabled={!s.selected} onClick={() => assignSelected(s.measureSlot)}>Use selected → {s.measureSlot}</button>
          <button className="ghostButton" onClick={() => s.set({ measurementA: null, measurementB: null, measurementC: null, measureSlot: 'A' })}>Clear all</button>
        </div>
      </section>

      <section>
        <SectionTitle title="POINTS" />
        <PointCard label="A" point={s.measurementA} active={s.measureSlot === 'A'} onSelect={() => s.set({ measureSlot: 'A' })} onClear={() => clearSlot('A')} />
        <PointCard label="B" point={s.measurementB} active={s.measureSlot === 'B'} onSelect={() => s.set({ measureSlot: 'B' })} onClear={() => clearSlot('B')} />
        <PointCard label="C" point={s.measurementC} active={s.measureSlot === 'C'} onSelect={() => s.set({ measureSlot: 'C' })} onClear={() => clearSlot('C')} optional />
      </section>

      <section>
        <SectionTitle title="CURRENT GEOMETRY" />
        {!current ? (
          <div className="emptyState">Set A and B to calculate a 3D distance. Add C for an angle at B.</div>
        ) : (
          <>
            <div className="measurementHero">
              <span>EUCLIDEAN A → B</span>
              <strong>{current.distance.toFixed(3)} m</strong>
            </div>
            <div className="metricGrid">
              <Metric label="ΔX" value={`${current.dx.toFixed(3)} m`} />
              <Metric label="ΔY" value={`${current.dy.toFixed(3)} m`} />
              <Metric label="ΔZ" value={`${current.dz.toFixed(3)} m`} />
              <Metric label="Horizontal" value={`${current.horizontal.toFixed(3)} m`} />
              <Metric label="Vertical" value={`${current.vertical.toFixed(3)} m`} />
              <Metric label="Depth" value={`${current.depth.toFixed(3)} m`} />
            </div>
            {current.angle != null && <div className="measurementHero angleHero"><span>ANGLE A → B → C</span><strong>{current.angle.toFixed(2)}°</strong></div>}
          </>
        )}
      </section>

      <section>
        <SectionTitle title="VALIDATION" />
        <p className="small">Compare the reconstructed 3D distance against a known real-world measurement.</p>
        <div className="inputRow">
          <input placeholder="Known distance (m)" type="number" min="0.001" step="0.001" value={knownDistance} onChange={(e) => setKnownDistance(e.target.value)} />
          <button disabled={!current || !knownDistance} onClick={() => setMessage('Reference value applied to validation only.')}>Apply</button>
        </div>
        {difference != null && percent != null && <div className="validationBox"><span>Absolute error</span><b>{difference.toFixed(3)} m · {percent.toFixed(2)}%</b></div>}
        <div className="buttonRow">
          <button disabled={!current} onClick={verify}>Verify backend math</button>
          <button disabled={!current} onClick={saveCurrent}>Save measurement</button>
        </div>
        {verified && <div className="verifyBox"><b>Backend result</b><span>{verified.distance_m.toFixed(6)} m</span><span>Horizontal {verified.horizontal_distance_m.toFixed(6)} m</span><span>Vertical Δ {verified.vertical_difference_m.toFixed(6)} m</span><span>Depth Δ {verified.depth_difference_m.toFixed(6)} m</span>{verified.angle_deg != null && <span>Angle {verified.angle_deg.toFixed(4)}°</span>}</div>}
      </section>

      <section>
        <SectionTitle title="SAVE AS" />
        <input className="full" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Measurement name" />
        {message && <div className="notice">{message}</div>}
      </section>

      <section>
        <SectionTitle title="HISTORY" />
        {s.measurementHistory.length === 0 ? <div className="emptyState">Saved measurements appear here.</div> : <div className="historyList">{s.measurementHistory.map((m) => <div className="historyItem" key={m.id}><div className="historyContent"><b>{m.name}</b><span>{m.distance_m.toFixed(3)} m{m.angle_deg != null ? ` · ${m.angle_deg.toFixed(1)}°` : ''}</span><small>{m.a.join(', ')} → {m.b.join(', ')}</small></div><div className="historyActions"><button className="mini" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(m, null, 2)); setMessage('Measurement JSON copied.') } catch { setMessage('Clipboard unavailable.') } }}>Copy</button><button className="dangerMini" aria-label={`Delete ${m.name}`} onClick={() => s.set({ measurementHistory: s.measurementHistory.filter(x => x.id !== m.id) })}>×</button></div></div>)}</div>}
      </section>
    </aside>
  )
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="panelHeaderBlock"><div className="eyebrow">WORKSPACE</div><h2>{title}</h2><p>{subtitle}</p></div>
}
function SectionTitle({ title }: { title: string }) { return <div className="sectionTitle"><span>{title}</span></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><b>{value}</b></div> }
function PointCard({ label, point, active, onSelect, onClear, optional }: { label: string; point: PointInfo | null; active: boolean; onSelect: () => void; onClear: () => void; optional?: boolean }) {
  return <div className={`pointCard ${active ? 'active' : ''}`}><button className="pointCardMain" onClick={onSelect}><span className={`pointBadge point-${label.toLowerCase()}`}>{label}</span><div><b>{point ? `${point.x_m.toFixed(3)}, ${point.y_m.toFixed(3)}, ${point.z_m.toFixed(3)} m` : optional ? 'Optional angle point' : 'Not set'}</b><small>{point ? `pixel ${point.pixel_x}, ${point.pixel_y} · Z ${point.depth_m.toFixed(3)} m` : 'Select this slot, then click the viewport'}</small></div></button>{point&&<button className="clearPoint" onClick={onClear}>×</button>}</div>
}
