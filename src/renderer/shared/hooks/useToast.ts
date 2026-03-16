import { useToastStore } from '@shared/state/toastStore'

export function useToast() {
  const addToast = useToastStore((s) => s.addToast)
  return { toast: addToast }
}
