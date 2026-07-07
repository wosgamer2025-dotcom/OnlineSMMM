import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    if (import.meta.env.DEV) {
      console.error(error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="error-boundary" role="alert">
          <h1>Sayfa yüklenemedi</h1>
          <p>Lütfen sayfayı yenileyin. Sorun devam ederse destek ekibiyle iletişime geçin.</p>
          {import.meta.env.DEV && this.state.error ? (
            <pre>{this.state.error.message}</pre>
          ) : null}
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
