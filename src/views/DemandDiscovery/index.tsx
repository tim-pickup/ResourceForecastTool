import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, Search, LayoutGrid, List, GripVertical, ChevronUp, ChevronDown, X } from 'lucide-react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { useAppStore } from '../../store/useAppStore'
import { DemandDrawer } from '../../components/DemandEditor/DemandEditor'
import { StatusBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { DemandItem, DemandStatus, DemandType } from '../../types'
import { isValidTransition } from '../../types'
import { clsx } from 'clsx'

// Active statuses — Closed items live in Archive, not here
const ACTIVE_STATUSES: DemandStatus[] = ['Draft', 'Submitted', 'Approved', 'PartiallyAllocated', 'Allocated', 'Parked']

const COLUMN_COLORS: Record<DemandStatus, string> = {
  Draft: 'bg-gray-50',
  Submitted: 'bg-yellow-50',
  Approved: 'bg-blue-50',
  PartiallyAllocated: 'bg-indigo-50',
  Allocated: 'bg-green-50',
  Parked: 'bg-orange-50',
  Closed: 'bg-gray-50',
}

type SortKey = 'name' | 'type' | 'status' | 'owner'
type SortDir = 'asc' | 'desc'
type ViewMode = 'table' | 'board' | 'search'

function DraggableCard({ item, onEdit }: { item: DemandItem; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  const theme = useAppStore(s => s.themes.find(t => t.id === item.primary_theme_id))

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'bg-white border border-border rounded p-3 shadow-sm cursor-pointer hover:border-border-hover transition-colors',
        isDragging && 'opacity-50 shadow-card'
      )}
      onClick={onEdit}
    >
      <div className="flex items-start gap-2">
        <div {...listeners} {...attributes} className="text-gray-300 hover:text-gray-400 pt-0.5 cursor-grab">
          <GripVertical size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-near-black truncate">{item.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">{item.type}</div>
          {theme && <div className="text-xs text-gray-400">{theme.name}</div>}
          <div className="text-xs text-gray-400">Owner: {item.owner || '—'}</div>
          <div className="text-xs text-gray-400">{item.phases.length} phase{item.phases.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
    </div>
  )
}

function DroppableColumn({ status, children }: { status: DemandStatus; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'flex-1 min-w-[180px] rounded-md p-3 flex flex-col gap-2 min-h-[200px] transition-colors',
        COLUMN_COLORS[status],
        isOver && 'ring-2 ring-brand ring-offset-1'
      )}
    >
      {children}
    </div>
  )
}

