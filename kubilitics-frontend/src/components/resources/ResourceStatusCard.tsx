import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ResourceStatusCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'muted';
  variant?: 'default' | 'bordered';
}

const iconColorClasses: Record<string, string> = {
  primary: 'text-primary',
  success: 'text-[hsl(var(--success))]',
  warning: 'text-[hsl(var(--warning))]',
  error: 'text-[hsl(var(--error))]',
  info: 'text-[hsl(var(--info))]',
  muted: 'text-muted-foreground',
};

export function ResourceStatusCard({
  label,
  value,
  icon: Icon,
  iconColor = 'primary',
  variant = 'default',
}: ResourceStatusCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'flex items-center justify-between p-4 rounded-xl bg-card transition-colors',
        variant === 'bordered' && 'border border-border hover:border-primary/30 hover:shadow-sm',
        'focus-within:ring-2 focus-within:ring-primary/20'
      )}
    >
      <div className="space-y-1 min-w-0 flex-1">
        {/* Label: dark and visible for world-class UX (was text-muted-foreground) */}
        <p className="text-sm font-medium text-foreground truncate">{label}</p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
      </div>
      <Icon className={cn('h-8 w-8 shrink-0 opacity-80', iconColorClasses[iconColor])} aria-hidden />
    </motion.div>
  );
}

export interface ResourceStatusCardsProps {
  cards: ResourceStatusCardProps[];
}

export function ResourceStatusCards({ cards }: ResourceStatusCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-border/50 bg-muted/20 p-3">
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: index * 0.05 }}
        >
          <ResourceStatusCard {...card} variant="bordered" />
        </motion.div>
      ))}
    </div>
  );
}
