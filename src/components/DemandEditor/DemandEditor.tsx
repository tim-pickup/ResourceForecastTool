import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Copy, Trash2, Edit2, AlertTriangle } from 'lucide-react'
import { parseISO, format } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/Badge'
import type { DemandItem, DemandStatus } from '../../types'

interface Props {
  demandId: string | null
  onClose: () => void
}

interface Transition { label: string; next: DemandStatus; variant?: 'danger' | 'secondary' }

function drawerTransitions(status: DemandStatus): Transition[] {
  switch (status) {
    case 'Draft':
      return [{ label: 'Submit', next: 'Submitted' }]
    case 'Submitted':
      return [
        { label: 'Approve', next: 'Approved' },
        { label: 'Revert to Draft', next: 'Draft' },
        { label: 'Park', next: 'Parked' },
      ]
    case 'Approved':
      return [
        { label: 'Park', next: 'Parked' },
        { label: 'Close', next: 'Closed', variant: 'danger' },
      ]
    case 'PartiallyAllocated':
      return [
        { label: 'Park', next: 'Parked' },
        { label: 'Close', next: 'Closed', variant: 'danger' },
      ]
    case 'Allocated':
      return [
        { label: 'Park', next: 'Parked' },
        { label: 'Close', next: 'Closed', variant: 'danger' },
      ]
    case 'Parked':
      return [{ label: 'Revive', next: 'Submitted' }]
    case 'Closed':
      return [] // Restore is handled in Archive view
  }
}

function totalItemHours(item: DemandItem): number {
  return item.phases
    .flatMap(p => p.requirements)
    .flatMap(r => Object.values(r.hours_by_month))
    .reduce((s, h) => s + h, 0)
}

function dateRange(item: DemandItem): string {
  const starts = item.phases.map(p => p.start_month).filter(Boolean).sort()
  const ends = item.phases.map(p => p.end_month).filter(Boolean).sort()
  if (!starts.length) return '—'
  const fmt = (m: string) => format(parseISO(m + '-01'), 'MMM yy')
  return `${fmt(starts[0])} – ${fmt(ends[ends.length - 1])}`
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-gray-400">{label}: </span>
      <span className="text-near-black">{value}</span>
    </div>
  )
}

function allocationSummary(item: DemandItem): string {
  let totalReqMonths = 0
  let coveredMonths = 0
  for (const phase of item.phases) {
    for (const req of phase.requirements) {
      const months = Object.keys(req.hours_by_month)
      for (const m of months) {
        const target = req.hours_by_month[m] ?? 0
        if (target === 0) continue
        totalReqMonths++
        const allocated = req.allocations.reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0)
        if (allocated >= target) coveredMonths++
      }
    }
  }
  if (totalReqMonths === 0) return 'No requirements'
  const pct = Math.round((coveredMonths / totalReqMonths) * 100)
  return `${pct}% allocated (${coveredMonths}/${totalReqMonths} req-months covered)`
}

