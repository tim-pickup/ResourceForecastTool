import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MoreHorizontal, Trash2, Edit2, ExternalLink, GitMerge } from 'lucide-react'
import { parseISO, format } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../ui/Button'
import { StatusBadge, Badge } from '../ui/Badge'
import { ProjectDrawer } from '../ProjectDrawer/ProjectDrawer'
import type { DemandItem, DemandStatus } from '../../types'

interface Props {
  demandId: string | null
  onClose: () => void
}

// ─── Footer CTAs per status (v1.18) ──────────────────────────────────────────

interface FooterButton {
  label: string
  variant?: 'primary' | 'secondary' | 'danger'
  kind: 'transitional' | 'navigational'
  next?: DemandStatus
  action?: string
}

function footerButtons(status: DemandStatus): FooterButton[] {
  switch (status) {
    case 'Draft':
      return [{ label: 'Submit Demand', kind: 'transitional', next: 'Submitted', variant: 'primary' }]
    case 'Submitted':
      return [
        { label: 'Model Capacity', kind: 'navigational', action: 'model-capacity', variant: 'secondary' },
        { label: 'Approve', kind: 'transitional', next: 'Approved', variant: 'primary' },
      ]
    case 'Approved':
      return [{ label: 'Allocate', kind: 'navigational', action: 'allocate', variant: 'primary' }]
    case 'PartiallyAllocated':
      return [{ label: 'Allocate', kind: 'navigational', action: 'allocate', variant: 'primary' }]
    case 'Allocated':
      return []
  }
}

// ─── Helper functions ─────────────────────────────────────────────────────────

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

// ─── Overflow menu (v1.18: Delete only — hidden for project-spawned Demands) ──

function OverflowMenu({ onDelete, isProjectSpawned }: { onDelete: () => void; isProjectSpawned: boolean }) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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

      {(open || confirmDelete) && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-border rounded shadow-card z-50">
          {open && !confirmDelete && (
            isProjectSpawned ? (
              <div className="px-3 py-2 text-xs text-gray-400 italic">Delete the parent Project to remove this Demand.</div>
            ) : (
              <button
                onClick={() => { setOpen(false); setConfirmDelete(true) }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 flex items-center gap-2 text-accent-red"
              >
                <Trash2 size={12} /> Delete
              </button>
            )
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
        </div>
      )}
    </div>
  )
}

// ─── Drawer inner ─────────────────────────────────────────────────────────────

interface DrawerContentProps {
  demandId: string
  item: DemandItem
  onClose: () => void
}

