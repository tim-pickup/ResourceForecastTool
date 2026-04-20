import { useState, useMemo } from 'react'
import { Plus, Trash2, AlertTriangle, Lock } from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../../store/useAppStore'
import type { AppState, DemandItem, SkillRequirement, NamedAllocation, Level, DemandStatus, Phase } from '../../types'
import { Button } from '../../components/ui/Button'
import { formatMonthLabel, getPersonAvgAvailableForPhase, monthInRange } from '../../utils/capacity'
import { generateId } from '../../utils/ids'
import { getMonths, PhaseGantt } from './ModeAEditor'

const LEVEL_ORDER: Record<Level, number> = { Basic: 0, Advanced: 1, Specialist: 2 }
function meetsLevel(held: Level, req: Level) { return LEVEL_ORDER[held] >= LEVEL_ORDER[req] }

const ALLOC_STATUSES = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])

// ─── Cross-row headroom calculation ──────────────────────────────────────────
// Section 4.5.2 Mode B formula:
//   contracted(P, M)
//   − persisted allocations for P in M from every demand item EXCEPT the one being edited
//   − in-session (draft) allocations for P in M from every alloc row EXCEPT excludeAllocId

interface HeadroomResult {
  contracted: number
  persistedOther: number
  pendingOther: number
  headroom: number
}

function computeHeadroom(
  personId: string,
  month: string,
  excludeAllocId: string,
  draft: Omit<DemandItem, 'id'>,
  demandItemId: string | undefined,
  state: AppState
): HeadroomResult {
  const person = state.people.find(p => p.id === personId)
  if (!person) return { contracted: 0, persistedOther: 0, pendingOther: 0, headroom: 0 }

  const contracted = monthInRange(month, person.available_from, person.available_to)
    ? person.contracted_hours_per_month : 0

  // Sum persisted allocations from demand items OTHER than the one being edited
  let persistedOther = 0
  for (const item of state.demandItems) {
    if (item.id === demandItemId) continue
    if (!ALLOC_STATUSES.has(item.status)) continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        for (const alloc of req.allocations) {
          if (alloc.person_id !== personId) continue
          persistedOther += phase.end_month === null
            ? (alloc.steady_state_hours ?? 0)
            : (alloc.hours_by_month[month] ?? 0)
        }
      }
    }
  }

  // Sum in-session (draft) allocations from every OTHER row on this page
  let pendingOther = 0
  for (const phase of draft.phases) {
    if (!monthInRange(month, phase.start_month, phase.end_month)) continue
    for (const req of phase.requirements) {
      for (const alloc of req.allocations) {
        if (alloc.id === excludeAllocId) continue  // exclude this row
        if (alloc.person_id !== personId) continue
        pendingOther += phase.end_month === null
          ? (alloc.steady_state_hours ?? 0)
          : (alloc.hours_by_month[month] ?? 0)
      }
    }
  }

  return {
    contracted,
    persistedOther,
    pendingOther,
    headroom: contracted - persistedOther - pendingOther,
  }
}

// ─── Coverage helpers ─────────────────────────────────────────────────────────

type CoverageStatus = 'full' | 'partial' | 'empty'
interface MonthCoverage { month: string; target: number; allocated: number; status: CoverageStatus }

function requirementCoverage(req: SkillRequirement, months: string[]): MonthCoverage[] {
  return months.map(m => {
    const target = req.hours_by_month[m] ?? 0
    const allocated = req.allocations.reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0)
    const status: CoverageStatus = target === 0
      ? 'full'
      : allocated >= target ? 'full' : allocated > 0 ? 'partial' : 'empty'
    return { month: m, target, allocated, status }
  })
}

function indefiniteCoverage(req: SkillRequirement): CoverageStatus {
  const target = req.steady_state_hours ?? 0
  const allocated = req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0)
  if (target === 0) return 'full'
  if (allocated >= target) return 'full'
  if (allocated > 0) return 'partial'
  return 'empty'
}

