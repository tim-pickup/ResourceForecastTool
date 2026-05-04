/**
 * ManageProjects — §4.6.A
 *
 * 5-column Kanban (Draft / Scoping / Submitted / Approved / Allocated) for the
 * Project lifecycle. Active-Function visibility rule applied.
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, LayoutGrid, List, GripVertical, ChevronUp, ChevronDown, X, Download, Upload } from 'lucide-react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { useAppStore } from '../../store/useAppStore'
import { ProjectDrawer } from '../../components/ProjectDrawer/ProjectDrawer'
import { DemandDrawer } from '../../components/DemandEditor/DemandEditor'
import { ProjectStatusBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { SubmitProjectDialog } from '../../components/SubmitProjectDialog'
import { ImportPreview } from './ImportPreview'
import type { Project, ProjectStatus, Activity, ExternalResourceRequirement } from '../../types'
import type { ParseResult, ParsedImportProject } from '../../lib/excelImport'
import { clsx } from 'clsx'
import { getCurrentMonth, generateMonths } from '../../utils/capacity'
import { project_internal_hours, project_external_hours } from '../../lib/capacity'
import { generateId } from '../../utils/ids'

const PROJECT_STATUSES: ProjectStatus[] = ['Draft', 'Scoping', 'Submitted', 'Approved', 'Allocated']

const COLUMN_COLORS: Record<ProjectStatus, string> = {
  Draft: 'bg-gray-50',
  Scoping: 'bg-purple-50',
  Submitted: 'bg-yellow-50',
  Approved: 'bg-blue-50',
  Allocated: 'bg-green-50',
}

type ViewMode = 'board' | 'table' | 'search'

// ─── Compute Functions involved for a Project ─────────────────────────────────

function useProjectFunctions(project: Project) {
  const store = useAppStore()
  return useMemo(() => {
    const domFn = new Map(store.domains.map(d => [d.id, d.functionId]))
    const sklFn = new Map(store.skills.map(s => [s.id, domFn.get(s.domain_id)]))
    const fnIds = new Set<string>()
    for (const activity of project.activities) {
      for (const req of activity.requirements) {
        const fnId = sklFn.get(req.skill_id)
        if (fnId) fnIds.add(fnId)
      }
    }
    // Also from child demands
    for (const d of store.demandItems.filter(d => d.parent_project_id === project.id)) {
      if (d.function_id) fnIds.add(d.function_id)
    }
    return [...fnIds].map(id => store.functions.find(f => f.id === id)).filter(Boolean)
  }, [project, store.domains, store.skills, store.demandItems, store.functions])
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: project.id })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  const store = useAppStore()
  const programme = project.programme_id ? store.programmes.find(p => p.id === project.programme_id) : null
  const fns = useProjectFunctions(project)
  const childCount = store.demandItems.filter(d => d.parent_project_id === project.id).length
  const typeName = store.projectTypes.find(pt => pt.id === project.type)?.name ?? project.type

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'bg-white border border-border rounded p-3 shadow-sm cursor-pointer hover:border-border-hover transition-colors',
        isDragging && 'opacity-50 shadow-card'
      )}
      onClick={onOpen}
    >
      <div className="flex items-start gap-2">
        <div {...listeners} {...attributes} className="text-gray-300 hover:text-gray-400 pt-0.5 cursor-grab" onClick={e => e.stopPropagation()}>
          <GripVertical size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-near-black truncate">{project.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">{typeName}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {programme ? programme.name : <span className="italic">No Programme</span>}
          </div>
          {/* §4.6.A v1.19: Functions Actually Involved chips */}
          {fns.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {fns.map(fn => fn && (
                <span key={fn.id} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {fn.name}
                </span>
              ))}
            </div>
          )}
          {/* "Required: …" footnote — Draft/Scoping only */}
          {(project.status === 'Draft' || project.status === 'Scoping') && project.functions_required.length > 0 && (
            <div className="text-[9px] text-gray-400 mt-0.5">
              Required: {project.functions_required.map(fid => store.functions.find(f => f.id === fid)?.name ?? fid).join(', ')}
            </div>
          )}
          {childCount > 0 && (
            <div className="text-[10px] text-gray-400 mt-0.5">{childCount} Demand{childCount !== 1 ? 's' : ''}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Droppable column ─────────────────────────────────────────────────────────

function DroppableColumn({ status, children }: { status: ProjectStatus; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'flex-1 min-w-[180px] rounded-md p-3 flex flex-col gap-2 min-h-[200px] transition-colors',
        COLUMN_COLORS[status],
        isOver && 'ring-2 ring-brand ring-offset-1'
      )}
    >
      {children}
    </div>
  )
}

