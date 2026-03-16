import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  moduleName: string
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary">
          <AlertTriangle size={48} className="opacity-40" />
          <h2 className="text-lg font-medium text-text-primary">
            Something went wrong in {this.props.moduleName}
          </h2>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-brand text-white rounded hover:bg-brand-hover transition-colors"
          >
            Try reloading this module
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
