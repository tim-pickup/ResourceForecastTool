/**
 * excelImport.ts — §6.1 Import parser + types (Change 9)
 *
 * Parses a user-uploaded .xlsx workbook that matches the Import Template.
 * Resolves all references against current AppState, performs cross-tab
 * integrity checks, and returns a ParseResult with errors, warnings, and
 * fully-resolved project records ready for store commit.
 */

import type { AppState } from '../types'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ImportError {
  tab: string
  row: number
  column?: string
  message: string
}

export interface ImportWarning {
  tab: string
  row: number
  message: string
}

export interface ParsedImportActivity {
  name: string
  startMonth: string
  endMonth: string | null
  fundingSource: string
  fundingNotes: string
}

export interface ParsedImportIntReq {
  activityName: string
  skillId: string    // resolved Skill.id
  level: string
  hoursPerMonth: number
  notes: string
}

export interface ParsedImportExtReq {
  activityName: string
  providerId: string   // resolved Provider.id
  role: string
  functionTag: string  // resolved Function.id (from function_tag name)
  hoursPerMonth: number
  notes: string
}

export interface ParsedImportProject {
  projectName: string
  programmeId: string | null
  typeId: string           // resolved ProjectType.id
  owner: string
  description: string
  activities: ParsedImportActivity[]
  internalReqs: ParsedImportIntReq[]
  externalReqs: ParsedImportExtReq[]
}

export interface ParseResult {
  errors: ImportError[]
  warnings: ImportWarning[]
  projects: ParsedImportProject[]
}

// ─── Levenshtein distance ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1]
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function didYouMean(value: string, candidates: string[]): string | null {
  let best: string | null = null
  let bestDist = 3 // only consider ≤ 2
  for (const c of candidates) {
    const d = levenshtein(value.toLowerCase(), c.toLowerCase())
    if (d < bestDist) { bestDist = d; best = c }
  }
  return best
}

