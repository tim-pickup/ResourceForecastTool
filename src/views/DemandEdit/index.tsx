import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { DemandItem, DemandStatus, ExternalResourceRequirement } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/FormFields'
import { StatusBadge } from '../../components/ui/Badge'
import { ActivityEditor, blankActivity, ActivityGantt } from './ModeAEditor'
import { AllocationWorkspace, computeAutoStatus } from './AllocationWorkspace'
// v1.18: Mode A = pre-Approved statuses; Mode B = allocation workspace
const MODE_A: DemandStatus[] = ['Draft', 'Submitted']
const MODE_B: DemandStatus[] = ['Approved', 'PartiallyAllocated', 'Allocated']

interface Transition { label: string; next: DemandStatus; variant?: 'danger' | 'secondary' }

function pageTransitions(status: DemandStatus, isNew: boolean): Transition[] {
  if (isNew) return []
  switch (status) {
    case 'Draft':     return [{ label: 'Submit Demand', next: 'Submitted' }]
    case 'Submitted': return [{ label: 'Approve', next: 'Approved' }]
    // PartiallyAllocated / Allocated: system auto-transitions only, no user actions here
    case 'Approved':
    case 'PartiallyAllocated':
    case 'Allocated': return []
  }
}

function blankDemand(activeFunctionId: string | null): Omit<DemandItem, 'id'> {
  return {
    name: '', type: '', status: 'Draft', owner: '',
    description: '',
    function_id: activeFunctionId ?? '',
    parent_project_id: null,
    activities: [],
  }
}

