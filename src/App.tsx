import { HashRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import CapacityValidation from './views/CapacityValidation'
import TeamActivity from './views/TeamActivity'
import DemandDiscovery from './views/DemandDiscovery'
import DemandEdit from './views/DemandEdit'
import Admin from './views/Admin'

const navItems = [
  { to: '/capacity', label: 'Capacity' },
  { to: '/team', label: 'Team Activity' },
  { to: '/demand', label: 'Demand' },
  { to: '/admin', label: 'Admin' },
]

export default function App() {
  return (
    <HashRouter>
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
            <Route path="/team" element={<TeamActivity />} />
            <Route path="/demand" element={<DemandDiscovery />} />
            <Route path="/demand/new" element={<DemandEdit />} />
            <Route path="/demand/:id/edit" element={<DemandEdit />} />
            <Route path="/admin/*" element={<Admin />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
