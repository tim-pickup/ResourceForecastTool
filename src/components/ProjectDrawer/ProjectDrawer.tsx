/**
 * ProjectDrawer — side-panel drawer for Projects (§4.5.1)
 *
 * Header:  Project name, Type badge, Programme name (or "No Programme"), Owner
 * Status:  status badge + child-Demand summary
 * Body:    Functions involved chips, description, phase summary
 * Footer:  per §4.5.1 footer button table (Submit for Scoping / Submit Project / empty)
 * Overflow: Delete only (§4.5.1)
 */

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MoreHorizontal, Trash2, Edit2 } from 'lucide-react'
import { parseISO, differenceInMonths } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../ui/Button'
import { StatusBadge, ProjectStatusBadge, Badge } from '../ui/Badge'
import type { ProjectStatus } from '../../types'

interface Props {
  projectId: string | null
  onClose: () => void
  onOpenDemand?: (demandId: string) => void
}

// ─── Overflow menu (Delete only) ────────────────────────────────────────────

function ProjectOverflowMenu({ project, onDelete }: {
  project: { name: string; id: string }
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const store = useAppStore()

  const childDemands = store.demandItems.filter(d => d.parent_project_id === project.id)
  const allocCount = childDemands.reduce((s, d) => {
    for (const ph of d.phases) for (const req of ph.requirements) s += req.allocations.length
    return s
  }, 0)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setConfirm(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const demandText = childDemands.length === 1 ? '1 child Demand' : `${childDemands.length} child Demands`
  const allocText = allocCount === 1 ? '1 named allocation' : `${allocCount} named allocations`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-gray-400 hover:text-near-black transition-colors p-1 rounded"
        title="More actions"
      >
        <MoreHorizontal size={15} />
      </button>
      {(open || confirm) && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-border rounded shadow-card z-50">
          {open && !confirm && (
            <button
              onClick={() => { setOpen(false); setConfirm(true) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 flex items-center gap-2 text-accent-red"
            >
              <Trash2 size={12} /> Delete Project
            </button>
          )}
          {confirm && (
            <div className="px-3 py-2.5">
              <p className="text-xs text-accent-red font-semibold mb-1">Delete "{project.name}"?</p>
              {childDemands.length > 0 && (
                <p className="text-xs text-gray-500 mb-2">
                  Cascades to {demandText} and {allocText}. This cannot be undone.
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setConfirm(false); onDelete() }} className="text-xs font-medium text-accent-red hover:underline">Delete</button>
                <button onClick={() => { setConfirm(false) }} className="text-xs text-gray-500 hover:underline">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main drawer ─────────────────────────────────────────────────────────────

function projectDateRange(phases: { start_month: string; end_month: string | null }[]): string {
  const starts = phases.map(p => p.start_month).filter(Boolean).sort()
  const ends = phases.map(p => p.end_month).filter((e): e is string => !!e).sort()
  if (!starts.length) return '—'
  const hasIndefinite = phases.some(p => p.end_month === null)
  const fmtM = (m: string) => { try { const d = parseISO(m + '-01'); return d.toLocaleString('default', { month: 'short', year: '2-digit' }) } catch { return m } }
  return `${fmtM(starts[0])} – ${hasIndefinite ? 'ongoing' : (ends.length ? fmtM(ends[ends.length - 1]) : '—')}`
}

// footer buttons per §4.5.1 Project footer table
function projectFooterButtons(status: ProjectStatus): Array<{ label: string; action: string; variant?: 'primary' | 'secondary' }> {
  switch (status) {
    case 'Draft':     return [{ label: 'Submit for Scoping', action: 'submit-for-scoping', variant: 'primary' }]
    case 'Scoping':   return [{ label: 'Submit Project', action: 'submit-project', variant: 'primary' }]
    case 'Submitted':
    case 'Approved':
    case 'Allocated': return []
  }
}

export function ProjectDrawer({ projectId, onClose, onOpenDemand }: Props) {
  const store = useAppStore()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const project = projectId ? store.projects.find(p => p.id === projectId) : null
  if (!project) return null

  const programme = project.programme_id ? store.programmes.find(p => p.id === project.programme_id) : null
  const childDemands = store.demandItems.filter(d => d.parent_project_id === projectId)

  // Functions involved: from project phase requirements + child demand function_ids
  const domFn = new Map(store.domains.map(d => [d.id, d.functionId]))
  const sklFn = new Map(store.skills.map(s => [s.id, domFn.get(s.domain_id)]))
  const fnIds = new Set<string>()
  for (const phase of project.phases) {
    for (const req of phase.requirements) {
      const fnId = sklFn.get(req.skill_id)
      if (fnId) fnIds.add(fnId)
    }
  }
  for (const d of childDemands) { if (d.function_id) fnIds.add(d.function_id) }
  const functionsInvolved = [...fnIds].map(id => store.functions.find(f => f.id === id)).filter(Boolean)

  // Hours summary from project phases
  let totalInternalHrs = 0, totalExternalHrs = 0
  for (const phase of project.phases) {
    for (const req of phase.requirements) {
      totalInternalHrs += phase.end_month === null
        ? (req.steady_state_hours ?? 0)
        : Object.values(req.hours_by_month).reduce((s, h) => s + h, 0)
    }
  }
  const projectPhaseIds = new Set(project.phases.map(ph => ph.id))
  for (const ext of store.externalResourceRequirements) {
    if (!projectPhaseIds.has(ext.phase_id)) continue
    const phase = project.phases.find(ph => ph.id === ext.phase_id)
    if (!phase) continue
    totalExternalHrs += phase.end_month === null
      ? (ext.steady_state_hours ?? 0)
      : Object.values(ext.hours_by_month).reduce((s, h) => s + h, 0)
  }

  const footerBtns = projectFooterButtons(project.status)

  function handleDelete() { store.deleteProject(projectId!); onClose() }
  function handleEdit() { onClose(); navigate(`/manage-projects/${projectId}/edit`) }

  function handleFooterAction(action: string) {
    setSubmitError(null)
    if (action === 'submit-for-scoping') {
      const err = store.submitProjectForScoping(projectId!)
      if (err) setSubmitError(err)
    } else if (action === 'submit-project') {
      // Check for unconfirmed team assignments (§11.18 — surface but don't block)
      const unconfirmed = store.projectTeamAssignments
        .filter(pta => pta.projectId === projectId && !pta.confirmed)
      if (unconfirmed.length > 0) {
        const names = unconfirmed
          .map(pta => store.teams.find(t => t.id === pta.teamId)?.name ?? pta.teamId)
          .join(', ')
        if (!window.confirm(`${unconfirmed.length} team(s) have not confirmed requirements:\n${names}\n\nProceed and spawn Demands anyway?`)) return
      }
      const err = store.submitProject(projectId!)
      if (err) setSubmitError(err)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-[440px] bg-white border-l border-border flex flex-col shadow-panel overflow-hidden">

        {/* ── Zone 1: Header ──────────────────────────────────────────────── */}
        <div className="px-5 py-3.5 border-b border-border">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-near-black leading-snug">{project.name || 'Unnamed Project'}</h2>
              <div className="mt-1.5 flex flex-col gap-1 text-xs">
                <div><Badge>{project.type}</Badge></div>
                <div className="text-gray-400">
                  {programme ? programme.name : <span className="italic">No Programme</span>}
                </div>
                {project.owner && <div className="text-gray-500">{project.owner}</div>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="primary" onClick={handleEdit}><Edit2 size={12} /> Edit</Button>
              <ProjectOverflowMenu project={project} onDelete={handleDelete} />
              <button onClick={onClose} className="text-gray-400 hover:text-near-black transition-colors p-1 rounded">
                <X size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Zone 2: Status ──────────────────────────────────────────────── */}
        <div className="px-5 py-2.5 border-b border-border bg-gray-50/50">
          <div className="flex items-center gap-2 flex-wrap">
            <ProjectStatusBadge status={project.status} />
            {childDemands.length > 0 && (
              <span className="text-xs text-gray-500">{childDemands.length} child Demand{childDemands.length > 1 ? 's' : ''}</span>
            )}
            {(project.status === 'Submitted' || project.status === 'Approved' || project.status === 'Allocated') && (
              <span className="text-xs text-gray-400 italic">auto-progresses from child Demand statuses</span>
            )}
          </div>
        </div>

        {/* ── Zone 3: Body ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {submitError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{submitError}</div>
          )}

          {/* Functions involved */}
          {functionsInvolved.length > 0 && (
            <div>
              <span className="text-xs text-gray-400 mr-1.5">Functions:</span>
              {functionsInvolved.map(fn => fn && (
                <span key={fn.id} className="inline-block mr-1 mb-1 px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">{fn.name}</span>
              ))}
            </div>
          )}

          {/* Description */}
          {project.description && (
            <p className="text-xs text-gray-600">{project.description}</p>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div><span className="text-gray-400">Phases: </span><span>{project.phases.length}</span></div>
            <div><span className="text-gray-400">Dates: </span><span>{projectDateRange(project.phases)}</span></div>
            {totalInternalHrs > 0 && (
              <div className="col-span-2"><span className="text-gray-400">Internal hours: </span><span>{Math.round(totalInternalHrs)}h</span></div>
            )}
            {totalExternalHrs > 0 && (
              <div className="col-span-2"><span className="text-amber-500">External hours: </span><span className="text-amber-700">{Math.round(totalExternalHrs)}h</span></div>
            )}
          </div>

          {/* Child Demands (for Submitted+) */}
          {childDemands.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Child Demands</div>
              <div className="flex flex-col gap-1.5">
                {childDemands.map(d => {
                  const fn = store.functions.find(f => f.id === d.function_id)
                  return (
                    <div key={d.id} className="flex items-center gap-2 p-2 rounded bg-gray-50 border border-border">
                      <div className="flex-1">
                        <button
                          onClick={() => onOpenDemand?.(d.id)}
                          className="text-xs font-medium text-brand hover:underline text-left"
                        >
                          {d.name}
                        </button>
                        {fn && <span className="ml-1.5 text-[10px] text-gray-400">{fn.name}</span>}
                      </div>
                      <StatusBadge status={d.status} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Phases list (compact) */}
          {project.phases.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Phases</div>
              <div className="flex flex-col gap-1">
                {project.phases.map((ph, i) => {
                  const reqCount = ph.requirements.length
                  const dateLabel = ph.end_month === null
                    ? `${ph.start_month} → ongoing`
                    : `${ph.start_month} – ${ph.end_month}`
                  return (
                    <div key={ph.id} className="text-xs flex items-center gap-2 py-1 border-b border-border/50 last:border-0">
                      <span className="text-gray-400 shrink-0">Phase {i + 1}</span>
                      <span className="flex-1 font-medium truncate">{ph.name || `Phase ${i + 1}`}</span>
                      <span className="text-gray-400 text-[10px] shrink-0">{dateLabel}</span>
                      {reqCount > 0 && <span className="text-[10px] text-gray-400">{reqCount} req{reqCount > 1 ? 's' : ''}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Zone 4: Footer ──────────────────────────────────────────────── */}
        {footerBtns.length > 0 && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
            {footerBtns.map(btn => (
              <Button key={btn.action} variant={btn.variant ?? 'primary'} onClick={() => handleFooterAction(btn.action)}>
                {btn.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
