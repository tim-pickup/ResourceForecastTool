import { clsx } from 'clsx'

interface LabelProps { children: React.ReactNode }
function Label({ children }: LabelProps) {
  return <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">{children}</label>
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}
export function Input({ label, className, ...props }: InputProps) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <input
        className={clsx(
          'w-full border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand transition-colors',
          className
        )}
        {...props}
      />
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}
export function Select({ label, children, className, ...props }: SelectProps) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <select
        className={clsx(
          'w-full border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand bg-white transition-colors',
          className
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}
export function Textarea({ label, className, ...props }: TextareaProps) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <textarea
        className={clsx(
          'w-full border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand resize-none transition-colors',
          className
        )}
        rows={3}
        {...props}
      />
    </div>
  )
}
