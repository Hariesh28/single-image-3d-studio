import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react'
import { artifact, getPoint, profile, region, saveAnnotations } from '../api/client'
import { useSceneStore } from '../store/useSceneStore'
import type { PointInfo } from '../types'

type Props = {
  src: string
  title: string
  depth?: boolean
  min?: number
  max?: number
}

type Box = { left: number; top: number; width: number; height: number }
type DragState = { startX: number; startY: number; startPanX: number; startPanY: number; moved: boolean }

/**
 * A robust synchronized image/depth viewport.
 *
 * The previous implementation positioned an auto-sized absolutely-positioned
 * element at 50% and then translated the child image by -50%. That makes the
 * final rendered image dependent on shrink-to-fit behavior and can easily put
 * the image outside the visible viewport. Here the fitted image rectangle is
 * calculated explicitly and the image + every overlay share the same transform.
 */
export function MediaPanel({ src, title, depth = false, min, max }: Props) {
  const scene = useSceneStore((s) => s.scene)
  const sceneId = useSceneStore((s) => s.sceneId)
  const selected = useSceneStore((s) => s.selected)
  const hover = useSceneStore((s) => s.hover)
  const tool = useSceneStore((s) => s.tool)
  const measurementA = useSceneStore((s) => s.measurementA)
  const measurementB = useSceneStore((s) => s.measurementB)
  const measurementC = useSceneStore((s) => s.measurementC)
  const annotations = useSceneStore((s) => s.annotations)
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId)
  const regionShape = useSceneStore((s) => s.regionShape)
  const polygon = useSceneStore((s) => s.regionPoints)
  const profileStart = useSceneStore((s) => s.profileStart)
  const set = useSceneStore((s) => s.set)

  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const dragRef = useRef<DragState | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [box, setBox] = useState<Box | null>(null)
  const [imageError, setImageError] = useState(false)
  const [imageReady, setImageReady] = useState(false)
  const [lassoDrawing, setLassoDrawing] = useState(false)

  const recalculateBox = useCallback(() => {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport || !scene) return

    const rect = viewport.getBoundingClientRect()
    const naturalWidth = image?.naturalWidth || scene.width
    const naturalHeight = image?.naturalHeight || scene.height
    if (!naturalWidth || !naturalHeight || rect.width <= 0 || rect.height <= 0) return

    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
    const width = Math.max(1, naturalWidth * scale)
    const height = Math.max(1, naturalHeight * scale)
    setBox({
      left: (rect.width - width) / 2,
      top: (rect.height - height) / 2,
      width,
      height,
    })
  }, [scene])

  useLayoutEffect(() => {
    recalculateBox()
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(recalculateBox)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [recalculateBox])

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setImageError(false)
    setImageReady(false)
  }, [src])

  const map = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current
    if (!scene || !frame) return null
    const rect = frame.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null

    const x = ((clientX - rect.left) / rect.width) * scene.width
    const y = ((clientY - rect.top) / rect.height) * scene.height
    return {
      x: Math.round(Math.max(0, Math.min(scene.width - 1, x))),
      y: Math.round(Math.max(0, Math.min(scene.height - 1, y))),
    }
  }, [scene])

  const handlePoint = useCallback(async (x: number, y: number) => {
    if (!sceneId) return
    const info = await getPoint(sceneId, x, y)
    const current = useSceneStore.getState()

    if (tool === 'measure') {
      const slot = current.measureSlot
      const payload: any = { selected: info, hover: info, rightPanel: 'measure' }
      if (slot === 'A') { payload.measurementA = info; payload.measureSlot = 'B' }
      else if (slot === 'B') { payload.measurementB = info; payload.measureSlot = 'C' }
      else { payload.measurementC = info; payload.measureSlot = 'A' }
      set(payload)
      return
    }

    if (tool === 'annotate') {
      const name = window.prompt('Annotation name', `Point ${annotations.length + 1}`)
      if (!name?.trim()) return
      const item = {
        id: crypto.randomUUID(),
        name: name.trim(),
        point: info,
        color: '#67e8f9',
        note: '',
      }
      const next = [...useSceneStore.getState().annotations, item]
      set({ selected: info, hover: info, annotations: next })
      await saveAnnotations(sceneId, next)
      return
    }

    set({ selected: info, hover: info })
  }, [annotations.length, sceneId, set, tool])

  const finishRegion = useCallback(async (override?: [number, number][]) => {
    if (!sceneId) return
    const points = [...(override ?? useSceneStore.getState().regionPoints)]
    if (points.length < 3) return
    try {
      const out = await region(sceneId, points)
      set({ regionResult: out, regionPoints: points })
    } catch (error) {
      console.error(error)
    }
  }, [sceneId, set])

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button')) return

    if (tool === 'region' && regionShape === 'lasso') {
      const point = map(event.clientX, event.clientY)
      if (!point) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      set({ regionPoints: [[point.x, point.y]], regionResult: null })
      setLassoDrawing(true)
      return
    }

    if (tool === 'region' || tool === 'profile') return

    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
    }
  }

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lassoDrawing) {
      const point = map(event.clientX, event.clientY)
      if (!point) return
      const current = useSceneStore.getState().regionPoints
      const last = current.at(-1)
      if (!last || Math.hypot(point.x - last[0], point.y - last[1]) >= 2) {
        set({ regionPoints: [...current, [point.x, point.y]], regionResult: null })
      }
      return
    }

    const drag = dragRef.current
    if (drag) {
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (Math.hypot(dx, dy) > 4) drag.moved = true
      setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy })
      return
    }

    if (!sceneId) return
    const point = map(event.clientX, event.clientY)
    if (!point) return

    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      getPoint(sceneId, point.x, point.y)
        .then((value) => set({ hover: value }))
        .catch(() => set({ hover: null }))
    }, 60)
  }

  const pointerUp = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lassoDrawing) {
      setLassoDrawing(false)
      try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* noop */ }
      await finishRegion()
      return
    }

    const drag = dragRef.current
    if (drag) {
      const moved = drag.moved
      dragRef.current = null
      try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* noop */ }
      if (moved) return
    }

    const point = map(event.clientX, event.clientY)
    if (!point || !sceneId) return

    if (tool === 'region') {
      const current = useSceneStore.getState().regionPoints
      if (regionShape === 'rectangle') {
        if (current.length === 0) {
          set({ regionPoints: [[point.x, point.y]], regionResult: null })
        } else {
          const [start] = current
          const x0 = Math.min(start[0], point.x)
          const y0 = Math.min(start[1], point.y)
          const x1 = Math.max(start[0], point.x)
          const y1 = Math.max(start[1], point.y)
          const rectangle: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
          set({ regionPoints: rectangle, regionResult: null })
          await finishRegion(rectangle)
        }
      } else {
        set({ regionPoints: [...current, [point.x, point.y]], regionResult: null })
      }
      return
    }

    if (tool === 'profile') {
      const current = useSceneStore.getState()
      if (!current.profileStart) {
        set({ profileStart: [point.x, point.y], profile: null })
      } else {
        try {
          const output = await profile(sceneId, current.profileStart, [point.x, point.y])
          set({ profile: output, profileStart: null })
        } catch (error) {
          console.error(error)
          set({ profileStart: null })
        }
      }
      return
    }

    try {
      await handlePoint(point.x, point.y)
    } catch (error) {
      console.error(error)
    }
  }

  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const current = zoom
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
    const next = Math.min(8, Math.max(1, current * factor))
    if (next === current) return

    // Zoom toward the cursor so inspection is much easier on large images.
    const frame = frameRef.current
    const viewport = viewportRef.current
    if (frame && viewport) {
      const vr = viewport.getBoundingClientRect()
      const fr = frame.getBoundingClientRect()
      const cursorX = event.clientX - (vr.left + vr.width / 2)
      const cursorY = event.clientY - (vr.top + vr.height / 2)
      const frameCenterX = fr.left - (vr.left + vr.width / 2) + fr.width / 2
      const frameCenterY = fr.top - (vr.top + vr.height / 2) + fr.height / 2
      const ratio = next / current
      setPan((p) => ({
        x: p.x + (cursorX - frameCenterX) * (1 - ratio),
        y: p.y + (cursorY - frameCenterY) * (1 - ratio),
      }))
    }
    setZoom(next)
  }

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    set({ hover: null })
  }

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
  }, [])

  const selectedObject = selectedObjectId != null
    ? scene?.segmentation.objects.find((entry) => entry.id === selectedObjectId)
    : null

  const markerStyle = (point: PointInfo | null): CSSProperties | undefined => {
    if (!point || !scene) return undefined
    return {
      left: `${(point.pixel_x / Math.max(1, scene.width - 1)) * 100}%`,
      top: `${(point.pixel_y / Math.max(1, scene.height - 1)) * 100}%`,
    }
  }

  const polygonPoints = polygon.map((point) => `${(point[0] / scene!.width) * 100},${(point[1] / scene!.height) * 100}`)
  if (polygon.length >= 3 && regionShape !== 'lasso') polygonPoints.push(polygonPoints[0])

  return (
    <div
      ref={viewportRef}
      className="mediaPanel"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => { dragRef.current = null; setLassoDrawing(false) }}
      onWheel={wheel}
      onContextMenu={(event) => event.preventDefault()}
      onDoubleClick={tool === 'region' && regionShape === 'polygon' ? () => finishRegion() : undefined}
    >
      <div className="mediaLabel">{title}{depth ? ' · METRIC' : ''}</div>

      <div className="mediaControls">
        <button onClick={resetView}>FIT</button>
        <button onClick={() => setZoom((value) => Math.min(8, value * 1.15))}>+</button>
        <button onClick={() => setZoom((value) => Math.max(1, value / 1.15))}>−</button>
        {tool === 'region' && regionShape === 'polygon' && <button onClick={() => finishRegion()}>DONE</button>}
        {tool === 'region' && regionShape === 'lasso' && lassoDrawing && <span className="small">DRAWING</span>}
      </div>

      <div
        className="mediaStage"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <div
          ref={frameRef}
          className={`mediaFrame ${box ? '' : 'loadingFrame'}`}
          style={box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { left: 0, top: 0, width: '100%', height: '100%' }}
        >
          <img
            ref={imageRef}
            src={src}
            alt={title}
            draggable={false}
            style={!box ? { objectFit: 'contain' } : undefined}
            onLoad={() => { setImageReady(true); setImageError(false); recalculateBox() }}
            onError={() => { setImageError(true); setImageReady(false) }}
          />

            {selectedObject && sceneId && (
              <img
                className="maskOverlay"
                src={artifact(sceneId, selectedObject.mask_artifact)}
                alt=""
              />
            )}

            {tool === 'measure' && scene && (
              <>
                {measurementA && <PointMarker point={measurementA} label="A" scene={scene} className="measure-marker-a" />}
                {measurementB && <PointMarker point={measurementB} label="B" scene={scene} className="measure-marker-b" />}
                {measurementC && <PointMarker point={measurementC} label="C" scene={scene} className="measure-marker-c" />}
                {measurementA && measurementB && (
                  <svg className="overlaySvg measurementSvg" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <line x1={(measurementA.pixel_x / Math.max(1, scene.width - 1)) * 100} y1={(measurementA.pixel_y / Math.max(1, scene.height - 1)) * 100} x2={(measurementB.pixel_x / Math.max(1, scene.width - 1)) * 100} y2={(measurementB.pixel_y / Math.max(1, scene.height - 1)) * 100} />
                    {measurementC && <polyline points={`${(measurementA.pixel_x / Math.max(1, scene.width - 1)) * 100},${(measurementA.pixel_y / Math.max(1, scene.height - 1)) * 100} ${(measurementB.pixel_x / Math.max(1, scene.width - 1)) * 100},${(measurementB.pixel_y / Math.max(1, scene.height - 1)) * 100} ${(measurementC.pixel_x / Math.max(1, scene.width - 1)) * 100},${(measurementC.pixel_y / Math.max(1, scene.height - 1)) * 100}`} />}
                  </svg>
                )}
              </>
            )}
            {selected && <div className="crosshair" style={markerStyle(selected)} />}
            {hover && !selected && <div className="hoverDot" style={markerStyle(hover)} />}

            {tool === 'region' && polygon.length > 0 && scene && (
              <svg className="overlaySvg" viewBox="0 0 100 100" preserveAspectRatio="none">
                {polygon.map((point, index) => (
                  <circle key={index} cx={(point[0] / scene.width) * 100} cy={(point[1] / scene.height) * 100} r="0.9" />
                ))}
                <polyline points={polygonPoints.join(' ')} />
              </svg>
            )}

            {tool === 'profile' && profileStart && scene && (
              <div className="profileStartDot" style={{
                left: `${(profileStart[0] / Math.max(1, scene.width - 1)) * 100}%`,
                top: `${(profileStart[1] / Math.max(1, scene.height - 1)) * 100}%`,
              }} />
            )}

            {!imageReady && !imageError && (
              <div className="mediaLoading">Loading {depth ? 'depth' : 'image'}…</div>
            )}
            {imageError && (
              <div className="mediaError">
                <b>Unable to load {depth ? 'depth image' : 'source image'}</b>
                <span>Check the backend artifact endpoint and browser console.</span>
              </div>
            )}
        </div>
      </div>

      {hover && !lassoDrawing && (
        <div className="hoverReadout">
          <b>{hover.pixel_x}, {hover.pixel_y}</b>
          <span>{hover.z_m.toFixed(2)} m · XYZ {hover.x_m.toFixed(2)}, {hover.y_m.toFixed(2)}</span>
        </div>
      )}

      {min !== undefined && max !== undefined && (
        <div className="depthLegend">
          <span>{min.toFixed(2)} m</span>
          <b>DEPTH</b>
          <span>{max.toFixed(2)} m</span>
        </div>
      )}
    </div>
  )
}

function PointMarker({ point, label, scene, className }: { point: PointInfo; label: string; scene: any; className: string }) {
  const left = `${(point.pixel_x / Math.max(1, scene.width - 1)) * 100}%`
  const top = `${(point.pixel_y / Math.max(1, scene.height - 1)) * 100}%`
  return <div className={`measurePointMarker ${className}`} style={{ left, top }}><b>{label}</b><span>{point.z_m.toFixed(2)} m</span></div>
}