export function DemandDrawer({ demandId, onClose }: Props) {
  const store = useAppStore()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!demandId) return null
  const item = store.demandItems.find(d => d.id === demandId)
  if (!item) return null

  const theme = store.themes.find(t => t.id === item.primary_theme_id)
  const trans = drawerTransitions(item.status)
  const totalHours = totalItemHours(item)

  const handleStatusChange = (next: DemandStatus) => {
    if (next === 'Closed') {
      if (!window.confirm(`Archive "${item.name}"? It will be removed from the Demand list and all charts. You can restore it from the Archive view.`)) return
      store.updateDemandItem(demandId, {
        status: 'Closed',
        previous_status: item.status,
        closed_at: new Date().toISOString().slice(0, 10),
      })
      onClose()
      return
    }
    let parkedReason: string | null = item.parked_reason
    if (next === 'Parked') {
      parkedReason = window.prompt('Parked reason (optional):', '') ?? null
      if (parkedReason === '') parkedReason = null
    }
    store.updateDemandItem(demandId, {
      status: next,
      parked_reason: next === 'Parked' ? parkedReason : null,
    })
  }

  const handleDelete = () => {
    store.deleteDemandItem(demandId)
    onClose()
  }

  const handleDuplicate = () => {
    store.duplicateDemandItem(demandId)
    onClose()
  }

  const handleEdit = () => {
    onClose()
    navigate(`/demand/${demandId}/edit`)
  }

  const isAllocationMode = ['Approved', 'PartiallyAllocated', 'Allocated'].includes(item.status)

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-[440px] bg-white border-l border-border flex flex-col shadow-panel overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <StatusBadge status={item.status} />
            <span className="text-sm font-semibold text-near-black truncate max-w-[260px]">
              {item.name || 'Unnamed'}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-near-black transition-colors p-0.5 rounded ml-2 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <MetaRow label="Type" value={item.type} />
            <MetaRow label="Theme" value={theme?.name ?? '—'} />
            <MetaRow label="Owner" value={item.owner || '—'} />
            <MetaRow label="Phases" value={String(item.phases.length)} />
            <MetaRow label="Date range" value={dateRange(item)} />
            <MetaRow label="Total hours" value={`${Math.round(totalHours)}h`} />
          </div>

          {isAllocationMode && (
            <div className="text-xs bg-blue-50 border border-blue-100 rounded px-3 py-2 text-blue-700">
              {allocationSummary(item)}
            </div>
          )}

          {item.description && (
            <p className="text-xs text-gray-600 leading-relaxed">{item.description}</p>
          )}

          {item.status === 'Parked' && item.parked_reason && (
            <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded p-2.5 text-xs text-orange-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{item.parked_reason}</span>
            </div>
          )}

          {/* Phases summary */}
          {item.phases.length > 0 && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 block mb-2">Phases</span>
              <div className="flex flex-col gap-2.5">
                {item.phases.map(phase => {
                  const phaseHrs = phase.requirements
                    .flatMap(r => Object.values(r.hours_by_month))
                    .reduce((s, h) => s + h, 0)
                  return (
                    <div key={phase.id} className="border border-border rounded p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{phase.name || 'Unnamed Phase'}</span>
                        <span className="text-xs text-gray-400">{phase.start_month} → {phase.end_month}</span>
                      </div>
                      <div className="text-xs text-gray-500 mb-2">
                        {phase.funding_source}{phase.funding_notes ? ` — ${phase.funding_notes}` : ''}
                      </div>
                      <div className="flex flex-col gap-1">
                        {phase.requirements.map(req => {
                          const hrs = Object.values(req.hours_by_month).reduce((s, h) => s + h, 0)
                          const skill = store.skills.find(s => s.id === req.skill_id)
                          const allocCount = req.allocations.length
                          return (
                            <div key={req.id} className="flex justify-between text-xs text-gray-600">
                              <span>{skill?.name ?? req.skill_id} — {req.level}</span>
                              <span className="text-gray-400">
                                {Math.round(hrs)}h
                                {allocCount > 0 && <span className="ml-1 text-blue-500">({allocCount} alloc)</span>}
                              </span>
                            </div>
                          )
                        })}
                        {phase.requirements.length === 0 && (
                          <p className="text-xs text-gray-400 italic">No requirements</p>
                        )}
                      </div>
                      <div className="mt-2 pt-1.5 border-t border-gray-100 text-xs text-gray-500 text-right">
                        {Math.round(phaseHrs)}h total
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3 flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-2">
            {trans.map(t => (
              <Button key={t.label} size="sm" variant={t.variant ?? 'secondary'} onClick={() => handleStatusChange(t.next)}>
                {t.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={handleDuplicate}>
              <Copy size={12} /> Duplicate
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={handleEdit}>
              <Edit2 size={12} /> Edit
            </Button>
            <div className="flex-1" />
            {!confirmDelete ? (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={12} /> Delete
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-accent-red font-medium">Confirm?</span>
                <Button size="sm" variant="danger" onClick={handleDelete}>Yes</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>No</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const DemandEditor = DemandDrawer
