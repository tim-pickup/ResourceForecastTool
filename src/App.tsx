import { useState, useEffect, useRef, useMemo } from 'react'
import { HashRouter, Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown, Check } from 'lucide-react'
import CapacityValidation from './views/CapacityValidation'
import SkillDetail from './views/CapacityValidation/SkillDetail'
import TeamActivity from './views/TeamActivity'
import ProgrammeDemand from './views/ProgrammeDemand'
import DemandDiscovery from './views/DemandDiscovery'
import DemandEdit from './views/DemandEdit'
import ProjectEdit from './views/ProjectEdit'
import ManageProjects from './views/ManageProjects'
import Admin from './views/Admin'
import Archive from './views/Archive'
import { useAppStore } from './store/useAppStore'

// §11.19 v1.18: Capacity Validation, Demand, Manage Projects, Manage Demand,
// Team Activity, Admin. Archive removed (Closed status no longer exists).
const navItems = [
  { to: '/capacity', label: 'Capacity Validation' },
  { to: '/demand', label: 'Demand' },
  { to: '/manage-projects', label: 'Manage Projects' },
  { to: '/manage-demand', label: 'Manage Demand' },
  { to: '/team', label: 'Team Activity' },
  { to: '/admin', label: 'Admin' },
]

// ─── Function selector ────────────────────────────────────────────────────────
// §4.9: dropdown when 2+ active Functions; static label when only one.

function FunctionSelector() {
  const activeFunctionId = useAppStore(s => s.activeFunctionId)
  const functions = useAppStore(s => s.functions)
  const setActiveFunctionId = useAppStore(s => s.setActiveFunctionId)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const activeFns = useMemo(
    () => [...functions].filter(f => f.active).sort((a, b) => a.name.localeCompare(b.name)),
    [functions]
  )
  const activeFunction = activeFns.find(f => f.id === activeFunctionId) ?? activeFns[0]

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (activeFns.length === 0) return null

  // §4.9: single Function → static label, no chevron, no interaction
  if (activeFns.length === 1) {
    return (
      <div className="ml-auto flex items-center gap-1 text-xs text-gray-500 select-none">
        <span className="text-gray-400">Function:</span>
        <span className="font-medium text-near-black">{activeFunction?.name}</span>
      </div>
    )
  }

  // Multi-Function: interactive dropdown
  return (
    <div className="relative ml-auto" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-border hover:border-brand hover:text-brand transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-gray-400">Function:</span>
        <span className="font-medium text-near-black">{activeFunction?.name}</span>
        <ChevronDown size={11} className="text-gray-400" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[200px] bg-white border border-border rounded shadow-card z-50"
          role="listbox"
        >
          {activeFns.map(fn => (
            <button
              key={fn.id}
              role="option"
              aria-selected={fn.id === activeFunctionId}
              onClick={() => {
                if (fn.id !== activeFunctionId) setActiveFunctionId(fn.id)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between gap-3 ${
                fn.id === activeFunctionId ? 'text-brand font-medium' : 'text-near-black'
              }`}
            >
              {fn.name}
              {fn.id === activeFunctionId && <Check size={11} className="text-brand shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── AppShell (inside HashRouter — has access to router hooks) ─────────────

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeFunctionId = useAppStore(s => s.activeFunctionId)
  const functions = useAppStore(s => s.functions)
  const setActiveFunctionId = useAppStore(s => s.setActiveFunctionId)

  const [toast, setToast] = useState<string | null>(null)

  // On mount: if URL has ?fn=..., override the persisted store value
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    const params = new URLSearchParams(location.search)
    const fnId = params.get('fn')
    if (fnId) {
      const fn = functions.find(f => f.id === fnId && f.active)
      if (fn && fn.id !== activeFunctionId) {
        setActiveFunctionId(fn.id)
        return
      }
    }
    if (activeFunctionId) {
      const current = new URLSearchParams(location.search)
      if (current.get('fn') !== activeFunctionId) {
        current.set('fn', activeFunctionId)
        navigate({ search: '?' + current.toString() }, { replace: true })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep URL in sync when activeFunctionId changes
  useEffect(() => {
    if (!activeFunctionId) return
    const hash = window.location.hash
    const qIdx = hash.indexOf('?')
    const searchPart = qIdx >= 0 ? hash.slice(qIdx) : ''
    const params = new URLSearchParams(searchPart)
    if (params.get('fn') !== activeFunctionId) {
      params.set('fn', activeFunctionId)
      const pathPart = qIdx >= 0 ? hash.slice(1, qIdx) : hash.slice(1)
      window.history.replaceState(null, '', '#' + pathPart + '?' + params.toString())
    }
  }, [activeFunctionId])

  // Show toast on user-driven Function switch (not on initial load)
  const prevFnRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevFnRef.current === null) {
      prevFnRef.current = activeFunctionId
      return
    }
    if (prevFnRef.current !== activeFunctionId) {
      const fn = functions.find(f => f.id === activeFunctionId)
      if (fn) setToast(`Switched to ${fn.name}. Some filters reset.`)
      prevFnRef.current = activeFunctionId
    }
  }, [activeFunctionId, functions])

  // Auto-dismiss toast after 3s
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className="min-h-screen bg-white text-near-black flex flex-col">
      <header className="border-b border-border bg-white sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-6 px-5 h-11">
          <span className="text-xs font-semibold tracking-widest uppercase text-near-black select-none">
            DM Resource Tool
          </span>
          <nav className="flex gap-0.5">
            {navItems.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  'px-3 py-1 text-xs font-medium uppercase tracking-wider rounded transition-colors ' +
                  (isActive
                    ? 'bg-brand text-white'
                    : 'text-gray-500 hover:text-near-black hover:bg-gray-100')
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <FunctionSelector />
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/capacity" replace />} />
          <Route path="/capacity" element={<CapacityValidation />} />
          <Route path="/capacity/skill/:skillId" element={<SkillDetail />} />
          <Route path="/team" element={<TeamActivity />} />
          {/* §4.10: New Demand view — Programme-level demand shape */}
          <Route path="/demand" element={<ProgrammeDemand />} />
          <Route path="/demand/programme/:programmeId" element={<ProgrammeDemand />} />
          {/* §4.6: Manage Demand — individual Demand-item lifecycle (renamed from /demand) */}
          <Route path="/manage-demand" element={<DemandDiscovery />} />
          <Route path="/manage-demand/new" element={<DemandEdit />} />
          <Route path="/manage-demand/:id/edit" element={<DemandEdit />} />
          {/* §4.6.A Manage Projects — board + edit */}
          <Route path="/manage-projects" element={<ManageProjects />} />
          <Route path="/manage-projects/new" element={<ProjectEdit />} />
          <Route path="/manage-projects/:id/edit" element={<ProjectEdit />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/admin/*" element={<Admin />} />
        </Routes>
      </main>

      {/* §4.9 / §11.17 toast: confirms Function switch and filter reset */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] bg-near-black text-white text-xs px-4 py-2.5 rounded-md shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}