export function computeAutoStatus(draft: Omit<DemandItem, 'id'>): DemandStatus {
  const current = draft.status as DemandStatus
  if (!['Approved', 'PartiallyAllocated', 'Allocated'].includes(current)) return current

  let hasAnyAllocation = false
  let allFullyCovered = true

  for (const phase of draft.phases) {
    if (phase.end_month === null) {
      for (const req of phase.requirements) {
        const target = req.steady_state_hours ?? 0
        if (target === 0) continue
        const allocated = req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0)
        if (allocated > 0) hasAnyAllocation = true
        if (allocated < target) allFullyCovered = false
      }
    } else {
      const months = getMonths(phase.start_month, phase.end_month)
      for (const req of phase.requirements) {
        if (req.allocations.length > 0) hasAnyAllocation = true
        for (const m of months) {
          const target = req.hours_by_month[m] ?? 0
          if (target === 0) continue
          const allocated = req.allocations.reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0)
          if (allocated > 0) hasAnyAllocation = true
          if (allocated < target) allFullyCovered = false
        }
      }
    }
  }

  if (hasAnyAllocation && allFullyCovered) return 'Allocated'
  if (hasAnyAllocation) return 'PartiallyAllocated'
  return 'Approved'
}

// ─── Coverage strip ───────────────────────────────────────────────────────────

