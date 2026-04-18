import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MoreHorizontal, Copy, Trash2, Edit2, AlertTriangle, ExternalLink } from 'lucide-react'
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
        { label: 'Revise', next: 'Submitted' },
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
      return []
  }
}

function totalItemHours(item: DemandItem): { finite: number; indefiniteCount: number } {
  let finite = 0
  let indefiniteCount = 0
  for (const phase of item.phases) {
    if (phase.end_month === null) {
      indefiniteCount++
    } else {
      for (const req of phase.requirements) {
        finite += Object.values(req.hours_by_month).reduce((s, h) => s + h, 0)
      }
    }
  }
  return { finite, indefiniteCount }
}

function dateRange(item: DemandItem): string {
  const starts = item.phases.map(p => p.start_month).filter(Boolean).sort()
  const ends = item.phases.map(p => p.end_month).filter((e): e is string => e !== null && e !== '').sort()
  if (!starts.length) return '—'
  const fmt = (m: string) => format(parseISO(m + '-01'), 'MMM yy')
  const hasIndefinite = item.phases.some(p => p.end_month === null)
  const endLabel = hasIndefinite ? 'ongoing' : (ends.length ? fmt(ends[ends.length - 1]) : '—')
  return `${fmt(starts[0])} – ${endLabel}`
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
    if (phase.end_month === null) {
      for (const req of phase.requirements) {
        const target = req.steady_state_hours ?? 0
        if (target === 0) continue
        totalReqMonths++
        const allocated = req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0)
        if (allocated >= target) coveredMonths++
      }
    } else {
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
  }
  if (totalReqMonths === 0) return 'No requirements'
  const pct = Math.round((coveredMonths / totalReqMonths) * 100)
  return `${pct}% allocated (${coveredMonths}/${totalReqMonths} req-months covered)`
}

// ─── Overflow menu ────────────────────────────────────────────────────────────

function OverflowMenu({ onDuplicate, onDelete }: { onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-gray-400 hover:text-near-black transition-colors p-1 rounded"
        title="More actions"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-border rounded shadow-card z-50">
          <button
            onClick={() => { setOpen(false); onDuplicate() }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"
          >
            <Copy size={12} className="text-gray-400" /> Duplicate
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full text-left px-3 py-2 text-xs text-accent-red hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 size={12} /> Delete
            </button>
          ) : (
            <div className="px-3 py-2 border-t border-border">
              <p className="text-xs text-accent-red font-medium mb-1.5">Confirm delete?</p>
              <div className="flex gap-2">
                <button onClick={() => { setOpen(false); setConfirmDelete(false); onDelete() }} className="text-xs font-medium text-accent-red hover:underline">Yes</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:underline">No</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export function DemandDrawer({ demandId, onClose }: Props) {
  const store = useAppStore()
  const navigate = useNavigate()

  if (!demandId) return null
  const item = store.demandItems.find(d => d.id === demandId)
  if (!item) return null

  const theme = store.themes.find(t => t.id === item.primary_theme_id)
  const trans = drawerTransitions(item.status)
  const { finite: totalFiniteHours, indefiniteCount } = totalItemHours(item)
  const isAllocationMode = ['Approved', 'PartiallyAllocated', 'Allocated'].includes(item.status)

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

  const handleModelImpact = () => {
    onClose()
    navigate(`/capacity?overlay=${demandId}&from=demand`)
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-[440px] bg-white border-l border-border flex flex-col shadow-panel overflow-hidden">

        {/* ── Zone 1: Header ─────────────────────────────────────────────── */}
        <div className="px-5 py-3.5 border-b border-border">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-near-black leading-snug">
                {item.name || 'Unnamed'}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-gray-500">
                <span>{item.type}</span>
                {theme && <><span className="text-gray-300">·</span><span>{theme.name}</span></>}
                {item.owner && <><span className="text-gray-300">·</span><span>{item.owner}</span></>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <OverflowMenu onDuplicate={handleDuplicate} onDelete={handleDelete} />
              <button onClick={onClose} className="text-gray-400 hover:text-near-black transition-colors p-1 rounded">
                <X size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Zone 2: Status ─────────────────────────────────────────────── */}
        <div className="px-5 py-2.5 border-b border-border bg-gray-50/50">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={item.status} />
            {trans.map(t => (
              <Button key={t.label} size="sm" variant={t.variant ?? 'secondary'} onClick={() => handleStatusChange(t.next)}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        {/* ── Zone 3: Body ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <MetaRow label="Phases" value={String(item.phases.length)} />
            <MetaRow label="Date range" value={dateRange(item)} />
            {totalFiniteHours > 0 && <MetaRow label="Total hours (finite)" value={`${Math.round(totalFiniteHours)}h`} />}
            {indefiniteCount > 0 && <MetaRow label="Indefinite phases" value={String(indefiniteCount)} />}
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

          {item.phases.length > 0 && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 block mb-2">Phases</span>
              <div className="flex flex-col gap-2.5">
                {item.phases.map((phase, idx) => {
                  const isIndefinite = phase.end_month === null
                  const phaseHrs = isIndefinite
                    ? null
                    : phase.requirements.flatMap(r => Object.values(r.hours_by_month)).reduce((s, h) => s + h, 0)
                  const dateLabel = isIndefinite
                    ? `${phase.start_month} → ongoing`
                    : `${phase.start_month} → ${phase.end_month}`
                  return (
                    <div key={phase.id} className="border border-border rounded p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">
                          Phase {idx + 1}{phase.name ? ` · ${phase.name}` : ''}
                        </span>
                        <span className="text-xs text-gray-400">{dateLabel}</span>
                      </div>
                      <div className="text-xs text-gray-500 mb-2">
                        {phase.funding_source}{phase.funding_notes ? ` — ${phase.funding_notes}` : ''}
                      </div>
                      <div className="flex flex-col gap-1">
                        {phase.requirements.map(req => {
                          const skill = store.skills.find(s => s.id === req.skill_id)
                          const allocCount = req.allocations.length
                          const hrsLabel = isIndefinite
                            ? `${req.steady_state_hours ?? 0}h/mo`
                            : `${Math.round(Object.values(req.hours_by_month).reduce((s, h) => s + h, 0))}h`
                          return (
                            <div key={req.id} className="flex justify-between text-xs text-gray-600">
                              <span>{skill?.name ?? req.skill_id} — {req.level}</span>
                              <span className="text-gray-400">
                                {hrsLabel}
                                {allocCount > 0 && <span className="ml-1 text-blue-500">({allocCount} alloc)</span>}
                              </span>
                            </div>
                          )
                        })}
                        {phase.requirements.length === 0 && (
                          <p className="text-xs text-gray-400 italic">No requirements</p>
                        )}
                      </div>
                      {phaseHrs !== null && (
                        <div className="mt-2 pt-1.5 border-t border-gray-100 text-xs text-gray-500 text-right">
                          {Math.round(phaseHrs)}h total
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Zone 4: Footer ─────────────────────────────────────────────── */}
        <div className="border-t border-border px-5 py-3 flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={handleEdit}>
            <Edit2 size={12} /> Edit
          </Button>
          {item.status === 'Submitted' && (
            <Button size="sm" variant="primary" onClick={handleModelImpact}>
              <ExternalLink size={12} /> Model Impact
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export const DemandEditor = DemandDrawer
