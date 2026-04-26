import { clsx } from 'clsx'
import type { DemandStatus, ProjectStatus } from '../../types'

const DEMAND_STATUS_STYLES: Record<DemandStatus, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Submitted: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  Approved: 'bg-blue-50 text-blue-700 border border-blue-200',
  PartiallyAllocated: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  Allocated: 'bg-green-50 text-green-700 border border-green-200',
}

const DEMAND_STATUS_LABELS: Record<DemandStatus, string> = {
  Draft: 'Draft',
  Submitted: 'Submitted',
  Approved: 'Approved',
  PartiallyAllocated: 'Partially Allocated',
  Allocated: 'Allocated',
}

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Scoping: 'bg-purple-50 text-purple-700 border border-purple-200',
  Submitted: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  Approved: 'bg-blue-50 text-blue-700 border border-blue-200',
  Allocated: 'bg-green-50 text-green-700 border border-green-200',
}

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  Draft: 'Draft',
  Scoping: 'Scoping',
  Submitted: 'Submitted',
  Approved: 'Approved',
  Allocated: 'Allocated',
}

export function StatusBadge({ status }: { status: DemandStatus }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', DEMAND_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600')}>
      {DEMAND_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', PROJECT_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600')}>
      {PROJECT_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600', className)}>
      {children}
    </span>
  )
}