function CoverageStrip({ coverage, months }: { coverage: MonthCoverage[]; months: string[] }) {
  return (
    <div>
      <div className="flex gap-0.5 mb-1">
        {months.map(m => (
          <div key={m} className="flex-1 min-w-[20px] text-center">
            <span className="text-[9px] text-gray-400 whitespace-nowrap">{formatMonthLabel(m)}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-0.5">
        {coverage.map(({ month, target, allocated, status }) => (
          <div
            key={month}
            title={`${formatMonthLabel(month)}: ${allocated}/${target}h`}
            className={clsx(
              'h-2.5 rounded-sm flex-1 min-w-[20px]',
              status === 'full' ? 'bg-green-400' :
              status === 'partial' ? 'bg-amber-400' : 'bg-red-300'
            )}
          />
        ))}
      </div>
    </div>
  )
}

function IndefiniteCoverageCell({ status, target, allocated }: { status: CoverageStatus; target: number; allocated: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        title={`${allocated}/${target}h/mo`}
        className={clsx(
          'h-2.5 w-10 rounded-sm',
          status === 'full' ? 'bg-green-400' :
          status === 'partial' ? 'bg-amber-400' : 'bg-red-300'
        )}
      />
      <span className="text-[10px] text-gray-400">{allocated}/{target}h/mo</span>
    </div>
  )
}

// ─── Capacity preview cell ────────────────────────────────────────────────────

function CapacityCell({
  headroomResult,
  allocHours,
  month,
  personName,
}: {
  headroomResult: HeadroomResult
  allocHours: number
  month: string
  personName: string
}) {
  const { contracted, persistedOther, pendingOther, headroom } = headroomResult
  const afterAlloc = headroom - allocHours
  const usagePct = contracted > 0 ? (contracted - afterAlloc) / contracted : 0
  const color = afterAlloc < 0
    ? 'bg-red-100 text-red-700 border-red-200'
    : usagePct > 0.8
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-green-50 text-green-700 border-green-200'

  const parts = [`${contracted}h contracted`, `−${Math.round(persistedOther)}h other commitments`]
  if (pendingOther > 0) parts.push(`−${Math.round(pendingOther)}h pending this session`)
  parts.push(`= ${Math.round(headroom)}h available before this row`)
  const tooltip = `${personName}, ${formatMonthLabel(month)}: ${parts.join(' ')}`

  return (
    <div
      title={tooltip}
      className={clsx('w-14 text-[9px] font-medium text-center rounded border px-0.5 py-0.5', color)}
    >
      {afterAlloc}h
    </div>
  )
}

// ─── Allocation row ───────────────────────────────────────────────────────────

interface AllocationRowProps {
  alloc: NamedAllocation
  req: SkillRequirement
  phase: Phase
  months: string[]
  draft: Omit<DemandItem, 'id'>
  demandItemId: string | undefined
  onChange: (a: NamedAllocation) => void
  onDelete: () => void
}

function AllocationRow({ alloc, req, phase, months, draft, demandItemId, onChange, onDelete }: AllocationRowProps) {
  const store = useAppStore()
  const [showAll, setShowAll] = useState(false)
  const isIndefinite = phase.end_month === null

  const eligibleIds = new Set(
    store.people.filter(p => p.active && p.skills.some(ps => ps.skill_id === req.skill_id && meetsLevel(ps.level, req.level))).map(p => p.id)
  )
  const visiblePeople = showAll ? store.people.filter(p => p.active) : store.people.filter(p => p.active && (eligibleIds.has(p.id) || p.id === alloc.person_id))
  const warnSkillMatch = alloc.person_id && !eligibleIds.has(alloc.person_id)

  // Per-person capacity summary for picker (persisted + draft, but no single-row exclusion needed here)
  const personCapacitySummary = useMemo(() => {
    const map = new Map<string, number>()
    visiblePeople.forEach(p => {
      map.set(p.id, getPersonAvgAvailableForPhase(p.id, phase.start_month, phase.end_month, store))
    })
    return map
  }, [visiblePeople, phase.start_month, phase.end_month, store])

  const person = alloc.person_id ? store.people.find(p => p.id === alloc.person_id) : null
  const contracted = person?.contracted_hours_per_month ?? 0

  // Per-month headroom using the cross-row formula (excludes this allocation row)
  const headroomByMonth = useMemo(() => {
    if (!alloc.person_id) return new Map<string, HeadroomResult>()
    const m = new Map<string, HeadroomResult>()
    months.forEach(month => {
      m.set(month, computeHeadroom(alloc.person_id, month, alloc.id, draft, demandItemId, store))
    })
    return m
  }, [alloc.person_id, alloc.id, months, draft, demandItemId, store])

  const setMonth = (m: string, rawVal: number) => {
    const target = req.hours_by_month[m] ?? 0
    const othersAllocated = req.allocations
      .filter(a => a.id !== alloc.id)
      .reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0)
    const headroom = Math.max(0, target - othersAllocated)
    const val = Math.min(Math.max(0, rawVal), headroom)
    onChange({ ...alloc, hours_by_month: { ...alloc.hours_by_month, [m]: val } })
  }

  const rowTotal = months.reduce((s, m) => s + (alloc.hours_by_month[m] ?? 0), 0)

  const handleFillRemaining = () => {
    if (isIndefinite) {
      const target = req.steady_state_hours ?? 0
      const othersAllocated = req.allocations
        .filter(a => a.id !== alloc.id)
        .reduce((s, a) => s + (a.steady_state_hours ?? 0), 0)
      onChange({ ...alloc, steady_state_hours: Math.max(0, target - othersAllocated) })
    } else {
      const hbm: Record<string, number> = {}
      months.forEach(m => {
        const target = req.hours_by_month[m] ?? 0
        const othersAllocated = req.allocations.filter(a => a.id !== alloc.id).reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0)
        hbm[m] = Math.max(0, target - othersAllocated)
      })
      onChange({ ...alloc, hours_by_month: hbm })
    }
  }

  return (
    <div className="border border-border/60 rounded bg-white p-2 flex flex-col gap-1.5">
      {/* Person picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={alloc.person_id}
          onChange={e => onChange({ ...alloc, person_id: e.target.value })}
          className={clsx(
            'flex-1 min-w-[140px] text-xs border rounded px-1.5 py-1 bg-white',
            warnSkillMatch ? 'border-amber-300' : 'border-border'
          )}
        >
          <option value="">Select person…</option>
          {visiblePeople.map(p => {
            const avgCap = personCapacitySummary.get(p.id) ?? 0
            return (
              <option key={p.id} value={p.id}>
                {p.name} — avg {avgCap}h/mo avail{!eligibleIds.has(p.id) ? ' ⚠' : ''}
              </option>
            )
          })}
        </select>
        {!showAll && (
          <button onClick={() => setShowAll(true)} className="text-[10px] text-gray-400 hover:text-brand underline whitespace-nowrap">
            Show all
          </button>
        )}
        {warnSkillMatch && (
          <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
            <AlertTriangle size={10} /> Skill mismatch
          </span>
        )}
        <button onClick={onDelete} className="text-gray-300 hover:text-accent-red ml-auto shrink-0">
          <Trash2 size={12} />
        </button>
      </div>

      {/* Indefinite: single steady-state input */}
      {isIndefinite ? (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">h/mo:</span>
          <input
            type="number"
            value={alloc.steady_state_hours ?? 0}
            onChange={e => onChange({ ...alloc, steady_state_hours: Math.max(0, Number(e.target.value)) })}
            className="w-20 text-xs border border-border rounded px-1 py-1 text-right bg-white"
            min={0}
          />
          {alloc.person_id && (() => {
            const h = computeHeadroom(alloc.person_id, phase.start_month, alloc.id, draft, demandItemId, store)
            const hrs = alloc.steady_state_hours ?? 0
            const afterAlloc = h.headroom - hrs
            const usagePct = contracted > 0 ? (contracted - afterAlloc) / contracted : 0
            const color = afterAlloc < 0 ? 'text-red-600' : usagePct > 0.8 ? 'text-amber-600' : 'text-green-600'
            return <span className={clsx('text-[10px] font-medium', color)}>{afterAlloc}h remaining</span>
          })()}
        </div>
      ) : (
        /* Finite: per-month capacity preview + hours grid */
        months.length > 0 && (
          <div className="overflow-x-auto">
            <div className="flex flex-col gap-1 min-w-max">
              {/* Capacity preview strip */}
              {alloc.person_id && (
                <div className="flex items-end gap-1">
                  <span className="text-[9px] text-gray-400 w-14 text-right pr-1 shrink-0">headroom</span>
                  {months.map(m => (
                    <CapacityCell
                      key={m}
                      headroomResult={headroomByMonth.get(m) ?? { contracted: 0, persistedOther: 0, pendingOther: 0, headroom: 0 }}
                      allocHours={alloc.hours_by_month[m] ?? 0}
                      month={m}
                      personName={person?.name ?? ''}
                    />
                  ))}
                </div>
              )}
              {/* Hours inputs */}
              <div className="flex items-end gap-1">
                <span className="text-[9px] text-gray-400 w-14 text-right pr-1 shrink-0">hours</span>
                {months.map(m => (
                  <div key={m} className="flex flex-col items-center">
                    <span className="text-[10px] text-gray-400 mb-0.5 whitespace-nowrap">{formatMonthLabel(m)}</span>
                    <input
                      type="number"
                      value={alloc.hours_by_month[m] ?? 0}
                      onChange={e => setMonth(m, Number(e.target.value))}
                      className="w-14 text-xs border border-border rounded px-1 py-1 text-right bg-white"
                      min={0}
                    />
                  </div>
                ))}
                <div className="flex flex-col items-center ml-1">
                  <span className="text-[10px] text-gray-400 mb-0.5">Total</span>
                  <span className="text-xs font-medium px-1 py-1">{Math.round(rowTotal)}h</span>
                </div>
              </div>
            </div>
          </div>
        )
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleFillRemaining} className="text-[10px] text-brand hover:text-brand-hover font-medium">
          Fill remaining
        </button>
        <input
          type="text"
          value={alloc.notes ?? ''}
          onChange={e => onChange({ ...alloc, notes: e.target.value || null })}
          placeholder="Notes"
          className="text-[10px] border border-border rounded px-1.5 py-0.5 bg-white flex-1 min-w-[80px]"
        />
      </div>
    </div>
  )
}

// ─── Per-requirement allocation block ─────────────────────────────────────────

interface ReqBlockProps {
  req: SkillRequirement
  phase: Phase
  months: string[]
  draft: Omit<DemandItem, 'id'>
  demandItemId: string | undefined
  onChange: (r: SkillRequirement) => void
}

function RequirementAllocationBlock({ req, phase, months, draft, demandItemId, onChange }: ReqBlockProps) {
  const { skills, themes } = useAppStore()
  const isIndefinite = phase.end_month === null

  const skill = skills.find(s => s.id === req.skill_id)
  const theme = skill ? themes.find(t => t.id === skill.theme_id) : null

  const coverage = isIndefinite ? null : requirementCoverage(req, months)
  const indCovStatus = isIndefinite ? indefiniteCoverage(req) : null

  const targetTotal = isIndefinite
    ? (req.steady_state_hours ?? 0)
    : months.reduce((s, m) => s + (req.hours_by_month[m] ?? 0), 0)
  const allocTotal = isIndefinite
    ? req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0)
    : req.allocations.reduce((s, a) => s + months.reduce((ss, m) => ss + (a.hours_by_month[m] ?? 0), 0), 0)

  const updateAlloc = (allocId: string, a: NamedAllocation) =>
    onChange({ ...req, allocations: req.allocations.map(x => x.id === allocId ? a : x) })
  const deleteAlloc = (allocId: string) =>
    onChange({ ...req, allocations: req.allocations.filter(x => x.id !== allocId) })
  const addAlloc = () => {
    if (isIndefinite) {
      onChange({ ...req, allocations: [...req.allocations, { id: generateId('alloc'), person_id: '', hours_by_month: {}, steady_state_hours: 0, notes: null }] })
    } else {
      const hbm: Record<string, number> = {}
      months.forEach(m => { hbm[m] = 0 })
      onChange({ ...req, allocations: [...req.allocations, { id: generateId('alloc'), person_id: '', hours_by_month: hbm, steady_state_hours: null, notes: null }] })
    }
  }

  return (
    <div className="border border-border rounded overflow-hidden">
      {/* Requirement header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
        <div className="flex-1 flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{theme?.name} ›</span>
          <span className="text-xs font-medium">{skill?.name ?? req.skill_id}</span>
          <span className="text-[10px] text-gray-500">· {req.level}</span>
        </div>
        <div className="text-xs text-gray-500">
          <span className={clsx(allocTotal > targetTotal ? 'text-accent-red' : allocTotal === targetTotal && targetTotal > 0 ? 'text-green-600' : '')}>
            {Math.round(allocTotal)}
          </span>
          <span className="text-gray-300"> / </span>
          <span>{Math.round(targetTotal)}{isIndefinite ? 'h/mo' : 'h'}</span>
        </div>
        {req.notes && <span className="text-[10px] text-gray-400 italic truncate max-w-[120px]">{req.notes}</span>}
      </div>

      <div className="px-3 py-2 flex flex-col gap-2">
        {/* Coverage */}
        <div>
          <span className="text-[10px] text-gray-400 mb-1 block">Coverage</span>
          {isIndefinite && indCovStatus !== null ? (
            <IndefiniteCoverageCell status={indCovStatus} target={req.steady_state_hours ?? 0} allocated={allocTotal} />
          ) : coverage ? (
            <CoverageStrip coverage={coverage} months={months} />
          ) : null}
        </div>

        {/* Allocation rows */}
        {req.allocations.map(alloc => (
          <AllocationRow
            key={alloc.id}
            alloc={alloc}
            req={req}
            phase={phase}
            months={months}
            draft={draft}
            demandItemId={demandItemId}
            onChange={a => updateAlloc(alloc.id, a)}
            onDelete={() => deleteAlloc(alloc.id)}
          />
        ))}

        <button
          onClick={addAlloc}
          className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover self-start"
        >
          <Plus size={11} /> Add allocation
        </button>
      </div>
    </div>
  )
}

// ─── Main allocation workspace ────────────────────────────────────────────────

interface Props {
  draft: Omit<DemandItem, 'id'>
  demandItemId?: string
  onChange: (d: Omit<DemandItem, 'id'>) => void
  onParkToRevise: () => void
  onRevise?: () => void
}

export function AllocationWorkspace({ draft, demandItemId, onChange, onParkToRevise, onRevise }: Props) {
  const store = useAppStore()
  const { themes } = store
  const theme = themes.find(t => t.id === draft.primary_theme_id)
  const project = draft.project_id ? store.projects.find(p => p.id === draft.project_id) : null
  const programme = project ? store.programmes.find(p => p.id === project.programme_id) : null

  const { totalReqMonths, coveredMonths } = useMemo(() => {
    let total = 0; let covered = 0
    for (const phase of draft.phases) {
      if (phase.end_month === null) {
        for (const req of phase.requirements) {
          const target = req.steady_state_hours ?? 0
          if (target === 0) continue
          total++
          const allocated = req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0)
          if (allocated >= target) covered++
        }
      } else {
        for (const req of phase.requirements) {
          for (const [m, target] of Object.entries(req.hours_by_month)) {
            if (target === 0) continue
            total++
            const allocated = req.allocations.reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0)
            if (allocated >= target) covered++
          }
        }
      }
    }
    return { totalReqMonths: total, coveredMonths: covered }
  }, [draft])

  const pct = totalReqMonths > 0 ? Math.round((coveredMonths / totalReqMonths) * 100) : 0
  const unfilledMonths = totalReqMonths - coveredMonths

  const updateReq = (phaseId: string, reqId: string, req: SkillRequirement) =>
    onChange({
      ...draft,
      phases: draft.phases.map(p => p.id === phaseId
        ? { ...p, requirements: p.requirements.map(r => r.id === reqId ? req : r) }
        : p
      ),
    })

  return (
    <div className="flex flex-col gap-4">
      {/* Read-only demand summary */}
      <div className="bg-gray-50 border border-border rounded p-3 text-xs flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-near-black">{draft.name}</span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500">{draft.type}</span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500">{theme?.name}</span>
          {draft.owner && <><span className="text-gray-400">·</span><span className="text-gray-500">{draft.owner}</span></>}
        </div>
        {/* Project alignment — editable even in Mode B (§2.1.1 explicit exception) */}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-gray-400">Project:</span>
          <select
            value={draft.project_id ?? ''}
            onChange={e => onChange({ ...draft, project_id: e.target.value || null })}
            className="text-xs border border-border rounded px-1.5 py-0.5 bg-white"
          >
            <option value="">Unaligned</option>
            {store.programmes.filter(p => p.active).map(prog => (
              <optgroup key={prog.id} label={prog.name}>
                {store.projects.filter(p => p.programme_id === prog.id && p.active).map(proj => (
                  <option key={proj.id} value={proj.id}>{proj.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {programme && project && (
            <span className="text-gray-400">{programme.name} › {project.name}</span>
          )}
        </div>
        <div className="text-gray-400 text-[10px]">
          {draft.phases.length} phase{draft.phases.length !== 1 ? 's' : ''} · {draft.phases.map((p, i) => {
            const label = p.end_month === null ? `${p.start_month} onwards` : `${p.start_month}–${p.end_month}`
            return `${p.name || `Phase ${i + 1}`} (${label})`
          }).join(', ')}
        </div>
      </div>

      {/* Coverage summary */}
      <div className="flex items-center gap-3 bg-white border border-border rounded p-2.5">
        <div className="flex-1">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all', pct === 100 ? 'bg-green-400' : pct > 0 ? 'bg-amber-400' : 'bg-gray-200')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <span className="text-xs font-medium text-near-black whitespace-nowrap">{pct}% allocated</span>
        {unfilledMonths > 0 && (
          <span className="text-xs text-gray-400">{unfilledMonths} unfilled req-month{unfilledMonths !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Read-only phase Gantt — §4.5.2 Mode B, above the lock banner */}
      {draft.phases.some(p => p.start_month) && (
        <PhaseGantt
          phases={draft.phases}
          readOnly
          onClickPhase={phaseId => {
            document.getElementById(`phase-${phaseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        />
      )}

      {/* Lock banner */}
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-700">
        <Lock size={12} className="shrink-0" />
        <span className="flex-1">Demand definition is locked.
          {draft.status === 'Approved'
            ? ' Use Revise to return to Submitted and edit phases or requirements (allocations preserved).'
            : ' To edit phases or requirements, park and revive this item.'
          }
        </span>
        {draft.status === 'Approved' && onRevise ? (
          <Button size="sm" variant="secondary" onClick={onRevise}>Revise</Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onParkToRevise}>Park &amp; Revise</Button>
        )}
      </div>

      {/* Phase cards */}
      {draft.phases.map((phase, phaseIdx) => {
        const months = phase.end_month === null ? [] : getMonths(phase.start_month, phase.end_month)
        const isIndefinite = phase.end_month === null
        const dateLabel = isIndefinite
          ? `${phase.start_month} onwards`
          : `${phase.start_month}–${phase.end_month}`

        return (
          <div key={phase.id} id={`phase-${phase.id}`} className="border-2 border-border rounded-lg overflow-hidden bg-white">
            <div className="px-4 py-3 bg-gray-100 border-b border-border">
              <h3 className="text-sm font-semibold text-near-black">
                Phase {phaseIdx + 1}{phase.name ? ` · ${phase.name}` : ''} · <span className="font-normal text-gray-500">{dateLabel}</span>
              </h3>
            </div>
            <div className="px-4 py-3 flex flex-col gap-3">
              {phase.requirements.length === 0 && (
                <p className="text-xs text-gray-400 italic">No requirements in this phase.</p>
              )}
              {phase.requirements.map(req => (
                <RequirementAllocationBlock
                  key={req.id}
                  req={req}
                  phase={phase}
                  months={months}
                  draft={draft}
                  demandItemId={demandItemId}
                  onChange={r => updateReq(phase.id, req.id, r)}
                />
              ))}
              {/* External requirements — read-only in Mode B */}
              {(() => {
                const extReqs = store.externalResourceRequirements.filter(r => r.phase_id === phase.id)
                if (extReqs.length === 0) return null
                return (
                  <div className="mt-1 border-t border-dashed border-amber-200 pt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 block mb-1.5">
                      External Resource Requirements (read-only)
                    </span>
                    {extReqs.map(ext => {
                      const prov = store.providers.find(p => p.id === ext.provider_id)
                      const hrsLabel = isIndefinite
                        ? `${ext.steady_state_hours ?? 0}h/mo steady`
                        : (() => {
                          const entries = Object.entries(ext.hours_by_month)
                          if (entries.length === 0) return '—'
                          const total = entries.reduce((s, [, h]) => s + h, 0)
                          const first = entries[0][0]; const last = entries[entries.length - 1][0]
                          return `${total}h total (${first}–${last})`
                        })()
                      return (
                        <div key={ext.id} className="flex items-center gap-2 text-xs py-0.5">
                          <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium shrink-0">{prov?.name ?? 'Unknown'}</span>
                          <span className="text-gray-700 flex-1">{ext.role}</span>
                          <span className="text-amber-600 text-[10px]">{hrsLabel}</span>
                        </div>
                      )
                    })}
                    <p className="text-[10px] text-amber-500 italic mt-1">To edit external requirements, use Park &amp; Revise or Revise (from Approved).</p>
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })}
    </div>
  )
}
