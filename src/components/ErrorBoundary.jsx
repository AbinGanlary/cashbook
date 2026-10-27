import React from 'react';

// Error Boundary — catches render errors and shows them instead of blank screen
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('App render error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px', fontFamily: 'monospace', background: '#fff1f2', minHeight: '100vh' }}>
          <h2 style={{ color: '#be123c', marginBottom: '12px' }}>⚠ Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#9f1239', fontSize: '13px' }}>
            {this.state.error.toString()}
            {this.state.error.stack ? '\n\n' + this.state.error.stack : ''}
          </pre>
          <button onClick={() => this.setState({ error: null })}
            style={{ marginTop: '20px', padding: '8px 20px', background: '#be123c', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}


