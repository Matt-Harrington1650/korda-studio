import { RouterProvider } from 'react-router'
import { router } from './router'
import { useIndexingToasts } from './shared/hooks/useIndexingToasts'

function AppInner() {
  useIndexingToasts()
  return <RouterProvider router={router} />
}

export default function App() {
  return <AppInner />
}
