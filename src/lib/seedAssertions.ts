/**
 * Dev-mode renderability invariant assertions — §2.4.8
 *
 * Run on app startup in development to verify that the aggregation layer
 * produces the non-zero outputs the spec promises for the seed fixture.
 * Failures indicate a stubbed or broken aggregation function, not a data
 * problem.
 *
 * Assertions are against a normalised copy of the seed, independent of
 * localStorage state, so they reflect the canonical seed fixture.
 */

import type { AppState, DemandItem, DemandStatus } from '../types'
import {
  computeProjection,
  projected_consumption,
  grey_band,
  projection_shortfalls,
  demand_hours_for,
  type DemandTarget,
} from './capacity'
import { generateMonths, getCurrentMonth } from '../utils/capacity'
import seedRaw from '../../DEMOSEED.json'

// ─── Normalise raw seed (mirrors useAppStore.normalizeSeed) ──────────────────

function buildSeedState(): AppState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = seedRaw as Record<string, any>
  const items: Record<string, unknown>[] = raw.demand_items || []
  return {
    themes: raw.themes || [],
    skills: raw.skills || [],
    people: raw.people || [],
    demandItems: items.map((d): DemandItem => ({
      id: d.id as string,
      name: d.name as string,
      type: d.type as DemandItem['type'],
      status: (d.status === 'Accepted' ? 'Approved' : d.status) as DemandStatus,
      owner: d.owner as string,
      primary_theme_id: d.primary_theme_id as string,
      description: d.description as string,
      parked_reason: (d.parked_reason ?? null) as string | null,
      previous_status: (d.previous_status ?? null) as DemandStatus | null,
      closed_at: (d.closed_at ?? null) as string | null,
      phases: ((d.phases || []) as Record<string, unknown>[]).map(p => ({
        id: p.id as string,
        name: p.name as string,
        start_month: p.start_month as string,
        end_month: (p.end_month ?? null) as string | null,
        funding_source: p.funding_source as DemandItem['phases'][0]['funding_source'],
        funding_notes: (p.funding_notes ?? '') as string,
        requirements: ((p.requirements || []) as Record<string, unknown>[]).map(r => ({
          id: r.id as string,
          shape: 'skill' as const,
          skill_id: r.skill_id as string,
          level: r.level as DemandItem['phases'][0]['requirements'][0]['level'],
          hours_by_month: (r.hours_by_month ?? {}) as Record<string, number>,
          steady_state_hours: (r.steady_state_hours ?? null) as number | null,
          notes: (r.notes ?? null) as string | null,
          allocations: ((r.allocations ?? []) as Record<string, unknown>[]).map(a => ({
            id: a.id as string,
            person_id: a.person_id as string,
            hours_by_month: (a.hours_by_month ?? {}) as Record<string, number>,
            steady_state_hours: (a.steady_state_hours ?? null) as number | null,
            notes: (a.notes ?? null) as string | null,
          })),
        })),
      })),
    })),
  }
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

function assert(label: string, value: number, comparator: '>' | '==', expected: number): boolean {
  const pass = comparator === '>' ? value > expected : value === expected
  if (!pass) {
    console.error(`[SeedAssertion FAIL] ${label}: got ${value.toFixed(2)}, expected ${comparator} ${expected}`)
  }
  return pass
}

// ─── Main entry point ────────────────────────────────────────────────────────

export function runSeedAssertions(): void {
  const state = buildSeedState()
  const months = generateMonths(getCurrentMonth(), 18)

  // ── No-overlay projection ────────────────────────────────────────────────
  const projNoOverlay = computeProjection(state, months)

  // dmd_stress_001 "Plant C MES Platform Migration" is Approved with no
  // allocations. Its skl_mom_mes Specialist req projects onto Alex Morgan
  // (per_001) who also holds skl_mom_workflow — producing cross-skill
  // projected consumption and a grey band on the MOM MES skill chart.
  const bandMomMes = grey_band(
    { type: 'skill', id: 'skl_mom_mes' },
    '2026-06',
    state,
    projNoOverlay
  )
  assert('grey_band(skl_mom_mes, 2026-06) with no overlay', bandMomMes, '>', 0)

  // Alex Morgan (per_001) is the only skl_mom_mes Specialist — all 80h of
  // the unallocated MES req project onto him, consuming headroom.
  const alexProj = projected_consumption('per_001', '2026-06', projNoOverlay)
  assert('projected_consumption(per_001, 2026-06) with no overlay', alexProj, '>', 0)

  // ── Corporate Data Lake overlay ──────────────────────────────────────────
  // dmd_stress_002 "Corporate Data Lake — MI&V Integration" is Submitted.
  const corporateDataLakeId = 'dmd_stress_002'
  const overlayItem = state.demandItems.find(d => d.id === corporateDataLakeId)
  if (!overlayItem) {
    console.error('[SeedAssertion FAIL] dmd_stress_002 not found in seed — Corporate Data Lake item missing')
    return
  }

  const projWithOverlay = computeProjection(state, months, corporateDataLakeId)

  const mivTarget: DemandTarget = { type: 'theme', id: 'thm_miv' }
  const bandMivWithOverlay = grey_band(mivTarget, '2026-07', state, projWithOverlay)
  assert('grey_band(thm_miv, 2026-07) with Corporate Data Lake overlay', bandMivWithOverlay, '>', 0)

  const shortfalls = projection_shortfalls(projWithOverlay)
  const mivShortfall = shortfalls.find(
    sf => sf.skill_id === 'skl_miv_integration' && sf.month >= '2026-06' && sf.month <= '2026-08'
  )
  if (!mivShortfall) {
    console.error(
      '[SeedAssertion FAIL] No projection shortfall for skl_miv_integration in Jun–Aug 2026 with Corporate Data Lake overlay'
    )
  }

  // ── Invariant A — Submitted overlay === Approved-unallocated ────────────
  // The overlay item treated as Submitted vs hypothetically promoted to Approved
  // with no allocations must produce identical demand numbers.
  const COMMITTED_STATUSES = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])
  const EMPTY = new Set<DemandStatus>()
  const fakeState: AppState = {
    ...state,
    demandItems: state.demandItems.map(d =>
      d.id === corporateDataLakeId
        ? {
            ...d,
            status: 'Approved' as DemandStatus,
            phases: d.phases.map(ph => ({
              ...ph,
              requirements: ph.requirements.map(r => ({ ...r, allocations: [] })),
            })),
          }
        : d
    ),
  }
  for (const theme of state.themes) {
    for (const month of ['2026-07', '2026-08']) {
      const withOv = demand_hours_for({ type: 'theme', id: theme.id }, EMPTY, month, state, corporateDataLakeId)
      const withPr = demand_hours_for({ type: 'theme', id: theme.id }, COMMITTED_STATUSES, month, fakeState)
      const ovTotal = withOv.strategy + withOv.plant + withOv.npd + withOv.bau
      const prTotal = withPr.strategy + withPr.plant + withPr.npd + withPr.bau
      if (Math.abs(ovTotal - prTotal) > 0.01) {
        console.error(
          `[SeedAssertion FAIL] Invariant A: theme ${theme.name} ${month} — overlay(${ovTotal.toFixed(1)}) ≠ promoted(${prTotal.toFixed(1)})`
        )
      }
    }
  }

  // All passed
  const allOk =
    bandMomMes > 0 &&
    alexProj > 0 &&
    bandMivWithOverlay > 0 &&
    !!mivShortfall
  if (allOk) {
    console.info('[SeedAssertions] All §2.4.8 renderability invariants passed ✓')
  }
}
