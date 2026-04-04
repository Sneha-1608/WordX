import { TrendingUp } from 'lucide-react';

interface StatCounterCardProps {
  value: string;
  label: string;
  trend?: string;
  className?: string;
}

export function StatCounterCard({ value, label, trend, className = '' }: StatCounterCardProps) {
  return (
    <div
      className={`w-[200px] h-[160px] rounded-[24px] bg-ui-white border border-ui-border p-6 flex flex-col gap-2 items-center justify-center text-center ${className}`}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {/* Big Number */}
      <div className="text-display-h2 text-brand-indigo">{value}</div>

      {/* Label */}
      <div className="text-label-caps text-ui-slate">{label}</div>

      {/* Trend */}
      {trend && (
        <div className="text-body-sm text-brand-emerald flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          {trend}
        </div>
      )}
    </div>
  );
}
