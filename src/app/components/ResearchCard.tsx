interface ResearchCardProps {
  source: string;
  title: string;
  description: string;
  className?: string;
}

export function ResearchCard({ source, title, description, className = '' }: ResearchCardProps) {
  return (
    <div
      className={`rounded-[24px] p-8 flex flex-col gap-4 transition-all duration-300 hover:border-white/25 ${className}`}
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      {/* Source ID */}
      <span className="text-code-sm text-brand-emerald">{source}</span>

      {/* Paper Title */}
      <h3 className="text-body-lg font-semibold text-white">{title}</h3>

      {/* Description */}
      <p className="text-body-md" style={{ color: 'rgba(255,255,255,0.65)' }}>
        {description}
      </p>
    </div>
  );
}
