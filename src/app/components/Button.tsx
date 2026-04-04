import { forwardRef, ButtonHTMLAttributes } from 'react';
import { motion } from 'motion/react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'lg' | 'md' | 'sm';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, className = '', children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
    
    const variantStyles = {
      primary: 'bg-brand-emerald text-white hover:shadow-[0px_0px_32px_rgba(16,185,129,0.25)] hover:scale-[1.02]',
      secondary: 'bg-brand-indigo text-white hover:opacity-90',
      ghost: 'bg-transparent border-[1.5px] border-brand-indigo text-brand-indigo hover:bg-brand-indigo hover:text-white',
      destructive: 'bg-status-error text-white hover:opacity-90',
    };

    const sizeStyles = {
      lg: 'h-[52px] px-[40px] py-[24px] text-[16px]',
      md: 'h-[44px] px-[32px] py-[20px] text-[16px]',
      sm: 'h-[36px] px-[24px] py-[16px] text-[14px]',
    };

    return (
      <motion.button
        ref={ref}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} rounded-full ${className}`}
        whileTap={{ scale: 0.98 }}
        {...props}
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
