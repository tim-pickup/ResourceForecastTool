/**
 * ProjectEdit — Mode A editor for Projects (§4.5.2)
 *
 * Project Draft:   name, type, owner, description, Programme, phases + requirements
 * Project Scoping: same + requirements UI
 * Submitted+:      read-only, shows child Demands summary
 */

import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { Project, ProjectStatus, ExternalResourceRequirement, Activity } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/FormFields'
import { ProjectStatusBadge } from '../../components/ui/Badge'
import { ActivityEditor, blankActivity, ActivityGantt } from '../DemandEdit/ModeAEditor'
import { SubmitProjectDialog } from '../../components/SubmitProjectDialog'


function blankProject(): Omit<Project, 'id'> {
  return {
    name: '',
    type: '',
    owner: '',
    description: '',
    programme_id: null,
    status: 'Draft',
    activities: [],
    active: true,
    functions_required: [],
    functions_actually_involved: [],
    created_under_function_id: null,
  }
}

// ─── Programme picker ─────────────────────────────────────────────────────────

function ProgrammePicker({ value, onChange, disabled }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const store = useAppStore()
  const programmes = store.programmes.filter(p => p.active)

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-medium text-gray-700">Programme</label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="text-xs border border-border rounded px-2 py-1.5 bg-white disabled:bg-gray-50 disabled:text-gray-500"
        disabled={disabled}
      >
        <option value="">— Unaligned (no Programme) —</option>
        {programmes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  )
}

// ─── Project activity wrapper ─────────────────────────────────────────────────

