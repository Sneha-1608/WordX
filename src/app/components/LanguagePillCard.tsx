interface LanguagePillCardProps {
  englishName: string;
  nativeName: string;
  className?: string;
}

export function LanguagePillCard({ englishName, nativeName, className = '' }: LanguagePillCardProps) {
  return (
    <div
      className={`rounded-[16px] bg-ui-white border border-ui-border py-4 px-5 flex flex-col gap-1 relative transition-all duration-300 hover:border-brand-emerald hover:shadow-[0px_4px_16px_rgba(0,0,0,0.06)] group ${className}`}
    >
      {/* Language English Name */}
      <span className="text-body-sm font-bold text-brand-indigo">{englishName}</span>

      {/* Native Script */}
      <span className="text-code-sm text-ui-slate">{nativeName}</span>

      {/* Active TM Status Dot */}
      <div className="absolute bottom-3 right-3 w-2 h-2 rounded-full bg-brand-emerald opacity-60 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}
