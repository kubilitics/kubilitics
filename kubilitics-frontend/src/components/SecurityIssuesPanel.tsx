import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, Shield, CheckCircle2, Info, XCircle } from 'lucide-react';
import { SecurityAnalysisResult, SecurityIssue } from '@/hooks/useSecurityAnalysis';

interface SecurityIssuesPanelProps {
  analysisResult: SecurityAnalysisResult;
  resourceType?: 'pod' | 'rbac';
}

export function SecurityIssuesPanel({
  analysisResult,
  resourceType = 'pod'
}: SecurityIssuesPanelProps) {
  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A':
        return 'text-green-600';
      case 'B':
        return 'text-blue-600';
      case 'C':
        return 'text-yellow-600';
      case 'D':
        return 'text-orange-600';
      case 'F':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 80) return 'text-blue-600';
    if (score >= 70) return 'text-yellow-600';
    if (score >= 60) return 'text-orange-600';
    return 'text-red-600';
  };

  const getProgressColor = (score: number) => {
    if (score >= 90) return 'bg-green-600';
    if (score >= 80) return 'bg-blue-600';
    if (score >= 70) return 'bg-yellow-600';
    if (score >= 60) return 'bg-orange-600';
    return 'bg-red-600';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security Analysis - {resourceType === 'pod' ? 'Pod' : 'RBAC'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className={`text-3xl font-bold ${getGradeColor(analysisResult.grade)}`}>
              {analysisResult.grade}
            </div>
          </div>
        </div>

        {/* Security Score */}
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span>Security Score</span>
            <span className={`font-semibold ${getScoreColor(analysisResult.score)}`}>
              {analysisResult.score}/100
            </span>
          </div>
          <Progress
            value={analysisResult.score}
            className="h-2"
          />
        </div>

        {/* Issue Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          <div className="text-center">
            <p className="text-2xl font-bold">{analysisResult.summary.total}</p>
            <p className="text-xs text-muted-foreground">Total Issues</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{analysisResult.summary.critical}</p>
            <p className="text-xs text-muted-foreground">Critical</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-orange-600">{analysisResult.summary.high}</p>
            <p className="text-xs text-muted-foreground">High</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-yellow-600">{analysisResult.summary.medium}</p>
            <p className="text-xs text-muted-foreground">Medium</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{analysisResult.summary.low}</p>
            <p className="text-xs text-muted-foreground">Low</p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {analysisResult.issues.length > 0 ? (
          <>
            <h4 className="text-xs font-semibold mb-3">Security Issues Found:</h4>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {analysisResult.issues.map((issue, idx) => (
                <SecurityIssueCard key={idx} issue={issue} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-green-600">No security issues found!</p>
            <p className="text-xs text-muted-foreground mt-1">
              This {resourceType} configuration follows security best practices
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface SecurityIssueCardProps {
  issue: SecurityIssue;
}

function SecurityIssueCard({ issue }: SecurityIssueCardProps) {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-red-600 bg-red-50';
      case 'high':
        return 'border-orange-600 bg-orange-50';
      case 'medium':
        return 'border-yellow-600 bg-yellow-50';
      case 'low':
        return 'border-blue-600 bg-blue-50';
      default:
        return 'border-gray-600 bg-gray-50';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'high':
        return <AlertTriangle className="h-4 w-4 text-orange-600" />;
      case 'medium':
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      case 'low':
        return <Info className="h-4 w-4 text-blue-600" />;
      default:
        return <Info className="h-4 w-4 text-gray-600" />;
    }
  };

  const getSeverityBadgeVariant = (severity: string): 'destructive' | 'default' | 'secondary' | 'outline' => {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      default:
        return 'secondary';
    }
  };

  return (
    <div className={`border-l-4 p-3 rounded ${getSeverityColor(issue.severity)}`}>
      <div className="flex items-start gap-2">
        {getSeverityIcon(issue.severity)}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm">{issue.title}</span>
            <Badge variant={getSeverityBadgeVariant(issue.severity)} className="text-xs capitalize">
              {issue.severity}
            </Badge>
            <Badge variant="outline" className="text-xs capitalize">
              {issue.type.replace('_', ' ')}
            </Badge>
          </div>

          <p className="text-xs text-gray-700 mb-2">{issue.description}</p>

          <div className="bg-white bg-opacity-50 rounded p-2 mb-2">
            <p className="text-xs font-semibold text-gray-600 mb-1">Remediation:</p>
            <p className="text-xs text-gray-700">{issue.remediation}</p>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              Resource: <span className="font-semibold">{issue.resource}</span>
            </span>
            {issue.namespace && (
              <span>
                Namespace: <span className="font-semibold">{issue.namespace}</span>
              </span>
            )}
            <span>
              {new Date(issue.timestamp).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
