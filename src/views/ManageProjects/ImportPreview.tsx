/**
 * ImportPreview.tsx — §6 Import Preview modal (Change 9)
 *
 * Full-screen overlay that shows errors, warnings, and a per-project
 * preview of what will be created. Import is disabled if any errors exist.
 */

import { useMemo } from 'react'
import { X, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import type { ParseResult, ParsedImportProject } from '../../lib/excelImport'
import type { AppState } from '../../types'

interface Props {
  result: ParseResult
  state: AppState
  onConfirm: (projects: ParsedImportProject[]) => void
  onCancel: () => void
}

// ─── Spawn outcome computation ────────────────────────────────────────────────

function useSpawnOutcome(project: ParsedImportProject, state: AppState) {
  return useMemo(() => {
    const domFn = new Map(state.domains.map(d => [d.id, d.functionId]))
    const fnName = new Map(state.functions.map(f => [f.id, f.name]))

    // Count internal reqs by function
    const intByFn = new Map<string, number>()
    for (const ir of project.internalReqs) {
      const sk = state.skills.find(s => s.id === ir.skillId)
      if (!sk) continue
      const fnId = domFn.get(sk.domain_id)
      if (!fnId) continue
      intByFn.set(fnId, (intByFn.get(fnId) ?? 0) + 1)
    }

    // Count external reqs by function_tag (activityName → functionTag)
    const extByFn = new Map<string, number>()
    for (const er of project.externalReqs) {
      extByFn.set(er.functionTag, (extByFn.get(er.functionTag) ?? 0) + 1)
    }

    // Union of all functions
    const allFns = new Set([...intByFn.keys(), ...extByFn.keys()])

    return [...allFns]
      .sort((a, b) => (fnName.get(a) ?? a).localeCompare(fnName.get(b) ?? b))
      .map(fnId => ({
        fnId,
        fnNameStr: fnName.get(fnId) ?? fnId,
        intCount: intByFn.get(fnId) ?? 0,
        extCount: extByFn.get(fnId) ?? 0,
      }))
  }, [project, state])
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectPreviewCard({ project, state }: { project: ParsedImportProject; state: AppState }) {
  const spawnOutcome = useSpawnOutcome(project, state)
  const programmeName = project.programmeId
    ? (state.programmes.find(p => p.id === project.programmeId)?.name ?? 'Unknown Programme')
    : null
  const typeName = project.typeId
    ? (state.projectTypes.find(pt => pt.id === project.typeId)?.name ?? project.typeId)
    : '—'

  const totalActivities = project.activities.length
  const totalInt = project.internalReqs.length
  const totalExt = project.externalReqs.length

  return (
    <div className="border border-border rounded-lg bg-white shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-border bg-gray-50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-near-black truncate">{project.projectName}</h3>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-gray-500">{typeName}</span>
              {project.owner && (
                <><span className="text-gray-300">·</span><span className="text-xs text-gray-500">Owner: {project.owner}</span></>
              )}
              {programmeName ? (
                <><span className="text-gray-300">·</span><span className="text-xs text-indigo-600">{programmeName}</span></>
              ) : (
                <><span className="text-gray-300">·</span><span className="text-xs text-gray-400 italic">No Programme</span></>
              )}
            </div>
          </div>
          <div className="flex gap-3 text-xs text-gray-400 shrink-0">
            <span>{totalActivities} activit{totalActivities !== 1 ? 'ies' : 'y'}</span>
            <span>{totalInt} int</span>
            <span>{totalExt} ext</span>
          </div>
        </div>
        {project.description && (
          <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{project.description}</p>
        )}
      </div>

      {/* Activities */}
      <div className="px-4 py-3">
        <div className="grid grid-cols-1 gap-1.5">
          {project.activities.map((ac, i) => {
            const intCount = project.internalReqs.filter(r => r.activityName === ac.name).length
            const extCount = project.externalReqs.filter(r => r.activityName === ac.name).length
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-medium text-gray-700 min-w-0 truncate flex-1">{ac.name}</span>
                <span className="text-gray-400 shrink-0">
                  {ac.startMonth}{ac.endMonth ? ` – ${ac.endMonth}` : ' (ongoing)'}
                </span>
                {ac.fundingSource && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 text-[10px] shrink-0">
                    {ac.fundingSource}
                  </span>
                )}
                <span className="text-gray-400 shrink-0">{intCount}i {extCount}e</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Spawn outcome */}
      {spawnOutcome.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border bg-indigo-50/40">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-indigo-700">
              Will spawn {spawnOutcome.length} Demand{spawnOutcome.length !== 1 ? 's' : ''}:
            </span>
            {spawnOutcome.map(s => (
              <span key={s.fnId} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-800 border border-indigo-200">
                {s.fnNameStr}
                <span className="text-indigo-500">({s.intCount}i{s.extCount > 0 ? ` ${s.extCount}e` : ''})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ImportPreview({ result, state, onConfirm, onCancel }: Props) {
  const { errors, warnings, projects } = result
  const hasErrors = errors.length > 0

  const totalActivities = projects.reduce((s, p) => s + p.activities.length, 0)
  const totalInt    = projects.reduce((s, p) => s + p.internalReqs.length, 0)
  const totalExt    = projects.reduce((s, p) => s + p.externalReqs.length, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 overflow-hidden">
      {/* Panel */}
      <div className="relative flex flex-col bg-white w-full max-w-[880px] h-full shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border bg-white shrink-0">
          <div>
            <h2 className="text-base font-semibold text-near-black">
              Import Preview — {projects.length} Project{projects.length !== 1 ? 's' : ''}
            </h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
              <span>{projects.length} projects</span>
              <span className="text-gray-300">·</span>
              <span>{totalActivities} activities</span>
              <span className="text-gray-300">·</span>
              <span>{totalInt} internal reqs</span>
              <span className="text-gray-300">·</span>
              <span>{totalExt} external reqs</span>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors ml-4 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Errors */}
          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-red-200 bg-red-100">
                <AlertCircle size={14} className="text-red-600 shrink-0" />
                <span className="text-sm font-semibold text-red-700">{errors.length} Error{errors.length !== 1 ? 's' : ''} — Fix before importing</span>
              </div>
              <div className="divide-y divide-red-100">
                {errors.map((e, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-2 text-xs text-red-800">
                    <span className="shrink-0 text-red-400 font-mono mt-0.5">{e.tab}{e.row > 0 ? `:${e.row}` : ''}</span>
                    {e.column && <span className="shrink-0 text-red-500 font-medium">[{e.column}]</span>}
                    <span>{e.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200 bg-amber-100">
                <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                <span className="text-sm font-semibold text-amber-700">{warnings.length} Warning{warnings.length !== 1 ? 's' : ''} — Review before importing</span>
              </div>
              <div className="divide-y divide-amber-100">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-2 text-xs text-amber-800">
                    <span className="shrink-0 text-amber-400 font-mono mt-0.5">{w.tab}{w.row > 0 ? `:${w.row}` : ''}</span>
                    <span>{w.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All-clear message when no errors or warnings */}
          {!hasErrors && warnings.length === 0 && projects.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-green-200 bg-green-50 text-sm text-green-700">
              <CheckCircle2 size={14} className="shrink-0" />
              <span>All checks passed. Ready to import.</span>
            </div>
          )}

          {/* Project cards */}
          {projects.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Projects to create</h3>
              {projects.map((project, i) => (
                <ProjectPreviewCard key={i} project={project} state={state} />
              ))}
            </div>
          )}

          {projects.length === 0 && !hasErrors && (
            <p className="text-sm text-gray-400 italic text-center py-10">No projects found in the workbook.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-white shrink-0">
          <div className="text-xs text-gray-400">
            {hasErrors
              ? 'Resolve all errors to enable import.'
              : warnings.length > 0
                ? `${warnings.length} warning${warnings.length !== 1 ? 's' : ''} — import will proceed.`
                : ''}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={hasErrors || projects.length === 0}
              onClick={() => onConfirm(projects)}
            >
              Import {projects.length} Project{projects.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
