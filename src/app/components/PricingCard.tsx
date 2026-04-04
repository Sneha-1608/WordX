import { motion } from 'motion/react';
import { Button } from './Button';

interface PricingCardProps {
  planName: string;
  price: string;
  oldPrice?: string;
  perUnit: string;
  features: { text: string; included: boolean }[];
  ctaText: string;
  ctaVariant: 'primary' | 'secondary' | 'ghost';
  featured?: boolean;
  className?: string;
}

export function PricingCard({
  planName,
  price,
  oldPrice,
  perUnit,
  features,
  ctaText,
  ctaVariant,
  featured = false,
  className = '',
}: PricingCardProps) {
  return (
    <motion.div
      className={`w-full lg:w-[360px] rounded-[24px] bg-ui-white border flex flex-col relative ${
        featured
          ? 'border-brand-emerald border-[2px] scale-[1.02]'
          : 'border-ui-border'
      } ${className}`}
      style={{ boxShadow: featured ? 'var(--shadow-lg)' : 'var(--shadow-sm)' }}
      whileHover={{ y: -4, boxShadow: 'var(--shadow-lg)' }}
      transition={{ duration: 0.3 }}
    >
      {/* Featured Top Border */}
      {featured && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-brand-emerald rounded-t-[24px]" />
      )}

      {/* Most Popular Badge */}
      {featured && (
        <div className="absolute -top-3 right-6">
          <span className="bg-brand-emerald text-white text-[11px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider">
            Most Popular
          </span>
        </div>
      )}

      <div className="p-8 lg:p-10 flex flex-col gap-6 flex-1">
        {/* Plan Name */}
        <div className="text-label-caps text-ui-slate">{planName}</div>

        {/* Price */}
        <div>
          <div className="flex items-baseline gap-3">
            {oldPrice && (
              <span className="text-[24px] font-bold text-status-error line-through opacity-60">
                {oldPrice}
              </span>
            )}
            <span className="text-display-h2 text-brand-indigo">{price}</span>
          </div>
          <div className="text-body-sm text-ui-slate mt-1">{perUnit}</div>
        </div>

        {/* Divider */}
        <div className="h-[1px] bg-ui-border" />

        {/* Feature List */}
        <div className="flex flex-col gap-3 flex-1">
          {features.map((feat, i) => (
            <div key={i} className="flex items-start gap-3 text-body-md">
              <span
                className={`mt-0.5 text-sm flex-shrink-0 ${
                  feat.included ? 'text-brand-emerald' : 'text-status-error'
                }`}
              >
                {feat.included ? '✓' : '✗'}
              </span>
              <span className={feat.included ? 'text-brand-indigo' : 'text-ui-slate'}>
                {feat.text}
              </span>
            </div>
          ))}
        </div>

        {/* CTA Button */}
        <Button variant={ctaVariant} size="lg" className="w-full mt-auto">
          {ctaText}
        </Button>
      </div>
    </motion.div>
  );
}
