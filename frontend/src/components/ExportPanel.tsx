import { artifact, exportPointsCsv } from '../api/client'
import { useSceneStore } from '../store/useSceneStore'

export function ExportPanel() {
  const scene = useSceneStore((s) => s.scene)
  if (!scene) return null
  const id = scene.scene_id
  const links = [
    ['Depth NPY', artifact(id, scene.artifacts.depth_npy || '')],
    ['Depth PNG', artifact(id, scene.artifacts.depth_image || '')],
    ['Point cloud PLY', artifact(id, scene.artifacts.ply || '')],
    ['Point cloud OBJ', artifact(id, scene.artifacts.obj || '')],
    ['Mesh GLB', scene.artifacts.mesh_glb ? artifact(id, scene.artifacts.mesh_glb) : null],
    ['Points CSV', exportPointsCsv(id, 200000, 0)],
  ] as const
  return <div className="exportLinks">{links.map(([label, url]) => url ? <a key={label} href={url}>{label}</a> : null)}</div>
}
