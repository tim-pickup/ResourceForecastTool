/**
 * §11.18 — Scoping → Submitted confirmation dialog (Project)
 *
 * Shows spawn outcome (per-Function Demand previews with hour totals) and the
 * Functions-Required mismatch note when Scoping added Functions the originator
 * didn't anticipate. Used by ManageProjects, ProjectEdit, and ProjectDrawer.
 */

import { useAppStore } from '../store/useAppStore'
import { Button } from './ui/Button'

interface Props {
  projectId: string
  onConfirm: () => void
  onCancel: () => void
}

export function SubmitProjectDialog({ projectId, onConfirm, onCancel }: Props) {
  const store = useAppStore()
  const project = store.projects.find(p => p.id === projectId)
  if (!project) return null

  // Functions actually involved from internal requirements
  const domFn = new Map(store.domains.map(d => [d.id, d.functionId]))
  const sklFn = new Map(store.skills.map(s => [s.id, domFn.get(s.domain_id) ?? '']))
  const fnIds = new Set<string>()
  for (const activity of project.activities) {
    for (const req of activity.requirements) {
      const fnId = sklFn.get(req.skill_id)
      if (fnId) fnIds.add(fnId)
    }
  }

  // Zero-requirements — blocking error path (§11.18 zero-requirements path)
  if (fnIds.size === 0) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
        <div className="relative bg-white rounded-lg shadow-xl p-6 w-[480px] max-w-full mx-4">
          <h2 className="text-sm font-semibold text-near-black mb-3">Cannot Submit Project</h2>
          <p className="text-xs text-gray-600 mb-4">
            This Project has no internal requirements. Add at least one internal requirement to an activity
            before submitting — the Submit step spawns one Demand per Function actually involved, and a
            Project with no requirements has no Demands to spawn.
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="primary" onClick={onCancel}>Back to Editing</Button>
          </div>
        </div>
      </div>
    )
  }

  // Alphabetically-first Function name — fallback for null-tagged external reqs
  const alphabeticalFirstFn = [...fnIds].sort((a, b) => {
    const fa = store.functions.find(f => f.id === a)?.name ?? a
    const fb = store.functions.find(f => f.id === b)?.name ?? b
    return fa.localeCompare(fb)
  })[0] ?? ''

  const projectActivityIds = new Set(project.activities.map(ac => ac.id))
  const allProjectExternals = store.externalResourceRequirements.filter(e => projectActivityIds.has(e.activity_id))

  // Per-Function spawn preview
  const perFn = [...fnIds].map(fnId => {
    const fn = store.functions.find(f => f.id === fnId)
    const activityIdsForFn = new Set<string>()
    let reqCount = 0
    let internalHrs = 0

    for (const activity of project.activities) {
      const fnReqs = activity.requirements.filter(r => sklFn.get(r.skill_id) === fnId)
      if (fnReqs.length > 0) {
        activityIdsForFn.add(activity.id)
        reqCount += fnReqs.length
        for (const req of fnReqs) {
          if (activity.end_month === null) {
            internalHrs += req.steady_state_hours ?? 0
          } else {
            internalHrs += Object.values(req.hours_by_month).reduce((s, h) => s + h, 0)
          }
        }
      }
    }

    // External requirements routed to this Function
    const fnExternals = allProjectExternals.filter(e =>
      e.function_tag === fnId || (e.function_tag === null && fnId === alphabeticalFirstFn)
    )
    let externalHrs = 0
    const providerCounts = new Map<string, number>()
    for (const ext of fnExternals) {
      const activity = project.activities.find(ac => ac.id === ext.activity_id)
      if (!activity) continue
      activityIdsForFn.add(activity.id)
      if (activity.end_month === null) {
        externalHrs += ext.steady_state_hours ?? 0
      } else {
        externalHrs += Object.values(ext.hours_by_month).reduce((s, h) => s + h, 0)
      }
      const prov = store.providers.find(p => p.id === ext.provider_id)
      if (prov) providerCounts.set(prov.name, (providerCounts.get(prov.name) ?? 0) + 1)
    }

    return {
      fnId,
      fnName: fn?.name ?? fnId,
      phaseCount: activityIdsForFn.size,
      reqCount,
      externalCount: fnExternals.length,
      internalHrs: Math.round(internalHrs),
      externalHrs: Math.round(externalHrs),
      providerCounts,
      addedDuringScoping: !project.functions_required.includes(fnId),
    }
  }).sort((a, b) => a.fnName.localeCompare(b.fnName))

  const hasAddedDuringScoping = perFn.some(f => f.addedDuringScoping)
  const requiredFnNames = project.functions_required
    .map(id => store.functions.find(f => f.id === id)?.name ?? id)
    .filter(Boolean)
    .join(', ')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative bg-white rounded-lg shadow-xl p-6 w-[520px] max-w-full mx-4 max-h-[90vh] overflow-y-auto">

        <h2 className="text-sm font-semibold text-near-black mb-2">
          Submit "{project.name}"?
        </h2>

        {/* Functions Required mismatch note — informational, not blocking */}
        {hasAddedDuringScoping && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
            <span className="font-medium">Note:</span>{' '}
            {perFn.filter(f => f.addedDuringScoping).map(f => f.fnName).join(', ')}{' '}
            {perFn.filter(f => f.addedDuringScoping).length === 1 ? 'was' : 'were'} added during Scoping and
            {project.functions_required.length > 0
              ? ` not in the originator's plan (Functions Required: ${requiredFnNames}).`
              : ' not declared in Functions Required.'}
          </div>
        )}

        <p className="text-xs text-gray-600 mb-3">
          {perFn.length} Demand{perFn.length !== 1 ? 's' : ''} will be spawned, with activities and requirements
          materialised onto each:
        </p>

        {/* Per-Function preview rows */}
        <div className="flex flex-col gap-2 mb-4">
          {perFn.map(f => {
            const provList = [...f.providerCounts.entries()]
              .map(([name, count]) => `${count}× ${name}`)
              .join(', ')
            return (
              <div key={f.fnId} className="px-3 py-2 bg-gray-50 rounded text-xs border border-border">
                <div className="flex items-center gap-1.5 font-medium text-near-black mb-0.5">
                  {f.fnName}
                  {f.addedDuringScoping && (
                    <span className="text-[10px] font-normal text-amber-600 italic">(added during Scoping)</span>
                  )}
                </div>
                <div className="text-gray-500">
                  {f.reqCount} internal req{f.reqCount !== 1 ? 's' : ''} across{' '}
                  {f.phaseCount} activit{f.phaseCount !== 1 ? 'ies' : 'y'}
                  {f.externalCount > 0 && `, ${f.externalCount} external req${f.externalCount !== 1 ? 's' : ''}${provList ? ` (${provList})` : ''}`}.
                  {f.internalHrs > 0 && ` ${f.internalHrs.toLocaleString()}h internal`}
                  {f.externalHrs > 0 && `, ${f.externalHrs.toLocaleString()}h external`}.
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-gray-500 mb-4">
          The Project's planning record (activities, Functions Required, requirements) will be frozen at this
          point. Spawned Demands will be independently editable in Submitted before approval — Function
          teams can refine technical detail without affecting the Project record.
        </p>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={onConfirm}>Submit</Button>
        </div>
      </div>
    </div>
  )
}
