import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { deleteScene, exportZip, getScene, importScene, listScenes } from '../api/client'
import { ExportPanel } from './ExportPanel'
import { useSceneStore } from '../store/useSceneStore'
import type { SceneSummary } from '../types'

export function ProjectPanel() {
  const s = useSceneStore()
  const [items, setItems] = useState<SceneSummary[]>([])
  const file = useRef<HTMLInputElement>(null)

  const refresh = () => {
    listScenes()
      .then(setItems)
      .catch(() => {})
  }

  useEffect(() => {
    refresh()
  }, [])

  const open = async (id: string) => {
    const scene = await getScene(id)
    s.set({
      sceneId: id,
      scene,
      compareScene: null,
      selected: null,
      measurementA: null,
      measurementB: null,
      measurementC: null,
      mode: 'split',
    })
  }

  const compare = async (id: string) => {
    const scene = await getScene(id)
    if (scene.scene_id === s.scene?.scene_id) return
    s.set({ compareScene: scene, mode: 'compare' })
  }

  const importS3D = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) return

    try {
      const scene = await importScene(selectedFile)
      s.set({
        sceneId: scene.scene_id,
        scene,
        selected: null,
        measurementA: null,
        measurementB: null,
        measurementC: null,
        mode: 'split',
      })
      refresh()
    } catch (error) {
      alert(String(error))
    } finally {
      event.currentTarget.value = ''
    }
  }

  const remove = async (id: string) => {
    const confirmed = window.confirm(`Delete scene ${id.slice(0, 8)}? This cannot be undone.`)
    if (!confirmed) return

    try {
      await deleteScene(id)
      refresh()
      if (s.scene?.scene_id === id) {
        s.set({ sceneId: null, scene: null })
      }
    } catch (error) {
      alert(String(error))
    }
  }

  return (
    <div className="projectPanel panelScroll">
      <section>
        <h3>SCENE FILE</h3>
        <div className="small">
          `.s3d` is a portable reconstruction package containing depth, point cloud, calibration,
          analysis, annotations and optional mesh.
        </div>

        <div className="measureBtns">
          <button disabled={!s.history.length} onClick={() => s.undo()}>
            Undo
          </button>
          <button disabled={!s.future.length} onClick={() => s.redo()}>
            Redo
          </button>
        </div>

        <div className="measureBtns">
          <a
            className="buttonLike"
            href={s.scene ? exportZip(s.scene.scene_id) : '#'}
            download
            onClick={(event) => {
              if (!s.scene) event.preventDefault()
            }}
          >
            Save .s3d
          </a>
          <button onClick={() => file.current?.click()}>Open .s3d</button>
        </div>

        <input
          ref={file}
          hidden
          type="file"
          accept=".s3d,.zip,application/zip"
          onChange={importS3D}
        />
      </section>

      {s.scene && (
        <section className="projectExport">
          <h3>ARTIFACT EXPORTS</h3>
          <div className="small">
            Download individual reconstruction artifacts without rebuilding the complete `.s3d` package.
          </div>
          <ExportPanel />
        </section>
      )}

      <section>
        <h3>SAVED SCENES</h3>
        {items.length ? (
          items.map((item) => (
            <div className="savedScene" key={item.scene_id}>
              <button onClick={() => open(item.scene_id)}>
                <b>{item.scene_id.slice(0, 8)}</b>
                <span>
                  {item.scene_type} · {item.point_count.toLocaleString()} pts
                </span>
              </button>

              <div className="sceneMiniActions">
                <button
                  className="mini"
                  disabled={item.scene_id === s.scene?.scene_id}
                  onClick={() => compare(item.scene_id)}
                >
                  Compare
                </button>
                <button className="dangerMini" onClick={() => remove(item.scene_id)} title="Delete scene">
                  ×
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="small">No persisted scenes yet.</div>
        )}
      </section>
    </div>
  )
}
