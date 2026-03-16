import { createRoot } from 'react-dom/client'
import App from './App'
import './shared/styles/theme.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element #root not found in index.html')
}
createRoot(root).render(<App />)
