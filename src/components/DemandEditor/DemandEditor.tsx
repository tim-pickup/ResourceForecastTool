import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MoreHorizontal, Copy, Trash2, Edit2, AlertTriangle, ExternalLink, GitMerge } from 'lucide-react'
import { parseISO, format } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/Badge'
import type { DemandItem, DemandStatus } from '../../types'

interface Props {
  demandId: string | null
  onClose: () => void
}

// ─── Footer CTAs per status ───────────────────────────────────────────────────
// Rendered right-aligned; rightmost is highest priority.
// Transitional buttons change status in-place (drawer stays open).
// Navigational buttons route away (drawer closes).

interface FooterButton {
  label: string
  variant?: 'primary' | 'secondary' | 'danger'
  kind: 'transitional' | 'navigational'
  next?: DemandStatus   // for transitional
  action?: string       // 'allocate' | 'model-impact'
}

function footerButtons(status: DemandStatus): FooterButton[] {
  switch (status) {
    case 'Draft':
      return [{ label: 'Submit', kind: 'transitional', next: 'Submitted', variant: 'primary' }]
    case 'Submitted':
      return [
        { label: 'Park', kind: 'transitional', next: 'Parked', variant: 'secondary' },
        { label: 'Revert to Draft', kind: 'transitional', next: 'Draft', variant: 'secondary' },
        { label: 'Model Impact', kind: 'navigational', action: 'model-impact', variant: 'secondary' },
        { label: 'Approve', kind: 'transitional', next: 'Approved', variant: 'primary' },
      ]
    case 'Approved':
      return [{ label: 'Allocate', kind: 'navigational', action: 'allocate', variant: 'primary' }]
    case 'PartiallyAllocated':
      return [{ label: 'Allocate', kind: 'navigational', action: 'allocate', variant: 'primary' }]
    case 'Allocated':
      return []  // deliberately empty
    case 'Parked':
      return [{ label: 'Revive', kind: 'transitional', next: 'Submitted', variant: 'primary' }]
    case 'Closed':
      return [{ label: 'Restore', kind: 'transitional', next: undefined, variant: 'secondary' }]
  }
}

// ─── Overflow menu per status ─────────────────────────────────────────────────

interface OverflowAction {
  label: string
  kind: 'revise' | 'park' | 'close' | 'duplicate' | 'delete'
  danger?: boolean
}

function overflowActions(status: DemandStatus): OverflowAction[] {
  switch (status) {
    case 'Draft':
      return [{ label: 'Duplicate', kind: 'duplicate' }, { label: 'Delete', kind: 'delete', danger: true }]
    case 'Submitted':
      return [{ label: 'Duplicate', kind: 'duplicate' }, { label: 'Delete', kind: 'delete', danger: true }]
    case 'Approved':
      return [
        { label: 'Revise', kind: 'revise' },
        { label: 'Park', kind: 'park' },
        { label: 'Close', kind: 'close', danger: true },
        { label: 'Duplicate', kind: 'duplicate' },
        { label: 'Delete', kind: 'delete', danger: true },
      ]
    case 'PartiallyAllocated':
      return [
        { label: 'Park', kind: 'park' },
        { label: 'Close', kind: 'close', danger: true },
        { label: 'Duplicate', kind: 'duplicate' },
        { label: 'Delete', kind: 'delete', danger: true },
      ]
    case 'Allocated':
      return [
        { label: 'Park', kind: 'park' },
        { label: 'Close', kind: 'close', danger: true },
        { label: 'Duplicate', kind: 'duplicate' },
        { label: 'Delete', kind: 'delete', danger: true },
      ]
    case 'Parked':
      return [{ label: 'Duplicate', kind: 'duplicate' }, { label: 'Delete', kind: 'delete', danger: true }]
    case 'Closed':
      return [{ label: 'Duplicate', kind: 'duplicate' }, { label: 'Delete', kind: 'delete', danger: true }]
  }
}

// ─── Helper: compute allocation coverage % ───────────────────────────────────

