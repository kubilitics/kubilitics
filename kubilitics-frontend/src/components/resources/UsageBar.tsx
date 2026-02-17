import { useId, useState, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type UsageBarKind = 'cpu' | 'memory';

/** Parse CPU string (e.g. "200m", "1") to millicores number. */
export function parseCpu(value: string): number | null {
  if (!value || value === '-') return null;
  const s = value.trim();
  if (s.endsWith('m')) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * 1000 : null;
}

/** Parse memory string (e.g. "256Mi", "1Gi") to Mi. */
export function parseMemory(value: string): number | null {
  if (!value || value === '-') return null;
  const s = value.trim();
  if (s.endsWith('Ki')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n / 1024 : null;
  }
  if (s.endsWith('Mi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n : null;
  }
  if (s.endsWith('Gi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n * 1024 : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Format CPU for display in cores with full precision (no rounding).
 * Reference: "0", "0.01", "0.015" — small values never rounded to zero.
 */
function formatCpuDisplay(value: string): string {
  if (!value || value.trim() === '-') return '-';
  const millicores = parseCpu(value);
  if (millicores === null) return value;
  if (millicores === 0) return '0';
  const cores = millicores / 1000;
  const fixed = cores >= 1 ? cores.toFixed(2) : cores.toFixed(3);
  return fixed.replace(/\.?0+$/, '') || '0';
}

/**
 * Format memory for display with 3 decimal precision (no rounding).
 * Reference: "19.746 Mi", "18.004 Mi".
 */
function formatMemoryDisplay(value: string): string {
  if (!value || value.trim() === '-') return '-';
  const s = value.trim();
  let num: number;
  let unit: string;
  if (s.endsWith('Ki')) {
    num = parseFloat(s.slice(0, -2));
    unit = 'Ki';
  } else if (s.endsWith('Mi')) {
    num = parseFloat(s.slice(0, -2));
    unit = 'Mi';
  } else if (s.endsWith('Gi')) {
    num = parseFloat(s.slice(0, -2));
    unit = 'Gi';
  } else {
    const mi = parseMemory(value);
    if (mi === null) return value;
    return `${mi.toFixed(3)} Mi`;
  }
  if (!Number.isFinite(num)) return value;
  return `${num.toFixed(3)} ${unit}`;
}

/** CPU in cores with 2–3 decimals (e.g. 0.12, 0.003). Never round non-zero usage to zero. */
function formatCpuCompact(value: string): string {
  if (!value || value.trim() === '-') return '-';
  const millicores = parseCpu(value);
  if (millicores === null) return value;
  if (millicores === 0) return '0';
  const cores = millicores / 1000;
  const fixed = cores >= 1 ? cores.toFixed(2) : cores.toFixed(3);
  return fixed.replace(/\.?0+$/, '') || '0';
}

/** Memory with 2–3 decimals (e.g. 15.55 Mi, 0.36 Mi). Never round non-zero usage to zero. */
function formatMemoryCompact(value: string): string {
  if (!value || value.trim() === '-') return '-';
  const mi = parseMemory(value);
  if (mi === null) return value;
  if (mi === 0) return '0 Mi';
  if (mi >= 1024) {
    const gi = mi / 1024;
    const fixed = gi >= 1 ? gi.toFixed(2) : gi.toFixed(3);
    return `${fixed.replace(/\.?0+$/, '') || '0'} Gi`;
  }
  const fixed = mi >= 1 ? mi.toFixed(2) : mi.toFixed(3);
  return `${fixed.replace(/\.?0+$/, '') || '0'} Mi`;
}

function formatUsageDisplay(value: string, kind: UsageBarKind, displayFormat: 'full' | 'compact' = 'full'): string {
  if (!value || value.trim() === '-') return '-';
  if (displayFormat === 'compact') return kind === 'cpu' ? formatCpuCompact(value) : formatMemoryCompact(value);
  return kind === 'cpu' ? formatCpuDisplay(value) : formatMemoryDisplay(value);
}

/** Fixed scale: 1 core and 2 Gi so bar length is consistent across the app. */
const CPU_DEFAULT_MAX = 1000; // millicores (1 core = full bar)
const MEMORY_DEFAULT_MAX = 1024; // Mi (1 Gi = full bar)

/** Calculate max CPU/Memory from pod container resources (limits or requests * 1.5) */
export function calculatePodResourceMax(
  containers: Array<{ resources?: { requests?: { cpu?: string; memory?: string }; limits?: { cpu?: string; memory?: string } } }>,
  kind: 'cpu' | 'memory'
): number | undefined {
  if (!containers || containers.length === 0) return undefined;
  
  let totalMax = 0;
  let hasResources = false;
  
  for (const container of containers) {
    const resources = container.resources;
    if (!resources) continue;
    
    const limit = kind === 'cpu' ? resources.limits?.cpu : resources.limits?.memory;
    const request = kind === 'cpu' ? resources.requests?.cpu : resources.requests?.memory;
    
    if (limit) {
      const parsed = kind === 'cpu' ? parseCpu(limit) : parseMemory(limit);
      if (parsed !== null) {
        totalMax += parsed;
        hasResources = true;
      }
    } else if (request) {
      // Use request * 1.5 as estimated max if no limit
      const parsed = kind === 'cpu' ? parseCpu(request) : parseMemory(request);
      if (parsed !== null) {
        totalMax += parsed * 1.5;
        hasResources = true;
      }
    }
  }
  
  return hasResources ? totalMax : undefined;
}

/** Below this ratio we show no fill (only grey track). */
const MIN_RATIO = 0.005;
/** Minimum fill size in px so small non-zero values are visible. */
const MIN_FILL_PX = 4;

export type UsageBarVariant = 'bar' | 'sparkline';

export interface UsageBarProps {
  /** Display value e.g. "200m", "256Mi", or "-" when no metrics. */
  value: string;
  kind: UsageBarKind;
  /** bar = flat solid fill; sparkline when dataPoints provided. */
  variant?: UsageBarVariant;
  /** Optional max for bar length (cpu: millicores, memory: Mi). */
  max?: number;
  /** Bar width in pixels. */
  width?: number;
  /** Time-series for sparkline (current value repeated or real history). When provided with variant=sparkline, draws line + dot (CPU) or filled area + dot (Memory). */
  dataPoints?: number[];
  /** 'compact' = CPU as "45m", Memory as "128 Mi"; 'full' = CPU as "0.045" cores, memory with decimals. */
  displayFormat?: 'full' | 'compact';
  className?: string;
  /** Enable animations (default: true) */
  animated?: boolean;
  /** Show mini sparkline (default: true) */
  showSparkline?: boolean;
  /** Show color thresholds (default: true) */
  showThresholds?: boolean;
  /** Pulse animation for high usage (default: true) */
  pulseOnHigh?: boolean;
}

/** Generate subtle sparkline data with variation around current value */
function generateSparklineData(currentValue: number, maxValue: number, seed: number = 0): number[] {
  const variation = Math.max(currentValue * 0.08, maxValue * 0.02); // 8% variation or 2% of max
  return Array.from({ length: 12 }, (_, i) => {
    const time = Date.now() / 1000 + seed;
    const offset = Math.sin(time * 0.5 + i * 0.5) * variation;
    return Math.max(0, Math.min(maxValue, currentValue + offset));
  });
}

/** Get color based on usage threshold */
function getUsageColor(ratio: number, kind: 'cpu' | 'memory'): string {
  if (ratio < 0.5) {
    // Low usage: cool colors
    return kind === 'cpu' ? 'hsl(217, 91%, 55%)' : 'hsl(142, 76%, 36%)';
  } else if (ratio < 0.8) {
    // Medium usage: warm colors
    return 'hsl(45, 93%, 47%)';
  } else {
    // High usage: warning colors
    return 'hsl(0, 72%, 51%)';
  }
}

/** Get gradient stops based on usage threshold */
function getGradientStops(ratio: number, kind: 'cpu' | 'memory'): Array<{ offset: string; color: string; opacity: number }> {
  const baseColor = getUsageColor(ratio, kind);
  
  if (ratio < 0.5) {
    // Low usage: subtle gradient
    return [
      { offset: '0%', color: baseColor, opacity: 0.9 },
      { offset: '100%', color: baseColor, opacity: 0.6 },
    ];
  } else if (ratio < 0.8) {
    // Medium usage: medium gradient
    return [
      { offset: '0%', color: baseColor, opacity: 0.95 },
      { offset: '100%', color: baseColor, opacity: 0.7 },
    ];
  } else {
    // High usage: strong gradient
    return [
      { offset: '0%', color: baseColor, opacity: 1 },
      { offset: '100%', color: baseColor, opacity: 0.8 },
    ];
  }
}

export function UsageBar({
  value,
  kind,
  variant = 'bar',
  max = kind === 'cpu' ? CPU_DEFAULT_MAX : MEMORY_DEFAULT_MAX,
  width = 60,
  dataPoints,
  displayFormat = 'full',
  className,
  animated = true,
  showSparkline = true,
  showThresholds = true,
  pulseOnHigh = true,
}: UsageBarProps) {
  const uniqueId = useId();
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animated && !reducedMotion;
  const [isHovered, setIsHovered] = useState(false);
  const prevValueRef = useRef<string>(value);
  const seedRef = useRef(Math.random() * 1000);

  const valueStr = typeof value === 'string' ? value : '-';
  const numeric = kind === 'cpu' ? parseCpu(valueStr) : parseMemory(valueStr);
  const hasValue = numeric !== null && numeric >= 0;
  const displayValue = formatUsageDisplay(valueStr, kind, displayFormat);
  const effectiveMax = max ?? (kind === 'cpu' ? CPU_DEFAULT_MAX : MEMORY_DEFAULT_MAX);

  const isCpu = kind === 'cpu';
  const ratio = hasValue && effectiveMax > 0 ? Math.min(numeric! / effectiveMax, 1) : 0;
  const showFill = hasValue && ratio >= MIN_RATIO;
  const effectiveRatio = showFill ? ratio : 0;

  // Threshold-based colors
  const fillColor = showThresholds && hasValue ? getUsageColor(ratio, kind) : (isCpu ? 'hsl(217, 91%, 55%)' : 'hsl(142, 76%, 36%)');
  const isHighUsage = ratio >= 0.8;

  const barW = width;
  const barH = 16;
  const fillWidthRaw = showFill ? Math.max(effectiveRatio * barW, MIN_FILL_PX) : 0;
  const fillHeightRaw = showFill ? Math.max(effectiveRatio * barH, MIN_FILL_PX) : 0;
  const fillWidth = Math.min(barW, Math.round(fillWidthRaw));
  const fillHeight = Math.min(barH, Math.round(fillHeightRaw));
  const fillY = Math.max(0, barH - fillHeight);

  // Generate sparkline data if not provided
  const sparklineData = useRef<number[]>([]);
  useEffect(() => {
    if (hasValue && numeric !== null && showSparkline) {
      if (dataPoints && dataPoints.length > 1) {
        sparklineData.current = dataPoints;
      } else {
        sparklineData.current = generateSparklineData(numeric, effectiveMax, seedRef.current);
      }
    }
  }, [hasValue, numeric, effectiveMax, dataPoints, showSparkline]);

  // Track value changes for animation
  const valueChanged = prevValueRef.current !== value;
  useEffect(() => {
    prevValueRef.current = value;
  }, [value]);

  const useRealSparkline = variant === 'sparkline' && sparklineData.current.length > 1;
  const points = useRealSparkline
    ? (() => {
        const scaleMax = effectiveMax > 0 ? effectiveMax : Math.max(...sparklineData.current, 1);
        return sparklineData.current.map((v, i) => ({
          x: (i / (sparklineData.current.length - 1)) * barW,
          y: barH - Math.min((v / scaleMax), 1) * barH,
        }));
      })()
    : [];
  const pathD = points.length > 0 ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') : '';
  const areaD =
    points.length > 0
      ? `M 0 ${barH} L ${points.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${barW} ${barH} Z`
      : '';
  const lastPoint = points.length > 0 ? points[points.length - 1] : null;

  const gradientId = `usage-gradient-${isCpu ? 'cpu' : 'memory'}-${uniqueId.replace(/:/g, '-')}`;
  const sparklineGradientId = `usage-sparkline-${isCpu ? 'cpu' : 'memory'}-${uniqueId.replace(/:/g, '-')}`;
  const gradientStops = showThresholds ? getGradientStops(ratio, kind) : [
    { offset: '0%', color: fillColor, opacity: 0.9 },
    { offset: '100%', color: fillColor, opacity: 0.6 },
  ];

  const tooltipContent = hasValue ? (
    <>
      <p className="font-medium">{isCpu ? 'CPU (cores)' : 'Memory'}</p>
      <p className="text-xs text-muted-foreground">
        From Metrics Server: {displayValue}. Requires metrics-server in cluster.
      </p>
      {showThresholds && (
        <p className="text-xs text-muted-foreground mt-1">
          Usage: {Math.round(ratio * 100)}% of {isCpu ? 'CPU' : 'Memory'} capacity
        </p>
      )}
    </>
  ) : (
    <>
      <p className="font-medium">{isCpu ? 'CPU' : 'Memory'} usage</p>
      <p className="text-xs text-muted-foreground">
        No metrics available. Install metrics-server for live usage.
      </p>
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          className={cn('flex items-center gap-2 cursor-help', className)}
          role="presentation"
          onHoverStart={() => setIsHovered(true)}
          onHoverEnd={() => setIsHovered(false)}
          animate={isHovered ? { scale: 1.02 } : { scale: 1 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <div 
            className="flex-shrink-0 overflow-hidden rounded-sm bg-muted/80 relative"
            style={{ width: barW, height: barH }}
          >
            {hasValue ? (
              useRealSparkline ? (
                <svg width={barW} height={barH} className="overflow-visible">
                  <defs>
                    <linearGradient
                      id={sparklineGradientId}
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      {gradientStops.map((stop, i) => (
                        <stop key={i} offset={stop.offset} stopColor={fillColor} stopOpacity={stop.opacity} />
                      ))}
                    </linearGradient>
                  </defs>
                  <motion.path
                    d={areaD}
                    fill={`url(#${sparklineGradientId})`}
                    initial={shouldAnimate ? { opacity: 0 } : { opacity: 1 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                  <motion.path
                    d={pathD}
                    fill="none"
                    stroke={fillColor}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={shouldAnimate ? { pathLength: 0 } : { pathLength: 1 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                  {lastPoint && (
                    <motion.circle
                      cx={lastPoint.x}
                      cy={lastPoint.y}
                      r="2.5"
                      fill={fillColor}
                      initial={shouldAnimate ? { scale: 0 } : { scale: 1 }}
                      animate={{ 
                        scale: isHighUsage && pulseOnHigh ? [1, 1.3, 1] : 1,
                      }}
                      transition={isHighUsage && pulseOnHigh ? { duration: 1.5, repeat: Infinity } : { duration: 0.3 }}
                    />
                  )}
                </svg>
              ) : (
                <svg width={barW} height={barH} viewBox={`0 0 ${barW} ${barH}`} className="overflow-visible">
                  <defs>
                    <linearGradient
                      id={gradientId}
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      {gradientStops.map((stop, i) => (
                        <stop key={i} offset={stop.offset} stopColor={fillColor} stopOpacity={stop.opacity} />
                      ))}
                    </linearGradient>
                    {isHighUsage && pulseOnHigh && (
                      <filter id={`glow-${uniqueId.replace(/:/g, '-')}`}>
                        <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
                        <feMerge>
                          <feMergeNode in="coloredBlur"/>
                          <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                      </filter>
                    )}
                  </defs>
                  {showFill && (
                    <motion.rect
                      x={0}
                      y={fillY}
                      width={fillWidth}
                      height={fillHeight}
                      fill={`url(#${gradientId})`}
                      rx={2}
                      ry={2}
                      initial={shouldAnimate && valueChanged ? { width: 0, opacity: 0 } : false}
                      animate={{ 
                        width: fillWidth,
                        opacity: 1,
                        filter: isHighUsage && pulseOnHigh ? 'url(#glow-' + uniqueId.replace(/:/g, '-') + ')' : 'none',
                      }}
                      transition={shouldAnimate ? {
                        width: { type: 'spring', stiffness: 300, damping: 30 },
                        opacity: { duration: 0.4 },
                        filter: { duration: 0.3 },
                      } : {}}
                    />
                  )}
                </svg>
              )
            ) : (
              <div className="h-full w-full" />
            )}
          </div>
          <motion.span
            key={displayValue}
            className={cn(
              'text-xs font-medium tabular-nums min-w-0',
              hasValue
                ? isCpu
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-[hsl(142,76%,28%)] dark:text-[hsl(142,60%,42%)]'
                : 'text-muted-foreground'
            )}
            initial={shouldAnimate && valueChanged ? { opacity: 0, y: -4 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={shouldAnimate ? { duration: 0.4, ease: 'easeOut' } : {}}
          >
            {displayValue}
          </motion.span>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}
