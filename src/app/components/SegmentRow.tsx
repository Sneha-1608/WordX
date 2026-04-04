import { Badge } from './Badge';

interface SegmentRowProps {
  status: 'approved' | 'needs-review' | 'rejected';
  badgeType: 'exact' | 'fuzzy' | 'new' | 'violation' | 'success' | 'warning';
  badgeText?: string;
  sourceText: string;
  targetText: string;
  className?: string;
  active?: boolean;
}

export function SegmentRow({
  status,
  badgeType,
  badgeText,
  sourceText,
  targetText,
  className = '',
  active = false,
}: SegmentRowProps) {
  const statusColors = {
    approved: 'bg-brand-emerald',
    'needs-review': 'bg-status-warning',
    rejected: 'bg-status-error',
  };

  return (
    <div
      className={`w-full h-[72px] flex items-center gap-4 px-4 lg:px-6 border-b border-ui-border transition-all duration-200 group hover:bg-ui-surface ${
        active ? 'bg-ui-white border-brand-emerald shadow-[var(--shadow-sm)]' : ''
      } ${className}`}
    >
      {/* Status Dot */}
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColors[status]}`} />

      {/* Badge */}
      <div className="w-[120px] lg:w-[140px] flex-shrink-0">
        <Badge type={badgeType} size="sm" text={badgeText} />
      </div>

      {/* Source Text */}
      <div className="flex-1 text-code-md text-ui-slate truncate">{sourceText}</div>

      {/* Divider */}
      <div className="hidden lg:block w-[1px] h-12 bg-ui-border flex-shrink-0" />

      {/* Target Text */}
      <div
        className={`flex-1 text-code-md text-brand-indigo truncate ${
          active ? 'bg-ui-surface rounded-[8px] px-3 py-2' : ''
        }`}
      >
        {targetText}
      </div>

      {/* Action Buttons (appear on hover) */}
      <div className="hidden lg:flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0">
        <button className="w-7 h-7 rounded-md bg-brand-emerald-light text-brand-emerald text-xs flex items-center justify-center hover:bg-brand-emerald hover:text-white transition-colors">
          ✓
        </button>
        <button className="w-7 h-7 rounded-md bg-ui-surface text-ui-slate text-xs flex items-center justify-center hover:bg-ui-border transition-colors">
          ↺
        </button>
      </div>
    </div>
  );
}
