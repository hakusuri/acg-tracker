export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export function BarChart({ data }: { data: BarDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <div className="chart-empty">暂无数据</div>;
  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <span className="bar-label" title={d.label}>{d.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color }} />
          </div>
          <span className="bar-value">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({ data, size = 190 }: { data: DonutDatum[]; size?: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return <div className="chart-empty">暂无数据</div>;
  const r = 62;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 160 160">
          <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(128,128,128,.16)" strokeWidth="24" />
          {data.map((d) => {
            const len = (d.value / total) * c;
            const el = (
              <circle
                key={d.label}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth="24"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 80 80)"
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="donut-center">
          <strong>{total}</strong>
          <span>总计</span>
        </div>
      </div>
      <div className="donut-legend">
        {data.map((d) => (
          <span className="legend-item" key={d.label}>
            <i style={{ background: d.color }} />
            {d.label} · {d.value}
          </span>
        ))}
      </div>
    </div>
  );
}