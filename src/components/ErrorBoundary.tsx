import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../../shared/i18n';

interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[interface]', error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="view">
        <div className="callout danger" role="alert">
          <div>
            <h2>{t('Cette page a rencontré une erreur')}</h2>
            <p className="muted small pre">{this.state.error.message}</p>
            <div className="row">
              <button className="btn" onClick={() => this.setState({ error: null })}>
                {t('Réessayer')}
              </button>
              <button className="btn ghost" onClick={() => window.location.reload()}>
                {t('Recharger l’interface')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
