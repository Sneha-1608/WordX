interface BadgeProps {
  type: 'exact' | 'fuzzy' | 'new' | 'violation' | 'success' | 'warning';
  size?: 'sm' | 'md';
  text?: string;
  className?: string;
}

export function Badge({ type, size = 'md', text, className = '' }: BadgeProps) {
  const sizeStyles = {
    sm: 'px-2 py-1 text-[11px]',
    md: 'px-3 py-1.5 text-[13px]',
  };

  const typeConfig = {
    exact: {
      bg: 'bg-brand-emerald-light',
      text: 'text-brand-emerald',
      icon: '●',
      defaultText: '100% Exact',
    },
    fuzzy: {
      bg: 'bg-[#DBEAFE]',
      text: 'text-[#1D4ED8]',
      icon: '◈',
      defaultText: '92% Fuzzy',
    },
    new: {
      bg: 'bg-[#F1F5F9]',
      text: 'text-ui-slate',
      icon: '○',
      defaultText: 'AI Translated',
    },
    violation: {
      bg: 'bg-[#FEE2E2]',
      text: 'text-[#DC2626]',
      icon: '⚠',
      defaultText: 'Glossary Violation',
    },
    success: {
      bg: 'bg-brand-emerald-light',
      text: 'text-status-success',
      icon: '✓',
      defaultText: 'Success',
    },
    warning: {
      bg: 'bg-[#FEF3C7]',
      text: 'text-status-warning',
      icon: '⚠',
      defaultText: 'Warning',
    },
  };

  const config = typeConfig[type];

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${config.bg} ${config.text} ${sizeStyles[size]} rounded-[8px] font-medium ${className}`}
    >
      <span>{config.icon}</span>
      <span>{text || config.defaultText}</span>
    </span>
  );
}
