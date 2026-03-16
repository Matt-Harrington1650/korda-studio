import { useEffect } from 'react'
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react'
import type { Toast } from '@shared/state/toastStore'
import { useToastStore } from '@shared/state/toastStore'

const icons = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
}

const colors = {
  info: 'border-brand',
  success: 'border-success',
  warning: 'border-warning',
  error: 'border-error',
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = icons[toast.type]

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(), 5000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      className={`flex items-start gap-3 p-3 bg-surface-overlay border-l-2 ${colors[toast.type]} rounded shadow-lg min-w-72`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="text-sm text-text-primary">{toast.title}</div>
        {toast.message && (
          <div className="text-[11px] text-text-secondary mt-0.5">{toast.message}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="text-text-secondary hover:text-text-primary"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}