function coveragePct(item: DemandItem): number | null {
  let total = 0, covered = 0
  for (const phase of item.phases) {
    if (phase.end_month === null) {
      for (const req of phase.requirements) {
        const target = req.steady_state_hours ?? 0
        if (target === 0) continue
        total++
        if (req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0) >= target) covered++
      }
    } else {
      for (const req of phase.requirements) {
        for (const [m, target] of Object.entries(req.hours_by_month)) {
          if (target === 0) continue
          total++
          if (req.allocations.reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0) >= target) covered++
        }
      }
    }
  }
  return total === 0 ? null : Math.round((covered / total) * 100)
}

function totalItemHours(item: DemandItem): { finite: number; indefiniteCount: number } {
  let finite = 0, indefiniteCount = 0
  for (const phase of item.phases) {
    if (phase.end_month === null) { indefiniteCount++; continue }
    for (const req of phase.requirements) {
      finite += Object.values(req.hours_by_month).reduce((s, h) => s + h, 0)
    }
  }
  return { finite, indefiniteCount }
}

function dateRange(item: DemandItem): string {
  const starts = item.phases.map(p => p.start_month).filter(Boolean).sort()
  const ends = item.phases.map(p => p.end_month).filter((e): e is string => !!e).sort()
  if (!starts.length) return '—'
  const fmt = (m: string) => format(parseISO(m + '-01'), 'MMM yy')
  const hasIndefinite = item.phases.some(p => p.end_month === null)
  return `${fmt(starts[0])} – ${hasIndefinite ? 'ongoing' : (ends.length ? fmt(ends[ends.length - 1]) : '—')}`
}

// ─── Overflow menu ────────────────────────────────────────────────────────────

interface OverflowMenuProps {
  status: DemandStatus
  onDuplicate: () => void
  onDelete: () => void
  onRevise: () => void
  onPark: () => void
  onClose: () => void
}

