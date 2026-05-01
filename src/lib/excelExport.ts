/**
 * excelExport.ts — §6 Import Template generator (Change 9)
 *
 * Lazy-imports ExcelJS to keep the initial bundle lean.
 * Call downloadImportTemplate(state) from any event handler.
 */

import type { AppState } from '../types'

export async function downloadImportTemplate(state: AppState): Promise<void> {
  // Lazy-import ExcelJS so it is only bundled when actually needed
  const ExcelJS = (await import('exceljs')).default

  const wb = new ExcelJS.Workbook()
  wb.creator = 'ResourceForecastTool'
  wb.created = new Date()

  // ─── Helper: make a header row bold with light grey fill ──────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyWs = any

  function styleHeader(ws: AnyWs) {
    ws.getRow(1).eachCell((cell: AnyWs) => {
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECEF' } }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFADB5BD' } } }
      cell.alignment = { vertical: 'middle' }
    })
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  }

  // Helper: add data validation (dataValidations not in ExcelJS typings, use any)
  function addDV(ws: AnyWs, addr: string, opts: Record<string, unknown>) {
    ws.dataValidations.add(addr, opts)
  }

  // ─── Tab 1: Projects ──────────────────────────────────────────────────────

  const wsProjects = wb.addWorksheet('Projects')
  wsProjects.columns = [
    { header: 'project_name',        key: 'project_name',        width: 40 },
    { header: 'programme_name',      key: 'programme_name',      width: 30 },
    { header: 'project_type',        key: 'project_type',        width: 25 },
    { header: 'project_owner',       key: 'project_owner',       width: 25 },
    { header: 'project_description', key: 'project_description', width: 50 },
  ]
  styleHeader(wsProjects)

  addDV(wsProjects, 'B2:B500', {
    type: 'list', allowBlank: true,
    formulae: ["'Reference - Programmes'!$A$2:$A$500"],
    showErrorMessage: true, errorTitle: 'Invalid Programme', error: 'Select from the Reference - Programmes list.',
  })
  addDV(wsProjects, 'C2:C500', {
    type: 'list', allowBlank: true,
    formulae: ["'Reference - Project Types'!$A$2:$A$500"],
    showErrorMessage: true, errorTitle: 'Invalid Project Type', error: 'Select from the Reference - Project Types list.',
  })

  // ─── Tab 2: Phases ────────────────────────────────────────────────────────

  const wsPhases = wb.addWorksheet('Phases')
  wsPhases.columns = [
    { header: 'project_name',   key: 'project_name',   width: 40 },
    { header: 'phase_name',     key: 'phase_name',     width: 30 },
    { header: 'phase_start_month', key: 'phase_start_month', width: 18 },
    { header: 'phase_end_month',   key: 'phase_end_month',   width: 18 },
    { header: 'funding_source', key: 'funding_source', width: 28 },
    { header: 'funding_notes',  key: 'funding_notes',  width: 40 },
  ]
  styleHeader(wsPhases)

  addDV(wsPhases, 'A2:A500', {
    type: 'list', allowBlank: true,
    formulae: ['Projects!$A$2:$A$201'],
    showErrorMessage: true, errorTitle: 'Invalid Project', error: 'Must match a project_name from the Projects tab.',
  })
  addDV(wsPhases, 'E2:E500', {
    type: 'list', allowBlank: true,
    formulae: ['"Investment Scheme,Plant/Sector Allocation,Mixed"'],
    showErrorMessage: true, errorTitle: 'Invalid Funding Source', error: 'Must be one of: Investment Scheme, Plant/Sector Allocation, Mixed.',
  })

  // ─── Tab 3: Internal Requirements ────────────────────────────────────────

  const wsInt = wb.addWorksheet('Internal Requirements')
  wsInt.columns = [
    { header: 'project_name',   key: 'project_name',   width: 40 },
    { header: 'phase_name',     key: 'phase_name',     width: 30 },
    { header: 'skill_function', key: 'skill_function', width: 25 },
    { header: 'skill_domain',   key: 'skill_domain',   width: 25 },
    { header: 'skill_name',     key: 'skill_name',     width: 30 },
    { header: 'level',          key: 'level',          width: 15 },
    { header: 'hours_per_month',key: 'hours_per_month',width: 18 },
    { header: 'notes',          key: 'notes',          width: 40 },
  ]
  styleHeader(wsInt)

  addDV(wsInt, 'A2:A500', {
    type: 'list', allowBlank: true,
    formulae: ['Projects!$A$2:$A$201'],
    showErrorMessage: true, errorTitle: 'Invalid Project', error: 'Must match a project_name from the Projects tab.',
  })
  addDV(wsInt, 'F2:F500', {
    type: 'list', allowBlank: true,
    formulae: ['"Basic,Advanced,Specialist"'],
    showErrorMessage: true, errorTitle: 'Invalid Level', error: 'Must be one of: Basic, Advanced, Specialist.',
  })

  // ─── Tab 4: External Requirements ────────────────────────────────────────

  const wsExt = wb.addWorksheet('External Requirements')
  wsExt.columns = [
    { header: 'project_name',   key: 'project_name',   width: 40 },
    { header: 'phase_name',     key: 'phase_name',     width: 30 },
    { header: 'provider',       key: 'provider',       width: 30 },
    { header: 'role',           key: 'role',           width: 30 },
    { header: 'function_tag',   key: 'function_tag',   width: 25 },
    { header: 'hours_per_month',key: 'hours_per_month',width: 18 },
    { header: 'notes',          key: 'notes',          width: 40 },
  ]
  styleHeader(wsExt)

  addDV(wsExt, 'A2:A500', {
    type: 'list', allowBlank: true,
    formulae: ['Projects!$A$2:$A$201'],
    showErrorMessage: true, errorTitle: 'Invalid Project', error: 'Must match a project_name from the Projects tab.',
  })
  addDV(wsExt, 'C2:C500', {
    type: 'list', allowBlank: true,
    formulae: ["'Reference - Providers'!$A$2:$A$500"],
    showErrorMessage: true, errorTitle: 'Invalid Provider', error: 'Select from the Reference - Providers list.',
  })
  addDV(wsExt, 'E2:E500', {
    type: 'list', allowBlank: true,
    formulae: ["'Reference - Skills'!$A$2:$A$2000"],
    showErrorMessage: true, errorTitle: 'Invalid Function Tag', error: 'Select from the Function column in Reference - Skills.',
  })

  // ─── Tab 5: Reference - Programmes ───────────────────────────────────────

  const wsProg = wb.addWorksheet('Reference - Programmes')
  wsProg.columns = [
    { header: 'Name',        key: 'name',        width: 35 },
    { header: 'Description', key: 'description', width: 50 },
  ]
  styleHeader(wsProg)
  const activeProgs = state.programmes.filter(p => p.active)
  activeProgs.forEach(p => wsProg.addRow({ name: p.name, description: p.description }))

  // ─── Tab 6: Reference - Skills ───────────────────────────────────────────

  const wsSkills = wb.addWorksheet('Reference - Skills')
  wsSkills.columns = [
    { header: 'Function',   key: 'function',   width: 25 },
    { header: 'Domain',     key: 'domain',     width: 25 },
    { header: 'Skill Name', key: 'skill_name', width: 35 },
  ]
  styleHeader(wsSkills)

  // Build lookup maps
  const fnMap = new Map(state.functions.map(f => [f.id, f.name]))
  const domMap = new Map(state.domains.map(d => [d.id, { name: d.name, functionId: d.functionId }]))

  // Active skills only, sorted by function name / domain name / skill name
  const activeSkills = state.skills
    .filter(sk => {
      const dom = domMap.get(sk.domain_id)
      if (!dom) return false
      const fn = state.functions.find(f => f.id === dom.functionId)
      return fn?.active ?? false
    })
    .map(sk => {
      const dom = domMap.get(sk.domain_id)!
      const fnName = fnMap.get(dom.functionId) ?? ''
      return { function: fnName, domain: dom.name, skill_name: sk.name }
    })
    .sort((a, b) => {
      const fn = a.function.localeCompare(b.function)
      if (fn !== 0) return fn
      const dm = a.domain.localeCompare(b.domain)
      if (dm !== 0) return dm
      return a.skill_name.localeCompare(b.skill_name)
    })

  activeSkills.forEach(row => wsSkills.addRow(row))

  // ─── Tab 7: Reference - Providers ────────────────────────────────────────

  const wsProv = wb.addWorksheet('Reference - Providers')
  wsProv.columns = [
    { header: 'Provider Name', key: 'name', width: 35 },
  ]
  styleHeader(wsProv)
  state.providers.forEach(p => wsProv.addRow({ name: p.name }))

  // ─── Tab 8: Reference - Project Types ────────────────────────────────────

  const wsTypes = wb.addWorksheet('Reference - Project Types')
  wsTypes.columns = [
    { header: 'Project Type Name', key: 'name', width: 30 },
  ]
  styleHeader(wsTypes)
  const activeTypes = state.projectTypes
    .filter(pt => pt.active)
    .sort((a, b) => a.display_order - b.display_order)
  activeTypes.forEach(pt => wsTypes.addRow({ name: pt.name }))

  // ─── Tab 9: _lists (hidden) ───────────────────────────────────────────────

  const wsLists = wb.addWorksheet('_lists')
  wsLists.state = 'hidden'
  wsLists.getCell('A1').value = 'funding_source'
  wsLists.getCell('A2').value = 'Investment Scheme'
  wsLists.getCell('A3').value = 'Plant/Sector Allocation'
  wsLists.getCell('A4').value = 'Mixed'
  wsLists.getCell('B1').value = 'level'
  wsLists.getCell('B2').value = 'Basic'
  wsLists.getCell('B3').value = 'Advanced'
  wsLists.getCell('B4').value = 'Specialist'

  // ─── Generate filename and trigger download ───────────────────────────────

  const today = new Date().toISOString().slice(0, 10)
  const filename = `ResourceForecastTool_ImportTemplate_v1.19_${today}.xlsx`

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
