import { clsx } from 'clsx'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center gap-1.5 font-medium rounded transition-all focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' && 'px-2 py-1 text-xs',
        size === 'md' && 'px-3 py-1.5 text-sm',
        variant === 'primary' && 'bg-brand text-white hover:bg-brand-hover',
        variant === 'secondary' && 'border border-border text-gray-700 bg-white hover:border-border-hover hover:text-near-black',
        variant === 'ghost' && 'text-gray-600 hover:bg-gray-100 hover:text-near-black',
        variant === 'danger' && 'bg-accent-red text-white hover:opacity-90',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