function OverflowMenu({ status, onDuplicate, onDelete, onRevise, onPark, onClose: onCloseDemand }: OverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const actions = overflowActions(status)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setConfirmDelete(false); setConfirmClose(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function dispatch(kind: OverflowAction['kind']) {
    setOpen(false)
    if (kind === 'duplicate') { onDuplicate(); return }
    if (kind === 'revise') { onRevise(); return }
    if (kind === 'park') { onPark(); return }
    if (kind === 'close') { setConfirmClose(true); return }
    if (kind === 'delete') { setConfirmDelete(true); return }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-gray-400 hover:text-near-black transition-colors p-1 rounded"
        title="More actions"
      >
        <MoreHorizontal size={15} />
      </button>

      {(open || confirmDelete || confirmClose) && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-border rounded shadow-card z-50">
          {open && !confirmDelete && !confirmClose && (
            <>
              {actions.map(a => (
                <button
                  key={a.kind}
                  onClick={() => dispatch(a.kind)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 ${a.danger ? 'text-accent-red hover:bg-red-50' : ''}`}
                >
                  {a.kind === 'duplicate' && <Copy size={12} className="text-gray-400" />}
                  {a.kind === 'delete' && <Trash2 size={12} />}
                  {a.label}
                </button>
              ))}
            </>
          )}

          {confirmDelete && (
            <div className="px-3 py-2">
              <p className="text-xs text-accent-red font-medium mb-1.5">Permanently delete?</p>
              <div className="flex gap-2">
                <button onClick={() => { setConfirmDelete(false); onDelete() }} className="text-xs font-medium text-accent-red hover:underline">Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
              </div>
            </div>
          )}

          {confirmClose && (
            <div className="px-3 py-2">
              <p className="text-xs text-orange-700 font-medium mb-1.5">Close and archive?</p>
              <div className="flex gap-2">
                <button onClick={() => { setConfirmClose(false); onCloseDemand() }} className="text-xs font-medium text-orange-700 hover:underline">Close</button>
                <button onClick={() => setConfirmClose(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Drawer inner (receives non-null item + id) ───────────────────────────────

interface DrawerContentProps {
  demandId: string
  item: DemandItem
  onClose: () => void
}

function DrawerContent({ demandId, item, onClose }: DrawerContentProps) {
  const store = useAppStore()
  const navigate = useNavigate()

  const domain = store.domains.find(t => t.id === item.primary_domain_id)
  const project = item.project_id ? store.projects.find(p => p.id === item.project_id) : null
  const programme = project ? store.programmes.find(p => p.id === project.programme_id) : null
  const { finite: totalFiniteHours, indefiniteCount } = totalItemHours(item)
  const pct = coveragePct(item)
  const footerBtns = footerButtons(item.status)

  // ── Status transition handlers ────────────────────────────────────────────

  function handleTransition(next: DemandStatus | undefined) {
    if (!next) return
    if (next === 'Closed') {
      if (!window.confirm(`Archive "${item.name}"? It will be removed from the Demand list and all charts.`)) return
      store.updateDemandItem(demandId, { status: 'Closed', previous_status: item.status, closed_at: new Date().toISOString().slice(0, 10) })
      onClose(); return
    }
    let parkedReason: string | null = item.parked_reason
    if (next === 'Parked') {
      parkedReason = window.prompt('Parked reason (optional):', '') ?? null
      if (parkedReason === '') parkedReason = null
    }
    store.updateDemandItem(demandId, { status: next, parked_reason: next === 'Parked' ? parkedReason : null })
  }

  function handleRevise() { store.updateDemandItem(demandId, { status: 'Submitted' }) }

  function handleOverflowPark() {
    const reason = window.prompt('Parked reason (optional):', '') ?? null
    store.updateDemandItem(demandId, { status: 'Parked', parked_reason: reason || null })
  }

  function handleOverflowClose() {
    store.updateDemandItem(demandId, { status: 'Closed', previous_status: item.status, closed_at: new Date().toISOString().slice(0, 10) })
    onClose()
  }

  function handleDelete() { store.deleteDemandItem(demandId); onClose() }
  function handleDuplicate() { store.duplicateDemandItem(demandId); onClose() }
  function handleEdit() { onClose(); navigate(`/demand/${demandId}/edit`) }
  function handleAllocate() { onClose(); navigate(`/demand/${demandId}/edit`) }
  function handleModelImpact() { onClose(); navigate(`/capacity?overlay=${demandId}&from=demand`) }

  function handleFooterAction(btn: FooterButton) {
    if (btn.kind === 'transitional') {
      if (btn.label === 'Restore') {
        store.updateDemandItem(demandId, { status: item.previous_status ?? 'Submitted', previous_status: null, closed_at: null })
        return
      }
      handleTransition(btn.next)
    } else {
      if (btn.action === 'allocate') handleAllocate()
      if (btn.action === 'model-impact') handleModelImpact()
    }
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
                {domain && <><span className="text-gray-300">·</span><span>{domain.name}</span></>}
                {programme && project && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400">{programme.name} › {project.name}</span>
                  </>
                )}
                {item.owner && <><span className="text-gray-300">·</span><span>{item.owner}</span></>}
              </div>
            </div>
            {/* Right: Edit → kebab → × */}
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="primary" onClick={handleEdit}>
                <Edit2 size={12} /> Edit
              </Button>
              <OverflowMenu
                status={item.status}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onRevise={handleRevise}
                onPark={handleOverflowPark}
                onClose={handleOverflowClose}
              />
              <button onClick={onClose} className="text-gray-400 hover:text-near-black transition-colors p-1 rounded">
                <X size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Zone 2: Status (badge + info only, no buttons) ─────────────── */}
        <div className="px-5 py-2.5 border-b border-border bg-gray-50/50">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={item.status} />
            {item.status === 'PartiallyAllocated' && pct !== null && (
              <span className="text-xs text-gray-500">{pct}% covered</span>
            )}
            {item.status === 'Allocated' && (
              <span className="text-xs text-gray-500">Fully allocated</span>
            )}
          </div>
        </div>

        {/* ── Zone 3: Body ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* Summary stats */}
          {(() => {
            // Compute total external hours across all phases
            const allExtReqs = store.externalResourceRequirements.filter(r => item.phases.some(p => p.id === r.phase_id))
            const totalExtHours = allExtReqs.reduce((s, ext) => {
              const phase = item.phases.find(p => p.id === ext.phase_id)
              if (!phase) return s
              if (phase.end_month === null) return s + (ext.steady_state_hours ?? 0)
              return s + Object.values(ext.hours_by_month).reduce((ss, h) => ss + h, 0)
            }, 0)
            return (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div><span className="text-gray-400">Phases: </span><span>{item.phases.length}</span></div>
                <div><span className="text-gray-400">Dates: </span><span>{dateRange(item)}</span></div>
                {totalFiniteHours > 0 && (
                  <div className="col-span-2"><span className="text-gray-400">Internal hours (finite phases): </span><span>{Math.round(totalFiniteHours)}h</span></div>
                )}
                {totalExtHours > 0 && (
                  <div className="col-span-2"><span className="text-amber-500">External hours (finite phases): </span><span className="text-amber-700">{Math.round(totalExtHours)}h</span></div>
                )}
                {indefiniteCount > 0 && (
                  <div className="col-span-2"><span className="text-gray-400">Indefinite phases: </span><span>{indefiniteCount}</span></div>
                )}
              </div>
            )
          })()}

          {/* Project alignment */}
          {project ? (
            <div className="flex items-center gap-2 text-xs">
              <GitMerge size={12} className="text-gray-400" />
              <span className="text-gray-400">{programme?.name} › {project.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-400 italic">
              <GitMerge size={12} /> Unaligned — not associated with a Project
            </div>
          )}

          {item.status === 'Parked' && item.parked_reason && (
            <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded p-2.5 text-xs text-orange-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{item.parked_reason}</span>
            </div>
          )}

          {item.description && (
            <p className="text-xs text-gray-600 leading-relaxed">{item.description}</p>
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
                  const extReqs = store.externalResourceRequirements.filter(r => r.phase_id === phase.id)
                  return (
                    <div key={phase.id} className="border border-border rounded p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">
                          Phase {idx + 1}{phase.name ? ` · ${phase.name}` : ''}
                        </span>
                        <span className="text-xs text-gray-400">
                          {isIndefinite ? `${phase.start_month} → ongoing` : `${phase.start_month} → ${phase.end_month}`}
                        </span>
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
                          <p className="text-xs text-gray-400 italic">No internal requirements</p>
                        )}
                      </div>
                      {extReqs.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 block mb-1">External</span>
                          {extReqs.map(ext => {
                            const prov = store.providers.find(p => p.id === ext.provider_id)
                            const hrsLabel = isIndefinite
                              ? `${ext.steady_state_hours ?? 0}h/mo`
                              : `${Object.values(ext.hours_by_month).reduce((s, h) => s + h, 0)}h total`
                            return (
                              <div key={ext.id} className="flex justify-between text-xs text-amber-700">
                                <span>{prov?.name ?? ext.provider_id} — {ext.role}</span>
                                <span className="text-amber-500">{hrsLabel}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {phaseHrs !== null && (
                        <div className="mt-2 pt-1.5 border-t border-gray-100 text-xs text-gray-500 text-right">
                          {Math.round(phaseHrs)}h internal total
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Zone 4: Footer (empty on Allocated) ────────────────────────── */}
        {footerBtns.length > 0 && (
          <div className="border-t border-border px-5 py-3 flex items-center justify-end gap-2">
            {footerBtns.map(btn => (
              <Button
                key={btn.label}
                size="sm"
                variant={btn.variant ?? 'secondary'}
                onClick={() => handleFooterAction(btn)}
              >
                {btn.label === 'Allocate' && <GitMerge size={12} />}
                {btn.label === 'Model Impact' && <ExternalLink size={12} />}
                {btn.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Outer wrapper handles null guards ───────────────────────────────────────

export function DemandDrawer({ demandId, onClose }: Props) {
  const item = useAppStore(s => demandId ? s.demandItems.find(d => d.id === demandId) : undefined)
  if (!demandId || !item) return null
  return <DrawerContent demandId={demandId} item={item} onClose={onClose} />
}

export const DemandEditor = DemandDrawer