// ─── Cell reading helpers ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellStr(cell: any): string {
  if (cell === undefined || cell === null) return ''
  if (typeof cell === 'object' && 'result' in cell) return cellStr(cell.result)
  if (typeof cell === 'object' && 'text' in cell) return String(cell.text).trim()
  return String(cell).trim()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellNum(cell: any): number | null {
  const s = cellStr(cell)
  if (s === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function isBlankRow(values: unknown[]): boolean {
  return values.every(v => v === undefined || v === null || String(v).trim() === '')
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// ─── Main parser ─────────────────────────────────────────────────────────────

export async function parseImportWorkbook(file: File, state: AppState): Promise<ParseResult> {
  const ExcelJS = (await import('exceljs')).default

  const errors: ImportError[] = []
  const warnings: ImportWarning[] = []

  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)

  // ─── Step 1: Workbook structure check ──────────────────────────────────────

  const REQUIRED_TABS = ['Projects', 'Activities', 'Internal Requirements', 'External Requirements']
  for (const tab of REQUIRED_TABS) {
    if (!wb.getWorksheet(tab)) {
      if (tab === 'Activities' && wb.getWorksheet('Phases')) {
        errors.push({ tab: '__workbook__', row: 0, message: "This file uses the v1.19 template (tab 'Phases'). Please download the latest template — Phases have been renamed to Activities." })
      } else {
        errors.push({ tab: '__workbook__', row: 0, message: `This file does not match the import template. Tab '${tab}' is missing.` })
      }
    }
  }
  if (errors.length > 0) {
    return { errors, warnings, projects: [] }
  }

  const wsProjects = wb.getWorksheet('Projects')!
  const wsActivities = wb.getWorksheet('Activities')!
  const wsInt = wb.getWorksheet('Internal Requirements')!
  const wsExt = wb.getWorksheet('External Requirements')!

  // ─── Step 2: Build reference lookup maps from state ────────────────────────

  const progByName = new Map(state.programmes.filter(p => p.active).map(p => [p.name.toLowerCase(), p]))
  const typeByName = new Map(state.projectTypes.filter(pt => pt.active).map(pt => [pt.name, pt]))  // CASE-SENSITIVE
  const fnByName   = new Map(state.functions.filter(f => f.active).map(f => [f.name.toLowerCase(), f]))
  const provByName = new Map(state.providers.map(p => [p.name.toLowerCase(), p]))

  const domFnMap   = new Map(state.domains.map(d => [d.id, d.functionId]))
  const domNameMap = new Map(state.domains.map(d => [d.id, d.name]))
  const fnNameMap  = new Map(state.functions.map(f => [f.id, f.name]))

  // Build skill lookup: (fnName + domName + skillName) → skill
  type SkillKey = string
  const skillLookup = new Map<SkillKey, typeof state.skills[0]>()
  for (const sk of state.skills) {
    const domFnId = domFnMap.get(sk.domain_id)
    const fnName  = domFnId ? (fnNameMap.get(domFnId) ?? '').toLowerCase() : ''
    const domName = (domNameMap.get(sk.domain_id) ?? '').toLowerCase()
    const key: SkillKey = `${fnName}||${domName}||${sk.name.toLowerCase()}`
    skillLookup.set(key, sk)
  }

  // ─── Step 3: Parse Projects tab ────────────────────────────────────────────

  interface RawProject {
    rowNum: number
    projectName: string
    programmeName: string
    projectType: string
    owner: string
    description: string
  }
  const rawProjects: RawProject[] = []

  wsProjects.eachRow((row, rowNum) => {
    if (rowNum === 1) return // header
    const vals = row.values as unknown[]
    // ExcelJS rows are 1-indexed and vals[0] is always undefined
    if (isBlankRow(vals.slice(1))) return

    const projectName  = cellStr(vals[1])
    const programmeName = cellStr(vals[2])
    const projectType  = cellStr(vals[3])
    const owner        = cellStr(vals[4])
    const description  = cellStr(vals[5])

    if (!projectName) {
      errors.push({ tab: 'Projects', row: rowNum, column: 'project_name', message: 'project_name is required.' })
      return
    }
    if (!projectType) {
      errors.push({ tab: 'Projects', row: rowNum, column: 'project_type', message: 'project_type is required.' })
    }

    rawProjects.push({ rowNum, projectName, programmeName, projectType, owner, description })
  })

  // Project name uniqueness within file
  const projNameCounts = new Map<string, number>()
  for (const rp of rawProjects) {
    projNameCounts.set(rp.projectName, (projNameCounts.get(rp.projectName) ?? 0) + 1)
  }
  for (const rp of rawProjects) {
    if ((projNameCounts.get(rp.projectName) ?? 0) > 1) {
      errors.push({ tab: 'Projects', row: rp.rowNum, column: 'project_name', message: `Duplicate project_name "${rp.projectName}" in file. Each project must appear only once.` })
    }
  }

  // ─── Step 4: Parse Activities tab ──────────────────────────────────────────

  interface RawActivity {
    rowNum: number
    projectName: string
    activityName: string
    startMonth: string
    endMonth: string
    fundingSource: string
    fundingNotes: string
  }
  const rawActivities: RawActivity[] = []

  wsActivities.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const vals = row.values as unknown[]
    if (isBlankRow(vals.slice(1))) return

    const projectName    = cellStr(vals[1])
    const activityName   = cellStr(vals[2])
    const startMonth     = cellStr(vals[3])
    const endMonth       = cellStr(vals[4])
    const fundingSource  = cellStr(vals[5])
    const fundingNotes   = cellStr(vals[6])

    if (!projectName)   { errors.push({ tab: 'Activities', row: rowNum, column: 'project_name',  message: 'project_name is required.' }); return }
    if (!activityName)  { errors.push({ tab: 'Activities', row: rowNum, column: 'activity_name', message: 'activity_name is required.' }); return }
    if (!startMonth)    { errors.push({ tab: 'Activities', row: rowNum, column: 'activity_start_month', message: 'activity_start_month is required.' }) }
    else if (!MONTH_RE.test(startMonth)) { errors.push({ tab: 'Activities', row: rowNum, column: 'activity_start_month', message: `activity_start_month "${startMonth}" must be YYYY-MM format.` }) }
    if (endMonth && !MONTH_RE.test(endMonth)) { errors.push({ tab: 'Activities', row: rowNum, column: 'activity_end_month', message: `activity_end_month "${endMonth}" must be YYYY-MM format.` }) }

    rawActivities.push({ rowNum, projectName, activityName, startMonth, endMonth, fundingSource, fundingNotes })
  })

  // Cross-tab: activity project_name must exist in Projects
  const projectNamesInFile = new Set(rawProjects.map(p => p.projectName))
  for (const ac of rawActivities) {
    if (!projectNamesInFile.has(ac.projectName)) {
      errors.push({ tab: 'Activities', row: ac.rowNum, column: 'project_name', message: `project_name "${ac.projectName}" not found in Projects tab.` })
    }
  }

  // Activity uniqueness within project
  const activityKey = (projName: string, activityName: string) => `${projName}||${activityName}`
  const activityCounts = new Map<string, number>()
  for (const ac of rawActivities) {
    const k = activityKey(ac.projectName, ac.activityName)
    activityCounts.set(k, (activityCounts.get(k) ?? 0) + 1)
  }
  for (const ac of rawActivities) {
    const k = activityKey(ac.projectName, ac.activityName)
    if ((activityCounts.get(k) ?? 0) > 1) {
      errors.push({ tab: 'Activities', row: ac.rowNum, column: 'activity_name', message: `Duplicate activity_name "${ac.activityName}" within project "${ac.projectName}".` })
    }
  }

  // Build set of valid (project, activity) pairs
  const validActivityPairs = new Set(rawActivities.map(ac => activityKey(ac.projectName, ac.activityName)))

  // ─── Step 5: Parse Internal Requirements tab ───────────────────────────────

  interface RawIntReq {
    rowNum: number
    projectName: string
    activityName: string
    skillFunction: string
    skillDomain: string
    skillName: string
    level: string
    hoursPerMonth: number
    notes: string
    resolvedSkillId?: string
  }
  const rawIntReqs: RawIntReq[] = []

  wsInt.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const vals = row.values as unknown[]
    if (isBlankRow(vals.slice(1))) return

    const projectName    = cellStr(vals[1])
    const activityName   = cellStr(vals[2])
    const skillFunction  = cellStr(vals[3])
    const skillDomain    = cellStr(vals[4])
    const skillName      = cellStr(vals[5])
    const level          = cellStr(vals[6])
    const hoursRaw       = cellNum(vals[7])
    const notes          = cellStr(vals[8])

    if (!projectName)  { errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'project_name',  message: 'project_name is required.' }); return }
    if (!activityName) { errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'activity_name', message: 'activity_name is required.' }); return }

    if (!projectNamesInFile.has(projectName)) {
      errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'project_name', message: `project_name "${projectName}" not found in Projects tab.` })
    }
    if (!validActivityPairs.has(activityKey(projectName, activityName))) {
      errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'activity_name', message: `Activity "${activityName}" not found for project "${projectName}" in Activities tab.` })
    }
    if (!skillName) { errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'skill_name', message: 'skill_name is required.' }) }
    if (!level) { errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'level', message: 'level is required.' }) }
    else if (!['Basic', 'Advanced', 'Specialist'].includes(level)) {
      errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'level', message: `level "${level}" is invalid. Must be Basic, Advanced, or Specialist.` })
    }

    const hoursPerMonth = hoursRaw ?? 0
    if (hoursRaw === null) { errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'hours_per_month', message: 'hours_per_month is required and must be a number.' }) }
    if (hoursPerMonth > 200) { warnings.push({ tab: 'Internal Requirements', row: rowNum, message: `hours_per_month ${hoursPerMonth} is unusually high (>200 hrs/month).` }) }

    // Skill resolution
    const lookupKey = `${skillFunction.toLowerCase()}||${skillDomain.toLowerCase()}||${skillName.toLowerCase()}`
    const resolvedSkill = skillLookup.get(lookupKey)
    if (!resolvedSkill && skillName) {
      errors.push({ tab: 'Internal Requirements', row: rowNum, column: 'skill_name', message: `Skill "${skillFunction} / ${skillDomain} / ${skillName}" not found in reference data.` })
    }

    rawIntReqs.push({ rowNum, projectName, activityName, skillFunction, skillDomain, skillName, level, hoursPerMonth, notes, resolvedSkillId: resolvedSkill?.id })
  })

  // ─── Step 6: Parse External Requirements tab ───────────────────────────────

  interface RawExtReq {
    rowNum: number
    projectName: string
    activityName: string
    provider: string
    role: string
    functionTag: string
    hoursPerMonth: number
    notes: string
    resolvedProviderId?: string
    resolvedFunctionId?: string
  }
  const rawExtReqs: RawExtReq[] = []

  wsExt.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const vals = row.values as unknown[]
    if (isBlankRow(vals.slice(1))) return

    const projectName   = cellStr(vals[1])
    const activityName  = cellStr(vals[2])
    const provider      = cellStr(vals[3])
    const role          = cellStr(vals[4])
    const functionTag   = cellStr(vals[5])
    const hoursRaw      = cellNum(vals[6])
    const notes         = cellStr(vals[7])

    if (!projectName)  { errors.push({ tab: 'External Requirements', row: rowNum, column: 'project_name',  message: 'project_name is required.' }); return }
    if (!activityName) { errors.push({ tab: 'External Requirements', row: rowNum, column: 'activity_name', message: 'activity_name is required.' }); return }

    if (!projectNamesInFile.has(projectName)) {
      errors.push({ tab: 'External Requirements', row: rowNum, column: 'project_name', message: `project_name "${projectName}" not found in Projects tab.` })
    }
    if (!validActivityPairs.has(activityKey(projectName, activityName))) {
      errors.push({ tab: 'External Requirements', row: rowNum, column: 'activity_name', message: `Activity "${activityName}" not found for project "${projectName}" in Activities tab.` })
    }

    const hoursPerMonth = hoursRaw ?? 0
    if (hoursRaw === null) { errors.push({ tab: 'External Requirements', row: rowNum, column: 'hours_per_month', message: 'hours_per_month is required and must be a number.' }) }
    if (hoursPerMonth > 200) { warnings.push({ tab: 'External Requirements', row: rowNum, message: `hours_per_month ${hoursPerMonth} is unusually high (>200 hrs/month).` }) }

    // Provider resolution
    let resolvedProviderId: string | undefined
    if (!provider) {
      errors.push({ tab: 'External Requirements', row: rowNum, column: 'provider', message: 'provider is required.' })
    } else {
      const prov = provByName.get(provider.toLowerCase())
      if (!prov) {
        const suggest = didYouMean(provider, [...state.providers.map(p => p.name)])
        const hint = suggest ? ` Did you mean "${suggest}"?` : ''
        errors.push({ tab: 'External Requirements', row: rowNum, column: 'provider', message: `Provider "${provider}" not found in reference data.${hint}` })
      } else {
        resolvedProviderId = prov.id
      }
    }

    // Function tag resolution (match by function name, case-insensitive)
    let resolvedFunctionId: string | undefined
    if (!functionTag) {
      errors.push({ tab: 'External Requirements', row: rowNum, column: 'function_tag', message: 'function_tag is required.' })
    } else {
      const fn = fnByName.get(functionTag.toLowerCase())
      if (!fn) {
        const suggest = didYouMean(functionTag, [...state.functions.filter(f => f.active).map(f => f.name)])
        const hint = suggest ? ` Did you mean "${suggest}"?` : ''
        errors.push({ tab: 'External Requirements', row: rowNum, column: 'function_tag', message: `Function "${functionTag}" not found in reference data.${hint}` })
      } else {
        resolvedFunctionId = fn.id
      }
    }

    rawExtReqs.push({ rowNum, projectName, activityName, provider, role, functionTag, hoursPerMonth, notes, resolvedProviderId, resolvedFunctionId })
  })

  // ─── Step 7: Resolve references & cross-tab checks ────────────────────────

  // Build map: projectName → resolved programmes / types
  // Also per-project internal function set for ext warning check
  const projects: ParsedImportProject[] = []

  for (const rp of rawProjects) {
    // Programme resolution
    let programmeId: string | null = null
    if (rp.programmeName) {
      const prog = progByName.get(rp.programmeName.toLowerCase())
      if (!prog) {
        const suggest = didYouMean(rp.programmeName, [...state.programmes.filter(p => p.active).map(p => p.name)])
        const hint = suggest ? ` Did you mean "${suggest}"?` : ''
        errors.push({ tab: 'Projects', row: rp.rowNum, column: 'programme_name', message: `Programme "${rp.programmeName}" not found (active programmes only).${hint}` })
      } else {
        programmeId = prog.id
      }
    }

    // Project type resolution — CASE-SENSITIVE
    let typeId = ''
    if (rp.projectType) {
      const pt = typeByName.get(rp.projectType)
      if (!pt) {
        errors.push({ tab: 'Projects', row: rp.rowNum, column: 'project_type', message: `Project Type "${rp.projectType}" not found (case-sensitive match required).` })
      } else {
        typeId = pt.id
      }
    }

    // Activities for this project
    const activities: ParsedImportActivity[] = rawActivities
      .filter(ac => ac.projectName === rp.projectName)
      .map(ac => ({
        name: ac.activityName,
        startMonth: ac.startMonth,
        endMonth: ac.endMonth || null,
        fundingSource: ac.fundingSource,
        fundingNotes: ac.fundingNotes,
      }))

    // Internal reqs for this project
    const internalReqs: ParsedImportIntReq[] = rawIntReqs
      .filter(r => r.projectName === rp.projectName && r.resolvedSkillId)
      .map(r => ({
        activityName: r.activityName,
        skillId: r.resolvedSkillId!,
        level: r.level,
        hoursPerMonth: r.hoursPerMonth,
        notes: r.notes,
      }))

    // Step 8: Spawn dry-run — must have ≥1 internal req
    if (internalReqs.length === 0) {
      errors.push({ tab: 'Projects', row: rp.rowNum, column: 'project_name', message: `Project "${rp.projectName}" has no Internal Requirements. At least one is required to spawn Demands.` })
    }

    // External reqs for this project
    const externalReqs: ParsedImportExtReq[] = rawExtReqs
      .filter(r => r.projectName === rp.projectName && r.resolvedProviderId && r.resolvedFunctionId)
      .map(r => ({
        activityName: r.activityName,
        providerId: r.resolvedProviderId!,
        role: r.role,
        functionTag: r.resolvedFunctionId!,
        hoursPerMonth: r.hoursPerMonth,
        notes: r.notes,
      }))

    // Warning: external function_tag not in project's internal req functions
    if (internalReqs.length > 0) {
      const intFnIds = new Set<string>()
      for (const ir of internalReqs) {
        const sk = state.skills.find(s => s.id === ir.skillId)
        if (sk) {
          const fnId = domFnMap.get(sk.domain_id)
          if (fnId) intFnIds.add(fnId)
        }
      }
      for (const er of externalReqs) {
        if (!intFnIds.has(er.functionTag)) {
          const fnName = fnNameMap.get(er.functionTag) ?? er.functionTag
          // Find the row number
          const srcRow = rawExtReqs.find(r => r.projectName === rp.projectName && r.resolvedFunctionId === er.functionTag)
          warnings.push({
            tab: 'External Requirements',
            row: srcRow?.rowNum ?? 0,
            message: `External function_tag "${fnName}" is not among the project's internal requirement functions for "${rp.projectName}". This external req may be unattached to a Demand.`,
          })
        }
      }
    }

    projects.push({
      projectName: rp.projectName,
      programmeId,
      typeId,
      owner: rp.owner,
      description: rp.description,
      activities,
      internalReqs,
      externalReqs,
    })
  }

  return { errors, warnings, projects }
}
