import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9c6b3f]/40 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none';

  const variants: Record<string, string> = {
    primary:
      'bg-[#9c6b3f] text-white shadow-sm hover:bg-[#8a5d36] active:bg-[#7a4f2c]',
    secondary:
      'bg-white text-[#2b2b2b] border border-[#d8d8d8] hover:bg-[#f6f6f5] active:bg-[#efefee]',
    ghost:
      'text-[#9c6b3f] hover:bg-[#f4ebe0]',
  };

  const sizes: Record<string, string> = {
    sm: 'text-sm px-5 py-2 rounded-lg gap-1.5',
    md: 'text-[15px] px-6 py-2.5 rounded-lg gap-2',
    lg: 'text-[16px] px-8 py-3 rounded-lg gap-2.5',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
