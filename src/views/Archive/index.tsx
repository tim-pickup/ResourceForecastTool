import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { StatusBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { DemandItem, DemandStatus } from '../../types'
import { derivedPrimaryDomain } from '../../types'

function totalHours(item: DemandItem): number {
  return item.phases.flatMap(p => p.requirements).flatMap(r => Object.values(r.hours_by_month)).reduce((s, h) => s + h, 0)
}

export default function Archive() {
  const store = useAppStore()
  const navigate = useNavigate()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const closedItems = store.demandItems.filter(d => d.status === 'Closed')

  const handleRestore = (item: DemandItem) => {
    const restoreTo: DemandStatus = item.previous_status ?? 'Draft'
    if (!window.confirm(`Restore "${item.name}" to ${restoreTo}?`)) return
    store.updateDemandItem(item.id, {
      status: restoreTo,
      previous_status: null,
      closed_at: null,
    })
  }

  const handleDelete = (id: string) => {
    store.deleteDemandItem(id)
    setConfirmDeleteId(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white">
        <button onClick={() => navigate('/manage-demand')} className="text-gray-400 hover:text-near-black transition-colors">
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-near-black">Archive</span>
        <span className="text-xs text-gray-400 ml-1">({closedItems.length} closed item{closedItems.length !== 1 ? 's' : ''})</span>
      </div>

      <div className="flex-1 overflow-auto">
        {closedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <p className="text-sm">No archived demand items.</p>
            <p className="text-xs">Closed items appear here and can be restored.</p>
          </div>
        ) : (
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Domain</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Owner</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Closed From</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Closed On</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Total Hours</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {closedItems.map(item => (
                <tr key={item.id} className="border-b border-border/50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-near-black">{item.name}</td>
                  <td className="px-4 py-2.5 text-gray-600 text-xs">{item.type}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs italic">{derivedPrimaryDomain(item, store.domains, store.skills)?.name ?? 'Unassigned'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{item.owner || '—'}</td>
                  <td className="px-4 py-2.5">
                    {item.previous_status ? <StatusBadge status={item.previous_status} /> : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{item.closed_at ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{Math.round(totalHours(item))}h</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <Button size="sm" variant="secondary" onClick={() => handleRestore(item)}>
                        <RotateCcw size={11} /> Restore
                      </Button>
                      {confirmDeleteId === item.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-accent-red">Delete?</span>
                          <Button size="sm" variant="danger" onClick={() => handleDelete(item.id)}>Yes</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>No</Button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(item.id)} className="text-gray-300 hover:text-accent-red p-1">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
