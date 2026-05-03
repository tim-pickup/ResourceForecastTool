/**
 * generate-template.mjs
 *
 * Generates the v1.20 import template xlsx at assets/import_template/master.xlsx
 * Run with: node scripts/generate-template.mjs
 */

import ExcelJS from 'exceljs'
import { mkdir } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputDir = join(__dirname, '..', 'assets', 'import_template')
const outputPath = join(outputDir, 'master.xlsx')

await mkdir(outputDir, { recursive: true })

const wb = new ExcelJS.Workbook()
wb.creator = 'ResourceForecastTool'
wb.created = new Date()

function styleHeader(ws) {
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9ECEF' } }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFADB5BD' } } }
    cell.alignment = { vertical: 'middle' }
  })
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
}

function addDV(ws, addr, opts) {
  ws.dataValidations.add(addr, opts)
}

// ─── Tab 1: Projects ──────────────────────────────────────────────────────────

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

// ─── Tab 2: Activities ────────────────────────────────────────────────────────

const wsActivities = wb.addWorksheet('Activities')
wsActivities.columns = [
  { header: 'project_name',         key: 'project_name',         width: 40 },
  { header: 'activity_name',        key: 'activity_name',        width: 30 },
  { header: 'activity_start_month', key: 'activity_start_month', width: 18 },
  { header: 'activity_end_month',   key: 'activity_end_month',   width: 18 },
  { header: 'funding_source',       key: 'funding_source',       width: 28 },
  { header: 'funding_notes',        key: 'funding_notes',        width: 40 },
]
styleHeader(wsActivities)

addDV(wsActivities, 'A2:A500', {
  type: 'list', allowBlank: true,
  formulae: ['Projects!$A$2:$A$201'],
  showErrorMessage: true, errorTitle: 'Invalid Project', error: 'Must match a project_name from the Projects tab.',
})
addDV(wsActivities, 'E2:E500', {
  type: 'list', allowBlank: true,
  formulae: ['"Investment Scheme,Plant/Sector Allocation,Mixed"'],
  showErrorMessage: true, errorTitle: 'Invalid Funding Source', error: 'Must be one of: Investment Scheme, Plant/Sector Allocation, Mixed.',
})

// ─── Tab 3: Internal Requirements ────────────────────────────────────────────

const wsInt = wb.addWorksheet('Internal Requirements')
wsInt.columns = [
  { header: 'project_name',    key: 'project_name',    width: 40 },
  { header: 'activity_name',   key: 'activity_name',   width: 30 },
  { header: 'skill_function',  key: 'skill_function',  width: 25 },
  { header: 'skill_domain',    key: 'skill_domain',    width: 25 },
  { header: 'skill_name',      key: 'skill_name',      width: 30 },
  { header: 'level',           key: 'level',           width: 15 },
  { header: 'hours_per_month', key: 'hours_per_month', width: 18 },
  { header: 'notes',           key: 'notes',           width: 40 },
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

// ─── Tab 4: External Requirements ────────────────────────────────────────────

const wsExt = wb.addWorksheet('External Requirements')
wsExt.columns = [
  { header: 'project_name',    key: 'project_name',    width: 40 },
  { header: 'activity_name',   key: 'activity_name',   width: 30 },
  { header: 'provider',        key: 'provider',        width: 30 },
  { header: 'role',            key: 'role',            width: 30 },
  { header: 'function_tag',    key: 'function_tag',    width: 25 },
  { header: 'hours_per_month', key: 'hours_per_month', width: 18 },
  { header: 'notes',           key: 'notes',           width: 40 },
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

// ─── Tab 5: Reference - Programmes ───────────────────────────────────────────

const wsProg = wb.addWorksheet('Reference - Programmes')
wsProg.columns = [
  { header: 'Name',        key: 'name',        width: 35 },
  { header: 'Description', key: 'description', width: 50 },
]
styleHeader(wsProg)

// ─── Tab 6: Reference - Skills ───────────────────────────────────────────────

const wsSkills = wb.addWorksheet('Reference - Skills')
wsSkills.columns = [
  { header: 'Function',   key: 'function',   width: 25 },
  { header: 'Domain',     key: 'domain',     width: 25 },
  { header: 'Skill Name', key: 'skill_name', width: 35 },
]
styleHeader(wsSkills)

// ─── Tab 7: Reference - Providers ────────────────────────────────────────────

const wsProv = wb.addWorksheet('Reference - Providers')
wsProv.columns = [
  { header: 'Provider Name', key: 'name', width: 35 },
]
styleHeader(wsProv)

// ─── Tab 8: Reference - Project Types ────────────────────────────────────────

const wsTypes = wb.addWorksheet('Reference - Project Types')
wsTypes.columns = [
  { header: 'Project Type Name', key: 'name', width: 30 },
]
styleHeader(wsTypes)

// ─── Tab 9: _lists (hidden) ───────────────────────────────────────────────────

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

await wb.xlsx.writeFile(outputPath)
console.log(`Written: ${outputPath}`)
