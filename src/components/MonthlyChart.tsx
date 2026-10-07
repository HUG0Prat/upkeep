import { useState } from 'react';
import type { MonthlyStat, UpdateKind } from '../../shared/types';
import { intlLocale, t } from '../../shared/i18n';
import { KIND_LABEL } from '../api';
import { Icon } from './Icon';

const SERIES: UpdateKind[] = ['package', 'system', 'driver', 'firmware'];

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(intlLocale(), { month: 'short', year: '2-digit' });
}

export function MonthlyChart({ data }: { data: MonthlyStat[] }) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;

  const totals = data.map((d) => SERIES.reduce((s, k) => s + d[k], 0));
  const max = Math.max(1, ...totals);
  const step = max <= 5 ? 1 : max <= 20 ? 5 : max <= 50 ? 10 : Math.ceil(max / 50) * 10;
  const top = Math.ceil(max / step) * step;
  const W = 640;
  const H = 180;
  const padL = 32;
  const padB = 22;
  const plotH = H - padB - 8;
  const bw = Math.min(36, (W - padL) / data.length - 12);
  const x = (i: number) => padL + ((W - padL) / data.length) * (i + 0.5) - bw / 2;
  const y = (v: number) => 8 + plotH - (v / top) * plotH;
  const labels = KIND_LABEL();

  return (
    <section className="chart-card viz-root" aria-label={t('Mises à jour installées par mois')}>
      <div className="chart-head">
        <h2>{t('Mises à jour installées par mois')}</h2>
        <div className="legend" role="list">
          {SERIES.map((k) => (
            <span key={k} role="listitem" className="legend-item">
              <span className={`swatch s-${k}`} /> {labels[k]}
            </span>
          ))}
        </div>
        <button className="btn small ghost" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          <Icon name={asTable ? 'chart' : 'table'} size={15} /> {asTable ? t('Graphique') : t('Tableau')}
        </button>
      </div>
      {asTable ? (
        <table className="table compact">
          <thead>
            <tr>
              <th>{t('Mois')}</th>
              {SERIES.map((k) => (
                <th key={k}>{labels[k]}</th>
              ))}
              <th>{t('Total')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.month}>
                <td>{monthLabel(d.month)}</td>
                {SERIES.map((k) => (
                  <td key={k}>{d[k]}</td>
                ))}
                <td>{totals[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={t('Graphique en barres empilées')}>
            {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((v) => (
              <g key={v}>
                <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="grid" />
                <text x={padL - 6} y={y(v) + 4} className="axis" textAnchor="end">
                  {v}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              let acc = 0;
              const segs = SERIES.filter((k) => d[k] > 0);
              return (
                <g key={d.month} onMouseEnter={() => setHover(i)}>
                  <rect x={x(i) - 8} y={8} width={bw + 16} height={plotH} className="hit" />
                  {segs.map((k, si) => {
                    const y0 = y(acc);
                    acc += d[k];
                    const y1 = y(acc);
                    const isTop = si === segs.length - 1;
                    const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2));
                    return isTop ? (
                      <path
                        key={k}
                        className={`bar s-${k}`}
                        d={`M${x(i)},${y1 + h} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`}
                      />
                    ) : (
                      <rect key={k} className={`bar s-${k}`} x={x(i)} y={y1} width={bw} height={h} />
                    );
                  })}
                  <text x={x(i) + bw / 2} y={H - 6} className="axis" textAnchor="middle">
                    {monthLabel(d.month)}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${((x(hover) + bw / 2) / W) * 100}%` }}>
              <strong>{monthLabel(data[hover].month)}</strong>
              {SERIES.map((k) => (
                <div key={k}>
                  <span className={`swatch s-${k}`} /> {labels[k]} : {data[hover][k]}
                </div>
              ))}
              <div className="muted">
                {t('Total')} : {totals[hover]}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