function ProjectActivityEditor({
  activity,
  index,
  projectStatus,
  onChange,
  onDelete,
  extReqs,
  onExtReqsChange,
}: {
  activity: Activity
  index: number
  projectStatus: ProjectStatus
  onChange: (p: Activity) => void
  onDelete: () => void
  extReqs: ExternalResourceRequirement[]
  onExtReqsChange: (r: ExternalResourceRequirement[]) => void
}) {
  const showRequirements = projectStatus === 'Scoping'

  return (
    <div className="border-2 border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-100 border-b border-border">
        <h3 className="text-sm font-semibold text-near-black">
          Activity {index + 1}{activity.name ? ` · ${activity.name}` : ''}{' '}
          <span className="font-normal text-gray-500">
            {activity.end_month === null
              ? `${activity.start_month || '?'} → ongoing`
              : `${activity.start_month || '?'} – ${activity.end_month || '?'}`}
          </span>
        </h3>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        <ActivityEditor
          activity={activity}
          index={index}
          onChange={onChange}
          onDelete={onDelete}
          extReqs={showRequirements ? extReqs : []}
          onExtReqsChange={showRequirements ? onExtReqsChange : () => undefined}
          showRequirements={showRequirements}
          functionScopeId={null}             // Project Scoping: full Skill catalogue across all Functions
          showFunctionTagPicker={showRequirements}  // Function tag picker on ext reqs in Scoping
        />
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProjectEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const store = useAppStore()

  const isNew = !id
  const existing = id ? store.projects.find(p => p.id === id) : null

  const [draft, setDraft] = useState<Omit<Project, 'id'>>(() =>
    existing ? { ...existing } : blankProject()
  )
  const [isDirty, setIsDirty] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)

  // External requirements state keyed by activity_id
  const [extReqsByActivity, setExtReqsByActivity] = useState<Record<string, ExternalResourceRequirement[]>>(() => {
    if (!existing) return {}
    const result: Record<string, ExternalResourceRequirement[]> = {}
    for (const activity of existing.activities) {
      result[activity.id] = store.externalResourceRequirements.filter(r => r.activity_id === activity.id)
    }
    return result
  })

  const update = (fn: (d: Omit<Project, 'id'>) => Omit<Project, 'id'>) => {
    setDraft(fn); setIsDirty(true)
  }

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // §4.6.A Function-switch guard: if this Draft/Scoping Project becomes invisible
  // under the new active Function, close the edit page and return to Manage Projects.
  const activeFunctionId = store.activeFunctionId
  const prevActiveFnRef = useRef<string | null>(activeFunctionId)
  useEffect(() => {
    if (!id || isNew) return
    if (prevActiveFnRef.current === activeFunctionId) return
    prevActiveFnRef.current = activeFunctionId

    const project = store.projects.find(p => p.id === id)
    if (!project || (project.status !== 'Draft' && project.status !== 'Scoping')) return
    if (!activeFunctionId) return

    // Compute visibility under new function
    const domFn = new Map(store.domains.map(d => [d.id, d.functionId]))
    const sklFn = new Map(store.skills.map(s => [s.id, domFn.get(s.domain_id)]))
    let visible = false
    if (project.status === 'Draft') {
      visible = project.functions_required.includes(activeFunctionId) ||
        (project.functions_required.length === 0 && project.created_under_function_id === activeFunctionId)
    } else {
      visible = project.functions_required.includes(activeFunctionId) ||
        project.activities.some(ac => ac.requirements.some(r => sklFn.get(r.skill_id) === activeFunctionId)) ||
        (project.functions_required.length === 0 &&
          !project.activities.some(ac => ac.requirements.some(r => sklFn.get(r.skill_id))) &&
          project.created_under_function_id === activeFunctionId)
    }

    if (!visible) {
      const newFn = store.functions.find(f => f.id === activeFunctionId)
      navigate('/manage-projects', {
        state: { closedProjectToast: `Project "${project.name}" is not associated with ${newFn?.name ?? 'the new Function'} — returning to Manage Projects.` }
      })
    }
  }, [activeFunctionId, id, isNew, store.projects, store.domains, store.skills, store.functions, navigate])

  const isReadOnly = draft.status !== 'Draft' && draft.status !== 'Scoping'

  const handleSave = () => {
    if (isNew) {
      store.addProject(draft)
    } else if (id) {
      store.updateProject(id, draft)
      // Sync external requirements for project activities
      const activityIds = new Set(draft.activities.map(ac => ac.id))
      for (const ext of store.externalResourceRequirements) {
        if (activityIds.has(ext.activity_id)) store.deleteExternalRequirement(ext.id)
      }
      for (const [, reqs] of Object.entries(extReqsByActivity)) {
        for (const req of reqs) {
          if (activityIds.has(req.activity_id)) store.addExternalRequirement({ ...req })
        }
      }
    }
    setIsDirty(false)
    navigate('/manage-projects')
  }

  const handleCancel = () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    navigate('/manage-projects')
  }

  // Submit for Scoping (Draft → Scoping)
  const handleSubmitForScoping = () => {
    if (!id) return
    // Save first
    store.updateProject(id, draft)
    const err = store.submitProjectForScoping(id)
    if (err) { setSubmitError(err); return }
    setDraft(d => ({ ...d, status: 'Scoping' }))
    setIsDirty(false)
    setSubmitError(null)
  }

  // Submit Project (Scoping → Submitted + spawn) — always opens §11.18 dialog
  const handleSubmitProject = () => {
    if (!id) return
    store.updateProject(id, draft)
    setShowSubmitDialog(true)
  }

  const handleConfirmSubmit = () => {
    if (!id) return
    const err = store.submitProject(id)
    setShowSubmitDialog(false)
    if (err) { setSubmitError(err); return }
    setDraft(d => ({ ...d, status: 'Submitted' }))
    setIsDirty(false)
    setSubmitError(null)
  }

  const updateActivity = (activityId: string, p: Activity) =>
    update(d => ({ ...d, activities: d.activities.map(x => x.id === activityId ? p : x) }))
  const deleteActivity = (activityId: string) =>
    update(d => ({ ...d, activities: d.activities.filter(x => x.id !== activityId) }))
  const addActivity = () =>
    update(d => ({ ...d, activities: [...d.activities, blankActivity()] }))

  // Derived: Functions involved from requirements
  const domFn = new Map(store.domains.map(d => [d.id, d.functionId]))
  const sklFn = new Map(store.skills.map(s => [s.id, domFn.get(s.domain_id)]))
  const fnIds = new Set<string>()
  for (const activity of draft.activities) {
    for (const req of activity.requirements) {
      const fnId = sklFn.get(req.skill_id)
      if (fnId) fnIds.add(fnId)
    }
  }
  const functionsInvolved = [...fnIds].map(fid => store.functions.find(f => f.id === fid)).filter(Boolean)

  const childDemands = id ? store.demandItems.filter(d => d.parent_project_id === id) : []

  // Gate hints — Submit for Scoping requires ≥1 activity AND ≥1 Function in functions_required
  const submitHint = id && draft.status === 'Draft' ? (() => {
    if (draft.activities.length === 0) return 'Add at least one activity.'
    if (draft.functions_required.length === 0) return 'Add at least one Function to Functions Required.'
    return null
  })() : null

  // §2.2.2 date validation — find any Activity with end < start
  const invalidDateActivity = draft.activities.find(ac =>
    ac.end_month !== null && !!ac.start_month && !!ac.end_month && ac.end_month < ac.start_month
  ) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-white sticky top-0 z-10 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={handleCancel} className="text-gray-400 hover:text-near-black transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <ProjectStatusBadge status={draft.status as ProjectStatus} />
            <span className="text-sm font-semibold text-near-black">
              {isNew ? 'New Project' : (draft.name || 'Unnamed Project')}
            </span>
            {isDirty && <span className="text-xs text-amber-600 font-medium">Unsaved</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {submitError && <span className="text-xs text-red-600">{submitError}</span>}
          {submitHint && <span className="text-xs text-amber-600">{submitHint}</span>}
          {invalidDateActivity && (
            <span className="text-xs text-accent-red">
              Date error — Activity {draft.activities.indexOf(invalidDateActivity) + 1}
              {invalidDateActivity.name ? ` "${invalidDateActivity.name}"` : ''}: end month before start.
            </span>
          )}

          {/* Action buttons by status */}
          {!isNew && draft.status === 'Draft' && (
            <Button size="sm" variant="primary" onClick={handleSubmitForScoping} disabled={!!submitHint}>
              Submit for Scoping
            </Button>
          )}
          {!isNew && draft.status === 'Scoping' && (
            <Button size="sm" variant="primary" onClick={handleSubmitProject}>
              Submit Project
            </Button>
          )}

          {!isReadOnly && (
            <>
              <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
              <Button size="sm" variant="secondary" onClick={handleSave} disabled={(!isDirty && !isNew) || !!invalidDateActivity}>Save</Button>
            </>
          )}
          {isReadOnly && (
            <Button size="sm" variant="ghost" onClick={handleCancel}>Close</Button>
          )}
        </div>
      </div>

      {/* Page body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 max-w-3xl mx-auto w-full">
        <div className="flex flex-col gap-6">

          {/* Metadata */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Project Name"
                value={draft.name}
                onChange={e => update(d => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Plant C MES Migration"
                disabled={isReadOnly}
              />
              <Select
                label="Type"
                value={draft.type}
                onChange={e => update(d => ({ ...d, type: e.target.value }))}
                disabled={isReadOnly}
              >
                <option value="">— Select type —</option>
                {store.projectTypes.filter(pt => pt.active).sort((a, b) => a.display_order - b.display_order).map(pt => (
                  <option key={pt.id} value={pt.id}>{pt.name}</option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Owner"
                value={draft.owner}
                onChange={e => update(d => ({ ...d, owner: e.target.value }))}
                placeholder="e.g. John Smith"
                disabled={isReadOnly}
              />
              <ProgrammePicker
                value={draft.programme_id}
                onChange={v => update(d => ({ ...d, programme_id: v }))}
                disabled={isReadOnly}
              />
            </div>
            <Textarea
              label="Description"
              value={draft.description}
              onChange={e => update(d => ({ ...d, description: e.target.value }))}
              placeholder="What is this project about?"
              disabled={isReadOnly}
            />
            {/* Functions Required picker (Draft and Scoping only — frozen at Submit) */}
            {(draft.status === 'Draft' || draft.status === 'Scoping') && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-700">
                  Functions Required
                  <span className="ml-1 font-normal text-gray-400">(originator's plan — hint, not binding)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {store.functions.filter(f => f.active).sort((a, b) => a.name.localeCompare(b.name)).map(fn => {
                    const checked = draft.functions_required.includes(fn.id)
                    return (
                      <label key={fn.id} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...draft.functions_required, fn.id]
                              : draft.functions_required.filter(id => id !== fn.id)
                            update(d => ({ ...d, functions_required: next }))
                          }}
                          className="accent-brand"
                        />
                        {fn.name}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Functions Actually Involved chips (derived live; frozen at Submit as audit record) */}
            <div className="flex flex-col gap-1">
              {(draft.status === 'Draft' || draft.status === 'Scoping') ? (
                <>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Functions Actually Involved (derived from requirements)</span>
                  <div className="flex flex-wrap gap-1">
                    {functionsInvolved.length === 0 ? (
                      <span className="text-[10px] text-gray-400 italic">None yet — add requirements to phases in Scoping.</span>
                    ) : (
                      functionsInvolved.map(fn => fn && (
                        <span
                          key={fn.id}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            draft.functions_required.includes(fn.id)
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-700 border-amber-300'
                          }`}
                        >
                          {fn.name}
                          {!draft.functions_required.includes(fn.id) && (
                            <span className="ml-1 italic">(added during Scoping)</span>
                          )}
                        </span>
                      ))
                    )}
                  </div>
                </>
              ) : (
                /* Submitted+: show frozen Functions Actually Involved */
                draft.functions_actually_involved.length > 0 && (
                  <>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Functions Actually Involved</span>
                    <div className="flex flex-wrap gap-1">
                      {draft.functions_actually_involved.map(fnId => {
                        const fn = store.functions.find(f => f.id === fnId)
                        return fn ? (
                          <span key={fnId} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-medium">
                            {fn.name}
                          </span>
                        ) : null
                      })}
                    </div>
                  </>
                )
              )}
            </div>
          </div>

          {/* Child Demands (Submitted+) */}
          {childDemands.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Child Demands</h3>
              <div className="flex flex-col gap-1.5">
                {childDemands.map(d => {
                  const fn = store.functions.find(f => f.id === d.function_id)
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded bg-gray-50 border border-border text-xs">
                      <span className="flex-1 font-medium">{d.name}</span>
                      {fn && <span className="text-gray-400">{fn.name}</span>}
                      <span className="text-gray-500 capitalize">{d.status}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Activities — editable in Draft/Scoping, read-only summary in Submitted+ (§4.6.A v1.19) */}
          {isReadOnly && draft.activities.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Activities (frozen planning record)</h3>
              <div className="flex flex-col gap-1.5">
                {draft.activities.map((ac, i) => {
                  const extCount = (extReqsByActivity[ac.id] ?? []).length
                  return (
                    <div key={ac.id} className="border border-border rounded-md px-3 py-2 text-xs bg-gray-50">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Activity {i + 1}{ac.name ? ` · ${ac.name}` : ''}</span>
                        <span className="text-gray-400">
                          {ac.end_month === null ? `${ac.start_month} → ongoing` : `${ac.start_month} – ${ac.end_month}`}
                        </span>
                      </div>
                      <div className="text-gray-500 mt-0.5">{ac.funding_source}{ac.funding_notes ? ` — ${ac.funding_notes}` : ''}</div>
                      <div className="flex gap-3 mt-0.5 text-gray-400">
                        {ac.requirements.length > 0 && <span>{ac.requirements.length} internal req{ac.requirements.length !== 1 ? 's' : ''}</span>}
                        {extCount > 0 && <span className="text-amber-500">{extCount} external req{extCount !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!isReadOnly && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Activities</h3>
                <Button size="sm" variant="ghost" onClick={addActivity}><Plus size={12} /> Add Activity</Button>
              </div>

              {draft.activities.length > 0 && (
                <ActivityGantt
                  activities={draft.activities}
                  onClickActivity={activityId => {
                    document.getElementById(`prj-activity-${activityId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                />
              )}

              {draft.activities.length === 0 && (
                <p className="text-xs text-gray-400 italic">No activities yet. Add at least one activity.</p>
              )}

              <div className="flex flex-col gap-4 mt-3">
                {draft.activities.map((activity, idx) => (
                  <div key={activity.id} id={`prj-activity-${activity.id}`}>
                    {id ? (
                      <ProjectActivityEditor
                        activity={activity}
                        index={idx}
                        projectStatus={draft.status as ProjectStatus}
                        onChange={p => updateActivity(activity.id, p)}
                        onDelete={() => deleteActivity(activity.id)}
                        extReqs={extReqsByActivity[activity.id] ?? []}
                        onExtReqsChange={reqs => { setExtReqsByActivity(prev => ({ ...prev, [activity.id]: reqs })); setIsDirty(true) }}
                      />
                    ) : (
                      // For new projects (no id yet), use simple ActivityEditor without teams
                      // §4.5.2 Project Draft strict rule: requirements hidden until Scoping
                      <div className="border-2 border-border rounded-lg overflow-hidden">
                        <div className="px-4 py-3 bg-gray-100 border-b border-border">
                          <h3 className="text-sm font-semibold text-near-black">
                            Activity {idx + 1}{activity.name ? ` · ${activity.name}` : ''}
                          </h3>
                        </div>
                        <div className="px-4 py-3">
                          <ActivityEditor
                            activity={activity}
                            index={idx}
                            onChange={p => updateActivity(activity.id, p)}
                            onDelete={() => deleteActivity(activity.id)}
                            extReqs={[]}
                            onExtReqsChange={() => undefined}
                            showRequirements={false}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save footer (for Draft/Scoping) */}
          {!isReadOnly && (
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={handleSave}>Save</Button>
            </div>
          )}
        </div>
      </div>

      {/* §11.18 Submit Project confirmation dialog */}
      {showSubmitDialog && id && (
        <SubmitProjectDialog
          projectId={id}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setShowSubmitDialog(false)}
        />
      )}
    </div>
  )
}
