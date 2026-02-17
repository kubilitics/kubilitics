import { AlertCircle, TrendingDown, TrendingUp, Zap, DollarSign } from 'lucide-react';
import { ResourceHealth } from '@/hooks/useResourceHealth';

interface HealthScoreBadgeProps {
  score: number;
}

export function HealthScoreBadge({ score }: HealthScoreBadgeProps) {
  const getColor = () => {
    if (score >= 80) return 'text-green-700 bg-green-100 border-green-300';
    if (score >= 60) return 'text-yellow-700 bg-yellow-100 border-yellow-300';
    if (score >= 30) return 'text-orange-700 bg-orange-100 border-orange-300';
    return 'text-red-700 bg-red-100 border-red-300';
  };

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getColor()}`}>
      <div className="w-1.5 h-1.5 rounded-full bg-current" />
      {score}%
    </div>
  );
}

interface EfficiencyBadgeProps {
  efficiency: number;
}

export function EfficiencyBadge({ efficiency }: EfficiencyBadgeProps) {
  const getIcon = () => {
    if (efficiency >= 70) return <TrendingUp className="h-3 w-3" />;
    if (efficiency >= 40) return <Zap className="h-3 w-3" />;
    return <TrendingDown className="h-3 w-3" />;
  };

  const getColor = () => {
    if (efficiency >= 70) return 'text-green-700 bg-green-50';
    if (efficiency >= 40) return 'text-yellow-700 bg-yellow-50';
    return 'text-orange-700 bg-orange-50';
  };

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${getColor()}`}>
      {getIcon()}
      {efficiency}%
    </div>
  );
}

interface FailureRiskBadgeProps {
  risk: 'low' | 'medium' | 'high' | 'critical';
}

export function FailureRiskBadge({ risk }: FailureRiskBadgeProps) {
  const getConfig = () => {
    switch (risk) {
      case 'critical':
        return {
          color: 'text-red-700 bg-red-100 border-red-300',
          label: 'Critical',
          icon: <AlertCircle className="h-3 w-3" />
        };
      case 'high':
        return {
          color: 'text-orange-700 bg-orange-100 border-orange-300',
          label: 'High',
          icon: <AlertCircle className="h-3 w-3" />
        };
      case 'medium':
        return {
          color: 'text-yellow-700 bg-yellow-100 border-yellow-300',
          label: 'Medium',
          icon: <AlertCircle className="h-3 w-3" />
        };
      case 'low':
        return {
          color: 'text-green-700 bg-green-100 border-green-300',
          label: 'Low',
          icon: <Zap className="h-3 w-3" />
        };
    }
  };

  const config = getConfig();

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${config.color}`}>
      {config.icon}
      {config.label}
    </div>
  );
}

interface CostBadgeProps {
  costPerDay: number;
}

export function CostBadge({ costPerDay }: CostBadgeProps) {
  const getColor = () => {
    if (costPerDay >= 10) return 'text-red-700 bg-red-50';
    if (costPerDay >= 5) return 'text-orange-700 bg-orange-50';
    if (costPerDay >= 1) return 'text-yellow-700 bg-yellow-50';
    return 'text-green-700 bg-green-50';
  };

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${getColor()}`}>
      <DollarSign className="h-3 w-3" />
      {costPerDay.toFixed(2)}/day
    </div>
  );
}

interface AIResourceCellProps {
  health: ResourceHealth;
  column: 'healthScore' | 'efficiency' | 'failureRisk' | 'costPerDay';
}

export function AIResourceCell({ health, column }: AIResourceCellProps) {
  switch (column) {
    case 'healthScore':
      return <HealthScoreBadge score={health.healthScore} />;
    case 'efficiency':
      return <EfficiencyBadge efficiency={health.efficiency} />;
    case 'failureRisk':
      return <FailureRiskBadge risk={health.failureRisk} />;
    case 'costPerDay':
      return <CostBadge costPerDay={health.costPerDay} />;
  }
}
