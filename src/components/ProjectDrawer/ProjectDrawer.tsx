/**
 * ProjectDrawer — side-panel drawer for Projects (§4.5.1)
 *
 * Header:  Project name, Type badge, Programme name (or "No Programme"), Owner
 * Status:  status badge + child-Demand summary
 * Body:    Functions involved chips, description, activity summary
 * Footer:  per §4.5.1 footer button table (Submit for Scoping / Submit Project / empty)
 * Overflow: Delete only (§4.5.1)
 */

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MoreHorizontal, Trash2, Edit2, Eye } from 'lucide-react'
import { parseISO, differenceInMonths } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../ui/Button'
import { StatusBadge, ProjectStatusBadge, Badge } from '../ui/Badge'
import { SubmitProjectDialog } from '../SubmitProjectDialog'
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
    for (const ac of d.activities) for (const req of ac.requirements) s += req.allocations.length
    return s
  }, 0)
  const activityCount = childDemands.reduce((s, d) => s + d.activities.length, 0)

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
  const activityText = activityCount === 1 ? '1 activity' : `${activityCount} activities`

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
                  This Project has {demandText} with {allocText} across {activityText}. Deleting will permanently remove all of them.
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

function projectDateRange(activities: { start_month: string; end_month: string | null }[]): string {
  const starts = activities.map(p => p.start_month).filter(Boolean).sort()
  const ends = activities.map(p => p.end_month).filter((e): e is string => !!e).sort()
  if (!starts.length) return '—'
  const hasIndefinite = activities.some(p => p.end_month === null)
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
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [showPlanningRecord, setShowPlanningRecord] = useState(false)

  const project = projectId ? store.projects.find(p => p.id === projectId) : null
  if (!project) return null

  const programme = project.programme_id ? store.programmes.find(p => p.id === project.programme_id) : null
  const childDemands = store.demandItems.filter(d => d.parent_project_id === projectId)
  const typeName = store.projectTypes.find(pt => pt.id === project.type)?.name ?? project.type

  // Functions involved: from project activity requirements + child demand function_ids
  const domFn = new Map(store.domains.map(d => [d.id, d.functionId]))
  const sklFn = new Map(store.skills.map(s => [s.id, domFn.get(s.domain_id)]))
  const fnIds = new Set<string>()
  for (const activity of project.activities) {
    for (const req of activity.requirements) {
      const fnId = sklFn.get(req.skill_id)
      if (fnId) fnIds.add(fnId)
    }
  }
  for (const d of childDemands) { if (d.function_id) fnIds.add(d.function_id) }
  const functionsInvolved = [...fnIds].map(id => store.functions.find(f => f.id === id)).filter(Boolean)

  // Hours summary from project activities
  let totalInternalHrs = 0, totalExternalHrs = 0
  for (const activity of project.activities) {
    for (const req of activity.requirements) {
      totalInternalHrs += activity.end_month === null
        ? (req.steady_state_hours ?? 0)
        : Object.values(req.hours_by_month).reduce((s, h) => s + h, 0)
    }
  }
  const projectActivityIds = new Set(project.activities.map(ac => ac.id))
  for (const ext of store.externalResourceRequirements) {
    if (!projectActivityIds.has(ext.activity_id)) continue
    const activity = project.activities.find(ac => ac.id === ext.activity_id)
    if (!activity) continue
    totalExternalHrs += activity.end_month === null
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
      // §11.18: always opens confirmation dialog before spawning Demands
      setShowSubmitDialog(true)
    }
  }

  function handleConfirmSubmit() {
    setShowSubmitDialog(false)
    const err = store.submitProject(projectId!)
    if (err) setSubmitError(err)
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
                <div><Badge>{typeName}</Badge></div>
                {project.owner && <div className="text-gray-500">{project.owner}</div>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {(project.status === 'Submitted' || project.status === 'Approved' || project.status === 'Allocated') ? (
                <Button size="sm" variant="secondary" onClick={handleEdit}><Eye size={12} /> View</Button>
              ) : (
                <Button size="sm" variant="primary" onClick={handleEdit}><Edit2 size={12} /> Edit</Button>
              )}
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

        {/* ── Zone 3: Body — §4.5.1 v1.20 status-aware ──────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {submitError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{submitError}</div>
          )}

          {/* Common: Description + Programme */}
          {project.description && <p className="text-xs text-gray-600">{project.description}</p>}
          <div className="text-xs">
            <span className="text-gray-400">Programme: </span>
            {programme ? <span className="text-gray-600">{programme.name}</span> : <span className="text-gray-400 italic">No Programme</span>}
          </div>

          {/* ── Draft body ───────────────────────────────────────────────── */}
          {project.status === 'Draft' && (() => {
            const requiredFns = (project.functions_required ?? []).map(id => store.functions.find(f => f.id === id)).filter(Boolean)
            return (
              <>
                <div className="text-xs flex items-start gap-1.5 flex-wrap">
                  <span className="text-gray-400 shrink-0">Required:</span>
                  <div className="flex flex-wrap gap-1">
                    {requiredFns.length > 0
                      ? requiredFns.map(fn => fn && <span key={fn.id} className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">{fn.name}</span>)
                      : <span className="text-gray-400 italic">not yet declared</span>}
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {project.activities.length} {project.activities.length === 1 ? 'Activity' : 'Activities'}
                  {project.activities.length > 0 && <span className="ml-1 text-gray-400">· {projectDateRange(project.activities)}</span>}
                </div>
              </>
            )
          })()}

          {/* ── Scoping body ─────────────────────────────────────────────── */}
          {project.status === 'Scoping' && (() => {
            const requiredIds = new Set(project.functions_required ?? [])
            const requiredFns = [...requiredIds].map(id => store.functions.find(f => f.id === id)).filter(Boolean)
            const fullyMatch = functionsInvolved.length > 0 && requiredFns.length === functionsInvolved.length && functionsInvolved.every(f => f && requiredIds.has(f.id))
            return (
              <>
                <div className="flex flex-col gap-1.5">
                  <div className="text-xs flex items-start gap-1.5 flex-wrap">
                    <span className="text-gray-400 shrink-0">Required:</span>
                    <div className="flex flex-wrap gap-1">
                      {requiredFns.length > 0 ? requiredFns.map(fn => fn && <span key={fn.id} className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">{fn.name}</span>) : <span className="text-gray-400 italic">not declared</span>}
                    </div>
                  </div>
                  <div className="text-xs flex items-start gap-1.5 flex-wrap">
                    <span className="text-gray-400 shrink-0">Actually involved:</span>
                    <div className="flex flex-wrap gap-1 items-center">
                      {functionsInvolved.length > 0
                        ? functionsInvolved.map(fn => fn && (
                          <span key={fn.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">
                            {fn.name}
                            {!requiredIds.has(fn.id) && <span className="px-1 rounded bg-amber-100 text-amber-700 text-[9px] font-medium">added during Scoping</span>}
                          </span>))
                        : <span className="text-gray-400 italic">—</span>}
                      {fullyMatch && <span className="text-gray-400 text-[10px] italic ml-0.5">· matches plan</span>}
                    </div>
                  </div>
                </div>
                {project.activities.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Activities</span>
                    {project.activities.map((ac, i) => {
                      const intHrs = ac.requirements.reduce((s, r) => s + (ac.end_month === null ? (r.steady_state_hours ?? 0) : Object.values(r.hours_by_month).reduce((ss, h) => ss + h, 0)), 0)
                      const extReqs = store.externalResourceRequirements.filter(e => e.activity_id === ac.id)
                      const extHrs = extReqs.reduce((s, e) => s + (ac.end_month === null ? (e.steady_state_hours ?? 0) : Object.values(e.hours_by_month).reduce((ss, h) => ss + h, 0)), 0)
                      return (
                        <div key={ac.id} className="text-xs border border-border rounded px-2.5 py-2 bg-gray-50">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="font-medium">Activity {i + 1}{ac.name ? ` · ${ac.name}` : ''}</span>
                            <span className="text-gray-400">{ac.end_month === null ? `${ac.start_month} → ongoing` : `${ac.start_month} – ${ac.end_month}`}</span>
                          </div>
                          <div className="text-gray-400">{ac.funding_source}</div>
                          <div className="flex gap-3 mt-0.5 text-gray-500">
                            {ac.requirements.length > 0 && <span>{ac.requirements.length} internal req{ac.requirements.length !== 1 ? 's' : ''} · {Math.round(intHrs)}h</span>}
                            {extReqs.length > 0 && <span className="text-amber-500">{extReqs.length} external · {Math.round(extHrs)}h</span>}
                          </div>
                        </div>
                      )
                    })}
                    <div className="text-xs text-gray-500 pt-1 border-t border-border">
                      Total: {Math.round(totalInternalHrs)}h internal{totalExternalHrs > 0 ? ` · ${Math.round(totalExternalHrs)}h external` : ''}
                    </div>
                  </div>
                )}
              </>
            )
          })()}

          {/* ── Submitted / Approved / Allocated body ────────────────────── */}
          {(project.status === 'Submitted' || project.status === 'Approved' || project.status === 'Allocated') && (
            <>
              {childDemands.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Spawned Demands</div>
                  <div className="flex flex-col gap-1.5">
                    {childDemands.map(d => {
                      const fn = store.functions.find(f => f.id === d.function_id)
                      const dIntHrs = d.activities.reduce((s, ac) => s + ac.requirements.reduce((ss, r) => ss + (ac.end_month === null ? (r.steady_state_hours ?? 0) : Object.values(r.hours_by_month).reduce((sss, h) => sss + h, 0)), 0), 0)
                      return (
                        <div key={d.id} className="flex items-center gap-2 p-2 rounded bg-gray-50 border border-border">
                          {fn && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 shrink-0">{fn.name}</span>}
                          <div className="flex-1 min-w-0">
                            <button onClick={() => onOpenDemand?.(d.id)} className="text-xs font-medium text-brand hover:underline text-left truncate block w-full">{d.name}</button>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <StatusBadge status={d.status} />
                              {dIntHrs > 0 && <span className="text-[10px] text-gray-400">{Math.round(dIntHrs)}h</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {/* Planning record expander */}
              {project.activities.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowPlanningRecord(v => !v)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                  >
                    <span>{showPlanningRecord ? '▾' : '▸'}</span>
                    Show planning record at Submit
                  </button>
                  {showPlanningRecord && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <div className="text-xs text-gray-400 flex gap-2 flex-wrap">
                        <span>Required: {(project.functions_required ?? []).map(id => store.functions.find(f => f.id === id)?.name ?? id).join(', ') || 'not declared'}</span>
                      </div>
                      {project.activities.map((ac, i) => (
                        <div key={ac.id} className="text-xs border border-border rounded px-2.5 py-2 bg-gray-50">
                          <div className="font-medium">Activity {i + 1}{ac.name ? ` · ${ac.name}` : ''}</div>
                          <div className="text-gray-400">{ac.end_month === null ? `${ac.start_month} → ongoing` : `${ac.start_month} – ${ac.end_month}`}</div>
                          {ac.requirements.map(req => {
                            const skill = store.skills.find(s => s.id === req.skill_id)
                            return <div key={req.id} className="text-gray-500 mt-0.5">{skill?.name ?? req.skill_id} · {req.level}</div>
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
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

      {/* §11.18 Submit Project confirmation dialog */}
      {showSubmitDialog && projectId && (
        <SubmitProjectDialog
          projectId={projectId}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setShowSubmitDialog(false)}
        />
      )}
    </div>
  )
}
