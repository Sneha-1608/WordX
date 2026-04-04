import { motion } from 'motion/react';
import { Badge } from './Badge';

interface FeatureCardProps {
  step: string;
  title: string;
  description: string;
  badgeType: 'exact' | 'fuzzy' | 'new' | 'violation' | 'success' | 'warning';
  badgeText?: string;
  className?: string;
}

export function FeatureCard({
  step,
  title,
  description,
  badgeType,
  badgeText,
  className = '',
}: FeatureCardProps) {
  return (
    <motion.div
      className={`w-[380px] h-[480px] rounded-[24px] bg-ui-white border border-ui-border p-8 flex flex-col gap-6 transition-all duration-300 hover:border-brand-emerald hover:-translate-y-1 ${className}`}
      style={{ boxShadow: 'var(--shadow-md)' }}
      whileHover={{ boxShadow: 'var(--shadow-lg)' }}
    >
      {/* Step Number */}
      <div className="text-display-h2 text-brand-emerald">{step}</div>

      {/* Title */}
      <div className="text-display-h4 text-brand-indigo">{title}</div>

      {/* Description */}
      <div className="text-body-md text-ui-slate flex-grow">{description}</div>

      {/* Badge at bottom */}
      <div className="mt-auto">
        <Badge type={badgeType} text={badgeText} />
      </div>
    </motion.div>
  );
}
