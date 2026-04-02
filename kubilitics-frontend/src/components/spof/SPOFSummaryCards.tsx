/**
 * Summary stat cards for the SPOF Inventory page.
 * Displays total, critical, high, and medium+low counts in a responsive grid.
 */
import {
  AlertTriangle,
  AlertOctagon,
  AlertCircle,
  Shield,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export interface SPOFSummaryProps {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  valueColor: string;
  bgColor: string;
  iconColor: string;
}

function StatCard({ label, value, icon: Icon, valueColor, bgColor, iconColor }: StatCardProps) {
  return (
    <Card className="border-border/40">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              {label}
            </p>
            <p className={`text-2xl font-bold mt-1 ${valueColor}`}>
              {value}
            </p>
          </div>
          <div className={`h-9 w-9 rounded-lg ${bgColor} flex items-center justify-center`}>
            <Icon className={`h-4.5 w-4.5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SPOFSummaryCards({ total, critical, high, medium, low }: SPOFSummaryProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="Total SPOFs"
        value={total}
        icon={Shield}
        valueColor="text-foreground"
        bgColor="bg-muted/50"
        iconColor="text-muted-foreground"
      />
      <StatCard
        label="Critical"
        value={critical}
        icon={AlertOctagon}
        valueColor="text-red-500"
        bgColor="bg-red-500/10"
        iconColor="text-red-500"
      />
      <StatCard
        label="High"
        value={high}
        icon={AlertTriangle}
        valueColor="text-orange-500"
        bgColor="bg-orange-500/10"
        iconColor="text-orange-500"
      />
      <StatCard
        label="Medium + Low"
        value={medium + low}
        icon={AlertCircle}
        valueColor="text-yellow-500"
        bgColor="bg-yellow-500/10"
        iconColor="text-yellow-500"
      />
    </div>
  );
}
