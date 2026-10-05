import { useSceneStore } from '../store/useSceneStore'

export function StatusBar() {
  const s = useSceneStore(); const scene = s.scene
  if (!scene) return null
  const slotState = `A ${s.measurementA ? '●' : '○'} · B ${s.measurementB ? '●' : '○'} · C ${s.measurementC ? '●' : '○'}`
  return <div className="statusBar">
    <span>SCENE <b>{scene.scene_id.slice(0,8)}</b></span>
    <span>{scene.point_counts[0].toLocaleString()} POINTS</span>
    <span>{scene.scene_type.toUpperCase()}</span>
    <span>CAL <b>{scene.calibration.quality?.label?.toUpperCase() || '—'}</b></span>
    <span>DEPTH <b>{scene.depth_min_m.toFixed(2)}–{scene.depth_max_m.toFixed(2)} m</b></span>
    <span>MEASURE <b>{slotState}</b></span>
    <span>VIEW <b>{s.depthExaggeration.toFixed(1)}× Z</b></span>
    <span className="statusSpacer" />
    <span>LOCAL · GPU / WEBGL</span>
  </div>
}