function DrawerContent({ demandId, item, onClose }: DrawerContentProps) {
  const store = useAppStore()
  const navigate = useNavigate()
  const [projectDrawerId, setProjectDrawerId] = useState<string | null>(null)

  // Auto-derive distinct Functions from requirements
  const functionsInvolved = (() => {
    const fnIds = new Set<string>()
    for (const phase of item.phases) {
      for (const req of phase.requirements) {
        const skill = store.skills.find(s => s.id === req.skill_id)
        if (!skill) continue
        const dom = store.domains.find(d => d.id === skill.domain_id)
        if (!dom) continue
        fnIds.add(dom.functionId)
      }
    }
    return [...fnIds].map(id => store.functions.find(f => f.id === id)).filter(Boolean)
  })()

  const isProjectSpawned = item.parent_project_id !== null
  const project = item.parent_project_id ? store.projects.find(p => p.id === item.parent_project_id) : null
  const programme = project?.programme_id ? store.programmes.find(p => p.id === project.programme_id) : null
  const demandFunction = store.functions.find(f => f.id === item.function_id)

  // Sibling Demands (other Demands on the same parent Project)
  const siblingDemands = isProjectSpawned
    ? store.demandItems.filter(d => d.parent_project_id === item.parent_project_id && d.id !== demandId)
    : []

  const { finite: totalFiniteHours, indefiniteCount } = totalItemHours(item)
  const pct = coveragePct(item)
  const footerBtns = footerButtons(item.status)

  function handleTransition(next: DemandStatus) {
    store.updateDemandItem(demandId, { status: next })
  }

  function handleDelete() { store.deleteDemandItem(demandId); onClose() }
  function handleEdit() { onClose(); navigate(`/manage-demand/${demandId}/edit`) }
  function handleAllocate() { onClose(); navigate(`/manage-demand/${demandId}/edit`) }
  function handleModelImpact() { onClose(); navigate(`/capacity?overlay=${demandId}&from=demand`) }

  function handleFooterAction(btn: FooterButton) {
    if (btn.kind === 'transitional' && btn.next) {
      handleTransition(btn.next)
    } else {
      if (btn.action === 'allocate') handleAllocate()
      if (btn.action === 'model-capacity') handleModelImpact()
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
              <div className="mt-1.5 flex flex-col gap-1 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge>{item.type}</Badge>
                  {/* §4.5.1 Demand header: Function chip */}
                  {demandFunction && (
                    <span className="px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-medium">
                      {demandFunction.name}
                    </span>
                  )}
                </div>
                {item.owner && <div className="text-gray-500">{item.owner}</div>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="primary" onClick={handleEdit}>
                <Edit2 size={12} /> Edit
              </Button>
              <OverflowMenu onDelete={handleDelete} isProjectSpawned={isProjectSpawned} />
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

          {/* §4.5.1 v1.19: Programme and "Part of: Project" lines in body zone */}
          <div className="flex flex-col gap-1 text-xs">
            <div>
              <span className="text-gray-400">Programme: </span>
              {isProjectSpawned
                ? programme
                  ? <span className="text-gray-600">{programme.name}</span>
                  : <span className="text-gray-400 italic">No Programme</span>
                : <span className="text-gray-400 italic">Direct Demand (no Programme)</span>
              }
            </div>
            <div>
              {isProjectSpawned && project ? (
                <>
                  <span className="text-gray-400">Part of: </span>
                  <button
                    onClick={() => setProjectDrawerId(project.id)}
                    className="text-brand hover:underline font-medium"
                  >
                    {project.name}
                  </button>
                </>
              ) : (
                <span className="text-gray-400 italic">Direct Demand</span>
              )}
            </div>
          </div>

          {/* §4.5.1 Origin badge + Sibling Demands */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Origin:</span>
              {isProjectSpawned ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Project-spawned
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                  Direct
                </span>
              )}
            </div>
            {siblingDemands.length > 0 && (
              <div className="text-xs flex items-start gap-1.5 flex-wrap">
                <span className="text-gray-400 shrink-0">Sibling Demands:</span>
                {siblingDemands.map(sib => {
                  const sibFn = store.functions.find(f => f.id === sib.function_id)
                  return (
                    <span key={sib.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-50 border border-border text-gray-600">
                      {sibFn?.name ?? sib.function_id} · <StatusBadge status={sib.status} />
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* Summary stats */}
          {(() => {
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

          {/* Functions involved */}
          {functionsInvolved.length > 0 && (
            <div className="text-xs flex items-start gap-2">
              <span className="text-gray-400 shrink-0 mt-0.5">Functions:</span>
              <div className="flex flex-wrap gap-1">
                {functionsInvolved.map(f => (
                  <span key={f!.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                    {f!.name}
                  </span>
                ))}
              </div>
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

        {/* ── Zone 4: Footer ─────────────────────────────────────────────── */}
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
                {btn.label === 'Model Capacity' && <ExternalLink size={12} />}
                {btn.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Nested Project drawer (opens when parent-Project link is clicked) */}
      {projectDrawerId && (
        <ProjectDrawer
          projectId={projectDrawerId}
          onClose={() => setProjectDrawerId(null)}
          onOpenDemand={(id) => { setProjectDrawerId(null); /* re-open this demand's sibling — for now just close */ void id }}
        />
      )}
    </div>
  )
}

// ─── Outer wrapper ────────────────────────────────────────────────────────────

export function DemandDrawer({ demandId, onClose }: Props) {
  const item = useAppStore(s => demandId ? s.demandItems.find(d => d.id === demandId) : undefined)
  if (!demandId || !item) return null
  return <DrawerContent demandId={demandId} item={item} onClose={onClose} />
}

// Alias for callers that haven't been updated yet
export const DemandEditor = DemandDrawer
