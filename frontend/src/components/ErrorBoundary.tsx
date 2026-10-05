import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('3D Studio render error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal3d">
          <b>3D renderer error</b>
          <span>{this.state.error.message}</span>
          <button onClick={() => this.setState({ error: null })}>Retry renderer</button>
        </div>
      )
    }

    return this.props.children
  }
}
