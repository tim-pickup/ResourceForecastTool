import { useEffect, useRef } from 'react'
import { HashRouter, Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom'
import CapacityValidation from './views/CapacityValidation'
import SkillDetail from './views/CapacityValidation/SkillDetail'
import TeamActivity from './views/TeamActivity'
import DemandDiscovery from './views/DemandDiscovery'
import DemandEdit from './views/DemandEdit'
import Admin from './views/Admin'
import Archive from './views/Archive'
import { useAppStore } from './store/useAppStore'

const navItems = [
  { to: '/capacity', label: 'Capacity' },
  { to: '/team', label: 'Team Activity' },
  { to: '/demand', label: 'Demand' },
  { to: '/admin', label: 'Admin' },
]

// Inner component that has access to router hooks
function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeFunctionId = useAppStore(s => s.activeFunctionId)
  const functions = useAppStore(s => s.functions)
  const setActiveFunctionId = useAppStore(s => s.setActiveFunctionId)

  // On mount: if URL has ?fn=..., use it to override the persisted store value
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
    // No valid URL param: ensure URL reflects current store value
    if (activeFunctionId) {
      const current = new URLSearchParams(location.search)
      if (current.get('fn') !== activeFunctionId) {
        current.set('fn', activeFunctionId)
        navigate({ search: '?' + current.toString() }, { replace: true })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep URL in sync when activeFunctionId changes after mount
  useEffect(() => {
    if (!activeFunctionId) return
    // Read current URL params without adding to the dependency array (stale-ref pattern)
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
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/capacity" replace />} />
          <Route path="/capacity" element={<CapacityValidation />} />
          <Route path="/capacity/skill/:skillId" element={<SkillDetail />} />
          <Route path="/team" element={<TeamActivity />} />
          <Route path="/demand" element={<DemandDiscovery />} />
          <Route path="/demand/new" element={<DemandEdit />} />
          <Route path="/demand/:id/edit" element={<DemandEdit />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/admin/*" element={<Admin />} />
        </Routes>
      </main>
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
