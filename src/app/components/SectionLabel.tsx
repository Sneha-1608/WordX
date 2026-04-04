interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionLabel({ children, className = '' }: SectionLabelProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Emerald Accent Bar */}
      <div className="w-[2px] h-4 bg-brand-emerald flex-shrink-0" />
      <span className="text-label-caps text-ui-slate-light">{children}</span>
    </div>
  );
}