export default function DemandEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const store = useAppStore()
  const activeFunctionId = store.activeFunctionId

  const isNew = !id
  const existing = id ? store.demandItems.find(d => d.id === id) : null

  const [draft, setDraft] = useState<Omit<DemandItem, 'id'>>(() =>
    existing ? { ...existing } : blankDemand(activeFunctionId)
  )
  const [isDirty, setIsDirty] = useState(false)

  // External resource requirements — keyed by activity_id, tracked separately from draft
  const [extReqsByActivity, setExtReqsByActivity] = useState<Record<string, ExternalResourceRequirement[]>>(() => {
    if (!existing) return {}
    const result: Record<string, ExternalResourceRequirement[]> = {}
    for (const activity of existing.activities) {
      result[activity.id] = store.externalResourceRequirements.filter(r => r.activity_id === activity.id)
    }
    return result
  })

  const update = (fn: (d: Omit<DemandItem, 'id'>) => Omit<DemandItem, 'id'>) => {
    setDraft(fn)
    setIsDirty(true)
  }

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const mode: 'A' | 'B' = MODE_B.includes(draft.status as DemandStatus) ? 'B' : 'A'

  const handleSave = () => {
    let toSave = { ...draft }
    if (mode === 'B') {
      // Requirement-level over-allocation check (hard block)
      for (const activity of toSave.activities) {
        for (const req of activity.requirements) {
          if (activity.end_month === null) {
            const target = req.steady_state_hours ?? 0
            const allocated = req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0)
            if (allocated > target) {
              window.alert(`Allocation error: a requirement in "${activity.name || 'an activity'}" has more allocated hours than its target (${allocated}h vs ${target}h/mo). Reduce allocations before saving.`)
              return
            }
          } else {
            for (const [m, target] of Object.entries(req.hours_by_month)) {
              const allocated = req.allocations.reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0)
              if (allocated > target) {
                window.alert(`Allocation error: ${m} on a requirement in "${activity.name || 'an activity'}" exceeds its target (${allocated}h vs ${target}h). Reduce allocations before saving.`)
                return
              }
            }
          }
        }
      }
      toSave = { ...toSave, status: computeAutoStatus(toSave) }
    }
    if (isNew) {
      store.addDemandItem(toSave)
    } else if (id) {
      store.updateDemandItem(id, toSave)
    }

    // Sync external requirements: delete all for this demand's activities, then re-add from draft
    const activityIds = new Set(toSave.activities.map(ac => ac.id))
    for (const ext of store.externalResourceRequirements) {
      if (activityIds.has(ext.activity_id)) store.deleteExternalRequirement(ext.id)
    }
    for (const [, reqs] of Object.entries(extReqsByActivity)) {
      for (const req of reqs) {
        if (activityIds.has(req.activity_id)) {
          store.addExternalRequirement({ ...req })
        }
      }
    }

    setIsDirty(false)
    navigate('/manage-demand')
  }

  const handleCancel = () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    navigate('/manage-demand')
  }

  const handleStatusChange = (next: DemandStatus) => {
    update(d => ({ ...d, status: next }))
    if (!isNew && id) {
      store.updateDemandItem(id, { status: next })
    }
    setIsDirty(false)
  }

  const trans = pageTransitions(draft.status as DemandStatus, isNew)

  // Submit Demand gating: must have at least one activity with at least one requirement
  const submitHint = draft.status === 'Draft' && !isNew ? (() => {
    if (draft.activities.length === 0) return 'Add at least one activity first.'
    if (!draft.activities.some(ac => ac.requirements.length > 0)) return 'Add at least one requirement to an activity.'
    return null
  })() : null

  // §2.2.2 date validation — find any Activity with end < start
  const invalidDateActivity = draft.activities.find(ac =>
    ac.end_month !== null && !!ac.start_month && !!ac.end_month && ac.end_month < ac.start_month
  ) ?? null

  const updateActivity = (activityId: string, p: typeof draft.activities[0]) =>
    update(d => ({ ...d, activities: d.activities.map(x => x.id === activityId ? p : x) }))
  const deleteActivity = (activityId: string) =>
    update(d => ({ ...d, activities: d.activities.filter(x => x.id !== activityId) }))
  const addActivity = () =>
    update(d => ({ ...d, activities: [...d.activities, blankActivity()] }))

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-white sticky top-0 z-10 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={handleCancel} className="text-gray-400 hover:text-near-black transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <StatusBadge status={draft.status as DemandStatus} />
            <span className="text-sm font-semibold text-near-black">
              {isNew ? 'New Demand Item' : (draft.name || 'Unnamed')}
            </span>
            {isDirty && <span className="text-xs text-amber-600 font-medium">Unsaved</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {submitHint && (
            <span className="text-xs text-amber-600">{submitHint}</span>
          )}
          {invalidDateActivity && (
            <span className="text-xs text-accent-red">
              Date error — Activity {draft.activities.indexOf(invalidDateActivity) + 1}
              {invalidDateActivity.name ? ` "${invalidDateActivity.name}"` : ''}: end month before start.
            </span>
          )}
          {!isNew && trans.map(t => (
            <Button
              key={t.label}
              size="sm"
              variant={t.variant ?? 'secondary'}
              disabled={t.label === 'Submit Demand' && !!submitHint}
              onClick={() => handleStatusChange(t.next)}
            >
              {t.label}
            </Button>
          ))}
          <div className="h-4 w-px bg-border" />
          <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={handleSave} disabled={!!invalidDateActivity}>Save</Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-5 flex flex-col gap-5">

          {/* ── Mode A: Demand definition ── */}
          {mode === 'A' && (
            <>
              {/* Core fields */}
              <div className="flex flex-col gap-3">
                <Input
                  label="Name"
                  value={draft.name}
                  onChange={e => update(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Plant B MES Phase 2 Rollout"
                />
                <Select label="Type" value={draft.type} onChange={e => update(d => ({ ...d, type: e.target.value }))}>
                  <option value="">— Select type —</option>
                  {store.projectTypes.filter(pt => pt.active).sort((a, b) => a.display_order - b.display_order).map(pt => (
                    <option key={pt.id} value={pt.id}>{pt.name}</option>
                  ))}
                </Select>
                <Input label="Owner" value={draft.owner} onChange={e => update(d => ({ ...d, owner: e.target.value }))} placeholder="Name or role" />
                {/* Parent Project (read-only badge for project-spawned; editable for direct Demands in Draft) */}
                {draft.parent_project_id ? (
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Parent Project</label>
                    <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">
                      {store.projects.find(p => p.id === draft.parent_project_id)?.name ?? draft.parent_project_id}
                    </span>
                  </div>
                ) : null}
                <Textarea label="Description" value={draft.description} onChange={e => update(d => ({ ...d, description: e.target.value }))} placeholder="Brief description" />
              </div>

              {/* Activities — shown for all Mode A Demands */}
              {/* Direct Demands: fully editable (add/delete/edit headers + requirements)   */}
              {/* Spawned Demands in Submitted: activity headers read-only, requirements editable */}
              {(() => {
                const isSpawned = draft.parent_project_id !== null
                const readOnlyHeader = isSpawned  // spawned = activity header frozen
                const canEditActivities = !isSpawned  // only direct Demands can add/delete activities
                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">Activities</span>
                      {canEditActivities && (
                        <button onClick={addActivity} className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium">
                          + Add Activity
                        </button>
                      )}
                      {isSpawned && (
                        <span className="text-[10px] text-gray-400 italic">Activity shape is frozen (owned by parent Project)</span>
                      )}
                    </div>
                    {draft.activities.length > 0 && (
                      <ActivityGantt
                        activities={draft.activities}
                        onClickActivity={activityId => {
                          document.getElementById(`activity-${activityId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }}
                        readOnly={readOnlyHeader}
                      />
                    )}
                    <div className="flex flex-col gap-2">
                      {draft.activities.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No activities yet. Add an activity to define resource requirements.</p>
                      )}
                      {draft.activities.map((activity, idx) => (
                        <div key={activity.id} id={`activity-${activity.id}`}>
                          <ActivityEditor
                            activity={activity}
                            index={idx}
                            onChange={p => updateActivity(activity.id, p)}
                            onDelete={() => deleteActivity(activity.id)}
                            extReqs={extReqsByActivity[activity.id] ?? []}
                            onExtReqsChange={reqs => { setExtReqsByActivity(prev => ({ ...prev, [activity.id]: reqs })); setIsDirty(true) }}
                            demandId={id}
                            demandStatus={draft.status as DemandStatus}
                            readOnlyActivityHeader={readOnlyHeader}
                            functionScopeId={draft.function_id || null}
                          />
                        </div>
                      ))}
                    </div>
                    {canEditActivities && draft.activities.length > 0 && (
                      <button
                        onClick={addActivity}
                        className="mt-2 flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 w-full justify-center py-1.5 border border-dashed border-gray-200 rounded hover:border-gray-300 transition-colors"
                      >
                        + Add Activity
                      </button>
                    )}
                  </div>
                )
              })()}
            </>
          )}

          {/* ── Mode B: Allocation workspace ── */}
          {mode === 'B' && (
            <AllocationWorkspace
              draft={draft}
              demandItemId={id}
              onChange={d => { setDraft(d); setIsDirty(true) }}
            />
          )}

          {/* Save/Cancel footer repeat */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={handleSave} disabled={!!invalidDateActivity}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