export default function DemandDiscovery() {
  const store = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<ViewMode>('board')
  const [drawerId, setDrawerId] = useState<string | null>(null)

  // Re-open drawer when navigating back from Model Impact
  useEffect(() => {
    const state = location.state as { openDrawer?: string } | null
    if (state?.openDrawer) {
      setDrawerId(state.openDrawer)
      // Clear the state so it doesn't re-trigger on future renders
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state])
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterTheme, setFilterTheme] = useState('')
  const [search, setSearch] = useState('')
  const [dragError, setDragError] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const themeMap = useMemo(() => new Map(store.themes.map(t => [t.id, t.name])), [store.themes])

  // Active items only (exclude Closed)
  const activeItems = useMemo(() =>
    store.demandItems.filter(d => d.status !== 'Closed'),
    [store.demandItems]
  )

  const filtered = useMemo(() => {
    let items = [...activeItems]
    if (filterStatus) items = items.filter(d => d.status === filterStatus)
    if (filterType) items = items.filter(d => d.type === filterType)
    if (filterTheme) items = items.filter(d => d.primary_theme_id === filterTheme)
    if (search) {
      const q = search.toLowerCase()
      items = items.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.owner.toLowerCase().includes(q) ||
        d.phases.some(p => p.name.toLowerCase().includes(q))
      )
    }
    items.sort((a, b) => {
      let av = '', bv = ''
      if (sortKey === 'name') { av = a.name; bv = b.name }
      else if (sortKey === 'type') { av = a.type; bv = b.type }
      else if (sortKey === 'status') { av = a.status; bv = b.status }
      else if (sortKey === 'owner') { av = a.owner; bv = b.owner }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return items
  }, [activeItems, filterStatus, filterType, filterTheme, search, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const itemId = active.id as string
    const newStatus = over.id as DemandStatus
    const item = store.demandItems.find(d => d.id === itemId)
    if (!item || item.status === newStatus) return

    if (!isValidTransition(item.status, newStatus)) {
      setDragError(`Cannot move "${item.name}" from ${item.status} to ${newStatus}.`)
      setTimeout(() => setDragError(null), 4000)
      return
    }

    const updates: Partial<DemandItem> = { status: newStatus }
    if (newStatus === 'Parked') updates.parked_reason = null
    store.updateDemandItem(itemId, updates)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
        <span className="text-sm font-semibold text-near-black">Demand</span>
        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-0.5 border border-border rounded overflow-hidden">
          {([['table', <List size={13} />], ['board', <LayoutGrid size={13} />], ['search', <Search size={13} />]] as [ViewMode, React.ReactNode][]).map(([m, icon]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              title={m}
              className={clsx('px-2.5 py-1.5 flex items-center transition-colors', mode === m ? 'bg-near-black text-white' : 'text-gray-500 hover:bg-gray-100')}
            >
              {icon}
            </button>
          ))}
        </div>

        {mode !== 'search' && (
          <>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-white">
              <option value="">All Statuses</option>
              {ACTIVE_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-white">
              <option value="">All Types</option>
              {(['Group Strategy Project', 'Plant Project', 'NPD Demand', 'BAU'] as DemandType[]).map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={filterTheme} onChange={e => setFilterTheme(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-white">
              <option value="">All Themes</option>
              {store.themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </>
        )}

        {mode === 'search' && (
          <div className="flex items-center gap-2 flex-1">
            <Search size={14} className="text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search demand items by name, description, owner, phase..."
              className="flex-1 text-sm focus:outline-none border-none"
            />
          </div>
        )}

        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => navigate('/archive')}>Archive</Button>
        <Button size="sm" variant="primary" onClick={() => navigate('/demand/new')}>
          <Plus size={12} /> New Demand
        </Button>
      </div>

      {/* Drag error banner */}
      {dragError && (
        <div className="flex items-center gap-2 px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          <span className="flex-1">{dragError}</span>
          <button onClick={() => setDragError(null)}><X size={12} /></button>
        </div>
      )}

      {/* Table mode */}
      {mode === 'table' && (
        <div className="flex-1 overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-border">
              <tr>
                {(['name', 'type', 'status', 'owner'] as SortKey[]).map(k => (
                  <th
                    key={k}
                    onClick={() => handleSort(k)}
                    className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:text-near-black select-none"
                  >
                    <span className="flex items-center gap-1 capitalize">{k} <SortIcon k={k} /></span>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Theme</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Phases</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    No demand items found. <button className="text-brand underline" onClick={() => navigate('/demand/new')}>Create one.</button>
                  </td>
                </tr>
              )}
              {filtered.map(item => (
                <tr
                  key={item.id}
                  onClick={() => setDrawerId(item.id)}
                  className="border-b border-border/50 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-2.5 font-medium text-near-black">{item.name}</td>
                  <td className="px-4 py-2.5 text-gray-600 text-xs">{item.type}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={item.status} /></td>
                  <td className="px-4 py-2.5 text-gray-600">{item.owner || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{themeMap.get(item.primary_theme_id) ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-center">{item.phases.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Board mode */}
      {mode === 'board' && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-x-auto p-4">
            <div className="flex gap-3 h-full min-h-[400px]">
              {ACTIVE_STATUSES.map(status => {
                const colItems = activeItems.filter(d => d.status === status &&
                  (!filterTheme || d.primary_theme_id === filterTheme) &&
                  (!filterType || d.type === filterType)
                )
                return (
                  <DroppableColumn key={status} status={status}>
                    <div className="flex items-center justify-between mb-1">
                      <StatusBadge status={status} />
                      <span className="text-xs text-gray-400">{colItems.length}</span>
                    </div>
                    {colItems.map(item => (
                      <DraggableCard key={item.id} item={item} onEdit={() => setDrawerId(item.id)} />
                    ))}
                    {colItems.length === 0 && (
                      <p className="text-xs text-gray-400 italic text-center pt-4">No items</p>
                    )}
                  </DroppableColumn>
                )
              })}
            </div>
          </div>
        </DndContext>
      )}

      {/* Search mode */}
      {mode === 'search' && (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 gap-2 max-w-2xl">
            {search && filtered.length === 0 && (
              <p className="text-gray-400 text-sm">No results for "{search}"</p>
            )}
            {!search && (
              <p className="text-gray-400 text-sm">Type to search demand items.</p>
            )}
            {filtered.map(item => (
              <div
                key={item.id}
                onClick={() => setDrawerId(item.id)}
                className="border border-border rounded-md p-3 bg-white hover:border-border-hover cursor-pointer shadow-sm transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={item.status} />
                  <span className="text-sm font-medium text-near-black">{item.name}</span>
                </div>
                <div className="text-xs text-gray-500">{item.type} · {themeMap.get(item.primary_theme_id)} · {item.owner || 'No owner'}</div>
                {item.description && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{item.description}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {drawerId && (
        <DemandDrawer demandId={drawerId} onClose={() => setDrawerId(null)} />
      )}
    </div>
  )
}
