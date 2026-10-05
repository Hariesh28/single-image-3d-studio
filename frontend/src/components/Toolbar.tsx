import { useSceneStore } from '../store/useSceneStore'
import type { Mode, ToolMode } from '../types'

export function Toolbar({ onNew, onProject, onTool, onUserInteraction }: { onNew: () => void; onProject: () => void; onTool: (tool: ToolMode) => void; onUserInteraction: () => void }) {
  const s = useSceneStore()
  const modes: Mode[] = ['image', 'depth', '3d', 'split', 'compare', 'parallax']
  const tools: ToolMode[] = ['inspect', 'measure', 'annotate', 'region', 'profile']

  const activateTool = (tool: ToolMode) => {
    // Keep a single source of truth: App handles the actual state transition.
    onTool(tool)
    onUserInteraction()
  }

  return <div className="toolbar" role="toolbar" aria-label="Studio tools">
    <div className="toolbarGroup">
      {modes.map((m) => (
        <button type="button" className={s.mode === m ? 'active' : ''} key={m} onClick={() => { onUserInteraction(); s.set({ mode: m }) }}>{m}</button>
      ))}
    </div>
    <div className="toolbarDivider" />
    <div className="toolbarGroup">
      {tools.map((t) => (
        <button
          type="button"
          data-tool={t}
          aria-label={`${t} tool`}
          aria-pressed={s.tool === t}
          className={s.tool === t ? 'active secondary' : 'secondary'}
          key={t}
          onClick={(event) => {
            event.stopPropagation()
            activateTool(t)
          }}
        >
          {t}
        </button>
      ))}
    </div>
    <div className="toolbarSpacer" />
    <span className="toolbarHint">1–6 views · I inspect · M measure · A annotate · R region · P profile · F frame</span>
    <button type="button" className="toolbarAction" onClick={onProject}>Project</button>
    <button type="button" className="toolbarAction ghost" onClick={onNew}>New</button>
  </div>
}
