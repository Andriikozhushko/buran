import { useT } from '../i18n';

interface BadgeProps {
  variant: 'high' | 'medium' | 'low' | 'info' | 'success';
  children?: string;
}

const variants = {
  high: 'bg-[#fbeaea] text-[#c0392f] ring-1 ring-[#f0d2d0]',
  medium: 'bg-[#f8f0e2] text-[#a9711f] ring-1 ring-[#ecddc4]',
  low: 'bg-[#f1ece4] text-[#7a5734] ring-1 ring-[#e4d9c9]',
  info: 'bg-[#f1ece4] text-[#7a5734] ring-1 ring-[#e4d9c9]',
  success: 'bg-[#e8f1e8] text-[#357a3b] ring-1 ring-[#d3e6d3]',
};

export function Badge({ variant, children }: BadgeProps) {
  const t = useT();
  const labels = {
    high: t.badgeHigh,
    medium: t.badgeMedium,
    low: t.badgeLow,
    info: '',
    success: '',
  };
  const label = labels[variant];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold uppercase tracking-wide ${variants[variant]}`}
    >
      {label || children}
    </span>
  );
}