// ─── Table row ────────────────────────────────────────────────────────────────

function ProjectTableRow({
  project,
  horizon,
  onOpen,
}: {
  project: Project
  horizon: string[]
  onOpen: () => void
}) {
  const store = useAppStore()
  const programme = project.programme_id ? store.programmes.find(p => p.id === project.programme_id) : null
  const fns = useProjectFunctions(project)
  const childCount = store.demandItems.filter(d => d.parent_project_id === project.id).length
  const intHrs = horizon.reduce((s, m) => s + project_internal_hours(project.id, m, store), 0)
  const extHrs = horizon.reduce((s, m) => s + project_external_hours(project.id, m, store), 0)
  const typeName = store.projectTypes.find(pt => pt.id === project.type)?.name ?? project.type

  return (
    <tr onClick={onOpen} className="border-b border-border/50 hover:bg-gray-50 cursor-pointer">
      <td className="px-4 py-2.5 font-medium text-near-black">{project.name}</td>
      <td className="px-4 py-2.5 text-xs text-gray-600">{typeName}</td>
      <td className="px-4 py-2.5"><ProjectStatusBadge status={project.status} /></td>
      <td className="px-4 py-2.5 text-xs text-gray-500">{programme?.name ?? <span className="text-gray-300 italic">No Programme</span>}</td>
      <td className="px-4 py-2.5 text-xs text-gray-600">{project.owner || '—'}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {fns.map(fn => fn && (
            <span key={fn.id} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
              {fn.name}
            </span>
          ))}
          {fns.length === 0 && <span className="text-gray-300 text-xs">—</span>}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-gray-500">{project.activities.length}</td>
      <td className="px-4 py-2.5 text-right text-xs text-gray-500">{intHrs > 0 ? `${Math.round(intHrs)}h` : '—'}</td>
      <td className="px-4 py-2.5 text-right text-xs text-amber-600">{extHrs > 0 ? `${Math.round(extHrs)}h` : '—'}</td>
      <td className="px-4 py-2.5 text-right text-xs text-gray-500">{childCount}</td>
    </tr>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'type' | 'status' | 'programme' | 'owner'
type SortDir = 'asc' | 'desc'

export default function ManageProjects() {
  const store = useAppStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState<ViewMode>('board')
  const [drawerProjectId, setDrawerProjectId] = useState<string | null>(null)
  const [drawerDemandId, setDrawerDemandId] = useState<string | null>(null)
  const [submitDialogProjectId, setSubmitDialogProjectId] = useState<string | null>(null)
  const [dragError, setDragError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterProgramme, setFilterProgramme] = useState('')
  const [filterFunctions, setFilterFunctions] = useState<string[]>([])
  const [filterHasExternal, setFilterHasExternal] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // ─── Import state ──────────────────────────────────────────────────────────
  const [importResult, setImportResult] = useState<ParseResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeFunctionId = store.activeFunctionId

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Reset Function-scoped filters on Function switch
  const prevFnRef = useRef<string | null>(activeFunctionId)
  useEffect(() => {
    if (prevFnRef.current === activeFunctionId) return
    prevFnRef.current = activeFunctionId
    setFilterFunctions([])
  }, [activeFunctionId])

  // §4.6.A visibility rule
  const visibleProjects = useMemo(() => {
    return store.projects.filter(project => {
      if (!project.active) return false
      // Draft/Scoping always visible (pre-spawn)
      if (project.status === 'Draft' || project.status === 'Scoping') return true
      // Submitted+: visible only if active Function has a child Demand
      if (!activeFunctionId) return true
      return store.demandItems.some(d => d.parent_project_id === project.id && d.function_id === activeFunctionId)
    })
  }, [store.projects, store.demandItems, activeFunctionId])

  // Build a helper: getProjectFunctions for filtering
  const domFn = useMemo(() => new Map(store.domains.map(d => [d.id, d.functionId])), [store.domains])
  const sklFn = useMemo(() => new Map(store.skills.map(s => [s.id, domFn.get(s.domain_id)])), [store.skills, domFn])
  function getProjectFnIds(project: Project): Set<string> {
    const ids = new Set<string>()
    for (const activity of project.activities) {
      for (const req of activity.requirements) {
        const fnId = sklFn.get(req.skill_id)
        if (fnId) ids.add(fnId)
      }
    }
    for (const d of store.demandItems.filter(d => d.parent_project_id === project.id)) {
      if (d.function_id) ids.add(d.function_id)
    }
    return ids
  }

  // Check for external requirements
  const projectActivitySet = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of store.projects) {
      m.set(p.id, p.activities.map(ac => ac.id))
    }
    return m
  }, [store.projects])
  const extActivityIds = useMemo(() => new Set(store.externalResourceRequirements.map(r => r.activity_id)), [store.externalResourceRequirements])
  function projectHasExternal(project: Project): boolean {
    const activityIds = projectActivitySet.get(project.id) ?? []
    return activityIds.some(aid => extActivityIds.has(aid))
  }

  const filtered = useMemo(() => {
    let items = [...visibleProjects]
    if (filterStatus) items = items.filter(p => p.status === filterStatus)
    if (filterType) items = items.filter(p => p.type === filterType)
    if (filterProgramme) items = items.filter(p => p.programme_id === filterProgramme)
    if (filterFunctions.length > 0) {
      items = items.filter(p => {
        const fnIds = getProjectFnIds(p)
        return filterFunctions.some(fid => fnIds.has(fid))
      })
    }
    if (filterHasExternal) items = items.filter(p => projectHasExternal(p))
    if (search) {
      const q = search.toLowerCase()
      items = items.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.owner.toLowerCase().includes(q) ||
        p.activities.some(ac => ac.name.toLowerCase().includes(q)) ||
        (p.programme_id && store.programmes.find(pr => pr.id === p.programme_id)?.name.toLowerCase().includes(q))
      )
    }
    items.sort((a, b) => {
      let av = '', bv = ''
      const progA = a.programme_id ? store.programmes.find(pr => pr.id === a.programme_id)?.name ?? '' : ''
      const progB = b.programme_id ? store.programmes.find(pr => pr.id === b.programme_id)?.name ?? '' : ''
      if (sortKey === 'name') { av = a.name; bv = b.name }
      else if (sortKey === 'type') { av = a.type; bv = b.type }
      else if (sortKey === 'status') { av = a.status; bv = b.status }
      else if (sortKey === 'programme') { av = progA; bv = progB }
      else if (sortKey === 'owner') { av = a.owner; bv = b.owner }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return items
  }, [visibleProjects, filterStatus, filterType, filterProgramme, filterFunctions, filterHasExternal, search, sortKey, sortDir, store.programmes, store.demandItems])

  const horizon = useMemo(() => generateMonths(getCurrentMonth(), 12), [])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const projectId = active.id as string
    const newStatus = over.id as ProjectStatus
    const project = store.projects.find(p => p.id === projectId)
    if (!project || project.status === newStatus) return

    // Approved/Allocated: auto-only
    if (newStatus === 'Approved' || newStatus === 'Allocated') {
      setDragError(`"${project.name}" → ${newStatus}: this status is reached automatically when child Demands progress.`)
      setTimeout(() => setDragError(null), 4000)
      return
    }

    // Draft → Scoping: gated Submit for Scoping
    if (project.status === 'Draft' && newStatus === 'Scoping') {
      const err = store.submitProjectForScoping(projectId)
      if (err) {
        setDragError(err)
        setTimeout(() => setDragError(null), 5000)
      }
      return
    }

    // Scoping → Submitted: show confirmation dialog
    if (project.status === 'Scoping' && newStatus === 'Submitted') {
      setSubmitDialogProjectId(projectId)
      return
    }

    // Any other drag is invalid
    setDragError(`Cannot move "${project.name}" from ${project.status} to ${newStatus}.`)
    setTimeout(() => setDragError(null), 4000)
  }

  function handleConfirmSubmit() {
    if (!submitDialogProjectId) return
    const err = store.submitProject(submitDialogProjectId)
    if (err) {
      setDragError(err)
      setTimeout(() => setDragError(null), 5000)
    }
    setSubmitDialogProjectId(null)
  }

  // ─── Import handlers ───────────────────────────────────────────────────────

  async function handleDownloadTemplate() {
    try {
      const { downloadImportTemplate } = await import('../../lib/excelExport')
      await downloadImportTemplate(store)
    } catch (e) {
      setImportError('Failed to generate template. Please try again.')
      setTimeout(() => setImportError(null), 5000)
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset so same file can be re-selected
    e.target.value = ''
    try {
      const { parseImportWorkbook } = await import('../../lib/excelImport')
      const result = await parseImportWorkbook(file, store)
      setImportResult(result)
    } catch (err) {
      setImportError('Failed to parse workbook. Ensure the file is a valid .xlsx ImportTemplate.')
      setTimeout(() => setImportError(null), 6000)
    }
  }

  function handleImportCommit(projects: ParsedImportProject[]) {
    const domFn = new Map(store.domains.map(d => [d.id, d.functionId]))
    const sklFn = new Map(store.skills.map(sk => [sk.id, domFn.get(sk.domain_id) ?? '']))
    const fnNameMap = new Map(store.functions.map(f => [f.id, f.name]))

    // Helper: resolve function tag — same logic as store.resolveFunctionTag
    function resolveFnTag(fnTag: string, fnSet: Set<string>): string {
      if (fnTag) return fnTag
      const sorted = [...fnSet].sort((a, b) =>
        (fnNameMap.get(a) ?? a).localeCompare(fnNameMap.get(b) ?? b)
      )
      return sorted[0] ?? ''
    }

    const newProjects: import('../../types').Project[] = []
    const newDemands: import('../../types').DemandItem[] = []
    const newExternals: ExternalResourceRequirement[] = []

    for (const parsed of projects) {
      const projectId = generateId('prj')

      // Build Activity[] with generated IDs and inline requirements (hours_by_month: use steady-state placeholder)
      const projectActivities: Activity[] = parsed.activities.map(ac => {
        const activityId = generateId('phs')
        const reqs = parsed.internalReqs
          .filter(r => r.activityName === ac.name)
          .map(r => ({
            id: generateId('req'),
            shape: 'skill' as const,
            skill_id: r.skillId,
            level: r.level as import('../../types').Level,
            hours_by_month: {},
            steady_state_hours: r.hoursPerMonth,
            notes: r.notes || null,
            allocations: [],
          }))
        return {
          id: activityId,
          name: ac.name,
          start_month: ac.startMonth,
          end_month: ac.endMonth,
          funding_source: (ac.fundingSource as import('../../types').FundingSource) || 'Investment Scheme',
          funding_notes: ac.fundingNotes,
          requirements: reqs,
        }
      })

      // Compute functions actually involved from internalReqs
      const functionsInvolved = new Set<string>()
      for (const ir of parsed.internalReqs) {
        const fnId = sklFn.get(ir.skillId)
        if (fnId) functionsInvolved.add(fnId)
      }

      // Build project record
      const project: import('../../types').Project = {
        id: projectId,
        name: parsed.projectName,
        owner: parsed.owner,
        type: parsed.typeId,
        programme_id: parsed.programmeId,
        description: parsed.description,
        status: 'Submitted',
        activities: projectActivities,
        active: true,
        functions_required: [...functionsInvolved],
        functions_actually_involved: [...functionsInvolved],
        created_under_function_id: store.activeFunctionId,
      }
      newProjects.push(project)

      // Spawn Demands — one per function involved
      for (const fnId of functionsInvolved) {
        const fn = store.functions.find(f => f.id === fnId)

        // Filter project activities relevant to this function
        const relevantActivities = projectActivities.filter(ac =>
          ac.requirements.some(r => sklFn.get(r.skill_id) === fnId) ||
          parsed.externalReqs.some(er => er.activityName === ac.name && resolveFnTag(er.functionTag, functionsInvolved) === fnId)
        )
        if (relevantActivities.length === 0) continue

        // Clone activities for this demand (filter reqs to this function only)
        const cloneMap = new Map<string, string>() // origActivity.id → cloned activity.id
        const demandActivities: Activity[] = relevantActivities.map(origAc => {
          const clonedId = generateId('phs')
          cloneMap.set(origAc.id, clonedId)
          return {
            ...origAc,
            id: clonedId,
            requirements: origAc.requirements
              .filter(r => sklFn.get(r.skill_id) === fnId)
              .map(r => ({ ...r, id: generateId('req'), allocations: [] })),
          }
        })

        newDemands.push({
          id: generateId('dmd'),
          function_id: fnId,
          parent_project_id: projectId,
          name: `${parsed.projectName} — ${fn?.name ?? fnId}`,
          type: parsed.typeId,
          owner: parsed.owner,
          description: parsed.description,
          status: 'Submitted',
          activities: demandActivities,
        })

        // Route external requirements to cloned demand activities
        for (const [origAcId, clonedAcId] of cloneMap.entries()) {
          const origAc = projectActivities.find(ac => ac.id === origAcId)
          if (!origAc) continue
          const acExtReqs = parsed.externalReqs.filter(er =>
            er.activityName === origAc.name &&
            resolveFnTag(er.functionTag, functionsInvolved) === fnId
          )
          for (const er of acExtReqs) {
            newExternals.push({
              id: generateId('ext'),
              activity_id: clonedAcId,
              provider_id: er.providerId,
              role: er.role,
              notes: er.notes || null,
              hours_by_month: {},
              steady_state_hours: er.hoursPerMonth,
              function_tag: fnId,
            })
          }
        }
      }
    }

    // Atomic state update
    useAppStore.setState(s => ({
      projects: [...s.projects, ...newProjects],
      demandItems: [...s.demandItems, ...newDemands],
      externalResourceRequirements: [...s.externalResourceRequirements, ...newExternals],
    }))

    setImportResult(null)
    setImportSuccess(`Imported ${newProjects.length} project${newProjects.length !== 1 ? 's' : ''} and spawned ${newDemands.length} demand${newDemands.length !== 1 ? 's' : ''}.`)
    setTimeout(() => setImportSuccess(null), 6000)
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const SortIcon = ({ k }: { k: SortKey }) => sortKey !== k ? null : sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />

  const anyFilterActive = filterStatus || filterType || filterProgramme || filterFunctions.length > 0 || filterHasExternal

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
        <span className="text-sm font-semibold text-near-black">Manage Projects</span>
        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-0.5 border border-border rounded overflow-hidden">
          {([['board', <LayoutGrid size={13} />], ['table', <List size={13} />], ['search', <Search size={13} />]] as [ViewMode, React.ReactNode][]).map(([m, icon]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              title={m}
              className={clsx('px-2.5 py-1.5 flex items-center transition-colors', mode === m ? 'bg-near-black text-white' : 'text-gray-500 hover:bg-gray-100')}
            >
              {icon}
            </button>
          ))}
        </div>

        {mode !== 'search' && (
          <>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-white">
              <option value="">All Statuses</option>
              {PROJECT_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-white">
              <option value="">All Types</option>
              {store.projectTypes.filter(pt => pt.active).sort((a, b) => a.display_order - b.display_order).map(pt => (
                <option key={pt.id} value={pt.id}>{pt.name}</option>
              ))}
            </select>
            <select value={filterProgramme} onChange={e => setFilterProgramme(e.target.value)} className="text-xs border border-border rounded px-2 py-1 bg-white">
              <option value="">All Programmes</option>
              {store.programmes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {/* §4.6.A v1.19: Functions Actually Involved filter (Functions Required is not separately filterable) */}
            <select
              value={filterFunctions[0] ?? ''}
              onChange={e => setFilterFunctions(e.target.value ? [e.target.value] : [])}
              className="text-xs border border-border rounded px-2 py-1 bg-white"
              title="Functions Actually Involved — filters by which Functions a Project's requirements touch. Functions Required is planning metadata and is not a separate filter."
            >
              <option value="">Functions Actually Involved</option>
              {store.functions.filter(f => f.active).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={filterHasExternal} onChange={e => setFilterHasExternal(e.target.checked)} className="accent-brand" />
              Has external
            </label>
          </>
        )}

        {mode === 'search' && (
          <div className="flex items-center gap-2 flex-1">
            <Search size={14} className="text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects by name, description, owner, phase, programme..."
              className="flex-1 text-sm focus:outline-none border-none"
            />
          </div>
        )}

        <div className="flex-1" />

        {/* Import / Export actions */}
        <Button size="sm" variant="secondary" onClick={handleDownloadTemplate} title="Download Import Template (.xlsx)">
          <Download size={12} /> Template
        </Button>
        <Button size="sm" variant="secondary" onClick={handleImportClick} title="Import Projects from .xlsx">
          <Upload size={12} /> Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleFileChange}
        />

        <Button size="sm" variant="primary" onClick={() => navigate('/manage-projects/new')}>
          <Plus size={12} /> New Project
        </Button>
      </div>

      {/* Drag error banner */}
      {dragError && (
        <div className="flex items-center gap-2 px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          <span className="flex-1">{dragError}</span>
          <button onClick={() => setDragError(null)}><X size={12} /></button>
        </div>
      )}

      {/* Import error banner */}
      {importError && (
        <div className="flex items-center gap-2 px-5 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          <span className="flex-1">{importError}</span>
          <button onClick={() => setImportError(null)}><X size={12} /></button>
        </div>
      )}

      {/* Import success banner */}
      {importSuccess && (
        <div className="flex items-center gap-2 px-5 py-2 bg-green-50 border-b border-green-200 text-xs text-green-700">
          <span className="flex-1">{importSuccess}</span>
          <button onClick={() => setImportSuccess(null)}><X size={12} /></button>
        </div>
      )}

      {/* Board mode */}
      {mode === 'board' && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-x-auto p-4">
            <div className="flex gap-3 h-full min-h-[400px]">
              {PROJECT_STATUSES.map(status => {
                const colItems = filtered.filter(p => p.status === status)
                return (
                  <DroppableColumn key={status} status={status}>
                    <div className="flex items-center justify-between mb-1">
                      <ProjectStatusBadge status={status} />
                      <span className="text-xs text-gray-400">{colItems.length}</span>
                    </div>
                    {colItems.map(project => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onOpen={() => setDrawerProjectId(project.id)}
                      />
                    ))}
                    {colItems.length === 0 && (
                      <p className="text-xs text-gray-400 italic text-center pt-4">
                        {anyFilterActive ? 'No Projects match the current filters' : 'No Projects'}
                      </p>
                    )}
                  </DroppableColumn>
                )
              })}
            </div>
          </div>
        </DndContext>
      )}

      {/* Table mode */}
      {mode === 'table' && (
        <div className="flex-1 overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-border">
              <tr>
                {(['name', 'type', 'status', 'programme', 'owner'] as SortKey[]).map(k => (
                  <th
                    key={k}
                    onClick={() => handleSort(k)}
                    className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-pointer hover:text-near-black select-none"
                  >
                    <span className="flex items-center gap-1 capitalize">{k} <SortIcon k={k} /></span>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Functions Actually Involved</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Activities</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Int. hrs</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide">Ext. hrs</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Demands</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-400">
                    No projects found. <button className="text-brand underline" onClick={() => navigate('/manage-projects/new')}>Create one.</button>
                  </td>
                </tr>
              )}
              {filtered.map(project => (
                <ProjectTableRow
                  key={project.id}
                  project={project}
                  horizon={horizon}
                  onOpen={() => setDrawerProjectId(project.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Search mode */}
      {mode === 'search' && (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 gap-2 max-w-2xl">
            {search && filtered.length === 0 && (
              <p className="text-gray-400 text-sm">No results for "{search}"</p>
            )}
            {!search && <p className="text-gray-400 text-sm">Type to search projects.</p>}
            {filtered.map(project => {
              const programme = project.programme_id ? store.programmes.find(p => p.id === project.programme_id) : null
              const typeName = store.projectTypes.find(pt => pt.id === project.type)?.name ?? project.type
              return (
                <div
                  key={project.id}
                  onClick={() => setDrawerProjectId(project.id)}
                  className="border border-border rounded-md p-3 bg-white hover:border-border-hover cursor-pointer shadow-sm transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <ProjectStatusBadge status={project.status} />
                    <span className="text-sm font-medium text-near-black">{project.name}</span>
                  </div>
                  <div className="text-xs text-gray-500">{typeName} · {programme?.name ?? 'No Programme'}</div>
                  {project.description && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{project.description}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Submit Project confirmation dialog */}
      {submitDialogProjectId && (
        <SubmitProjectDialog
          projectId={submitDialogProjectId}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setSubmitDialogProjectId(null)}
        />
      )}

      {/* Import Preview modal */}
      {importResult && (
        <ImportPreview
          result={importResult}
          state={store}
          onConfirm={handleImportCommit}
          onCancel={() => setImportResult(null)}
        />
      )}

      {/* Project drawer */}
      {drawerProjectId && (
        <ProjectDrawer
          projectId={drawerProjectId}
          onClose={() => setDrawerProjectId(null)}
          onOpenDemand={(id) => { setDrawerProjectId(null); setDrawerDemandId(id) }}
        />
      )}

      {/* Demand drawer (opened from ProjectDrawer's child-demand links) */}
      {drawerDemandId && (
        <DemandDrawer
          demandId={drawerDemandId}
          onClose={() => setDrawerDemandId(null)}
        />
      )}
    </div>
  )
}
