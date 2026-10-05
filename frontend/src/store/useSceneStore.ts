import { create } from 'zustand'
import type {
  Annotation,
  CameraView,
  ColorMode,
  CrossSection,
  Mode,
  PointInfo,
  RegionResult,
  RegionShape,
  ToolMode,
  Scene,
} from '../types'

export type MeasureSlot = 'A' | 'B' | 'C'
export type RightPanel = 'controls' | 'inspect' | 'measure' | 'analysis' | 'project'

export interface MeasurementRecord {
  id: string
  name: string
  created_at: number
  a: [number, number, number]
  b: [number, number, number]
  c?: [number, number, number]
  delta: [number, number, number]
  distance_m: number
  horizontal_distance_m: number
  vertical_difference_m: number
  depth_difference_m: number
  angle_deg?: number | null
}

interface Store {
  sceneId: string | null
  scene: Scene | null
  mode: Mode
  tool: ToolMode
  rightPanel: RightPanel
  selected: PointInfo | null
  hover: PointInfo | null
  measurementA: PointInfo | null
  measurementB: PointInfo | null
  measurementC: PointInfo | null
  measureSlot: MeasureSlot
  measurementHistory: MeasurementRecord[]
  annotations: Annotation[]
  selectedAnnotationId: string | null
  selectedObjectId: number | null
  regionPoints: [number, number][]
  regionShape: RegionShape
  regionResult: RegionResult | null
  profile: CrossSection | null
  profileStart: [number, number] | null
  density: 0 | 1 | 2 | 3
  pointSize: number
  pointBudget: number
  pointOpacity: number
  colorMode: ColorMode
  rgb: boolean
  depthExaggeration: number
  nearDepth: number
  farDepth: number
  background: string
  showGrid: boolean
  showAxes: boolean
  showFrustum: boolean
  showPlanes: boolean
  showGround: boolean
  showMesh: boolean
  showCamera: boolean
  showLabels: boolean
  showContours: boolean
  adaptiveLod: boolean
  depthColormap: 'turbo' | 'viridis' | 'jet' | 'magma' | 'inferno' | 'plasma' | 'grayscale'
  depthDisplay: 'metric' | 'inverse' | 'log'
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  cameraView: CameraView
  resetCameraKey: number
  compareScene: any | null
  parallaxStrength: number
  parallaxYaw: number
  parallaxPitch: number
  history: Record<string, unknown>[]
  future: Record<string, unknown>[]
  set: (v: Partial<Store>) => void
  reset: () => void
  requestCameraReset: (view?: CameraView) => void
  snapshot: () => void
  undo: () => void
  redo: () => void
}

const initial: Omit<Store, 'set' | 'reset' | 'requestCameraReset' | 'snapshot' | 'undo' | 'redo'> = {
  sceneId: null,
  scene: null,
  mode: 'split',
  tool: 'inspect',
  rightPanel: 'inspect',
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
  regionShape: 'polygon',
  regionResult: null,
  profile: null,
  profileStart: null,
  density: 0,
  pointSize: 2.2,
  pointBudget: 2_000_000,
  pointOpacity: 0.96,
  colorMode: 'rgb',
  rgb: true,
  depthExaggeration: 1,
  nearDepth: 0.05,
  farDepth: 80,
  background: '#050b13',
  showGrid: true,
  showAxes: true,
  showFrustum: false,
  showPlanes: false,
  showGround: false,
  showMesh: false,
  showCamera: true,
  showLabels: true,
  showContours: false,
  adaptiveLod: true,
  depthColormap: 'turbo',
  depthDisplay: 'metric',
  minX: -Infinity,
  maxX: Infinity,
  minY: -Infinity,
  maxY: Infinity,
  minZ: -Infinity,
  maxZ: Infinity,
  cameraView: 'home',
  resetCameraKey: 0,
  compareScene: null,
  parallaxStrength: 0.65,
  parallaxYaw: 0,
  parallaxPitch: 0,
  history: [],
  future: [],
}

const snapshotKeys = (s: Store) => ({
  mode: s.mode,
  tool: s.tool,
  rightPanel: s.rightPanel,
  selected: s.selected,
  measurementA: s.measurementA,
  measurementB: s.measurementB,
  measurementC: s.measurementC,
  measureSlot: s.measureSlot,
  measurementHistory: s.measurementHistory,
  annotations: s.annotations,
  selectedAnnotationId: s.selectedAnnotationId,
  selectedObjectId: s.selectedObjectId,
  regionPoints: s.regionPoints,
  regionShape: s.regionShape,
  profileStart: s.profileStart,
  density: s.density,
  pointSize: s.pointSize,
  pointBudget: s.pointBudget,
  pointOpacity: s.pointOpacity,
  colorMode: s.colorMode,
  rgb: s.rgb,
  depthExaggeration: s.depthExaggeration,
  nearDepth: s.nearDepth,
  farDepth: s.farDepth,
  background: s.background,
  showGrid: s.showGrid,
  showAxes: s.showAxes,
  showFrustum: s.showFrustum,
  showPlanes: s.showPlanes,
  showGround: s.showGround,
  showMesh: s.showMesh,
  showCamera: s.showCamera,
  showLabels: s.showLabels,
  adaptiveLod: s.adaptiveLod,
  showContours: s.showContours,
  depthColormap: s.depthColormap,
  depthDisplay: s.depthDisplay,
  minX: s.minX,
  maxX: s.maxX,
  minY: s.minY,
  maxY: s.maxY,
  minZ: s.minZ,
  maxZ: s.maxZ,
  parallaxStrength: s.parallaxStrength,
  parallaxYaw: s.parallaxYaw,
  parallaxPitch: s.parallaxPitch,
  cameraView: s.cameraView,
})

export const useSceneStore = create<Store>((set, get) => ({
  ...initial,
  set: (value) => set(value),
  reset: () => set({ ...initial }),
  requestCameraReset: (view = 'home') =>
    set((state) => ({ resetCameraKey: state.resetCameraKey + 1, cameraView: view })),
  snapshot: () => {
    const snap = snapshotKeys(get())
    set((state) => ({ history: [...state.history, snap].slice(-50), future: [] }))
  },
  undo: () =>
    set((state) => {
      if (!state.history.length) return state
      const history = [...state.history]
      const previous = history.pop()!
      const current = snapshotKeys(state)
      return { ...state, ...previous, history, future: [...state.future, current].slice(-50) }
    }),
  redo: () =>
    set((state) => {
      if (!state.future.length) return state
      const future = [...state.future]
      const next = future.pop()!
      const current = snapshotKeys(state)
      return { ...state, ...next, history: [...state.history, current].slice(-50), future }
    }),
}))
