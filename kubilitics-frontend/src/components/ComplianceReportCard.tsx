import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, XCircle, AlertTriangle, Info, FileCheck } from 'lucide-react';
import { ComplianceReport, ComplianceCheck } from '@/hooks/useComplianceCheck';

interface ComplianceReportCardProps {
  report: ComplianceReport;
  showAllChecks?: boolean;
}

export function ComplianceReportCard({
  report,
  showAllChecks = false
}: ComplianceReportCardProps) {
  const getStandardDisplayName = (standard: string) => {
    switch (standard) {
      case 'cis_kubernetes':
        return 'CIS Kubernetes Benchmark';
      case 'pod_security_standard':
        return 'Pod Security Standards';
      case 'nist':
        return 'NIST Cybersecurity Framework';
      case 'soc2':
        return 'SOC 2';
      default:
        return standard;
    }
  };

  const getComplianceGrade = (score: number) => {
    if (score >= 95) return { grade: 'A+', color: 'text-green-600' };
    if (score >= 90) return { grade: 'A', color: 'text-green-600' };
    if (score >= 85) return { grade: 'B+', color: 'text-blue-600' };
    if (score >= 80) return { grade: 'B', color: 'text-blue-600' };
    if (score >= 75) return { grade: 'C+', color: 'text-yellow-600' };
    if (score >= 70) return { grade: 'C', color: 'text-yellow-600' };
    if (score >= 65) return { grade: 'D+', color: 'text-orange-600' };
    if (score >= 60) return { grade: 'D', color: 'text-orange-600' };
    return { grade: 'F', color: 'text-red-600' };
  };

  const gradeInfo = getComplianceGrade(report.compliance_score);

  // Filter checks to show based on showAllChecks
  const checksToDisplay = showAllChecks
    ? report.checks
    : report.checks.filter(c => c.status === 'fail' || c.status === 'warning');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileCheck className="h-4 w-4" />
            Compliance Report
          </CardTitle>
          <div className={`text-3xl font-bold ${gradeInfo.color}`}>
            {gradeInfo.grade}
          </div>
        </div>

        {/* Standard Badge */}
        <div className="mt-2">
          <Badge variant="outline" className="text-xs">
            {getStandardDisplayName(report.standard)}
          </Badge>
        </div>

        {/* Compliance Score */}
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span>Compliance Score</span>
            <span className={`font-semibold ${gradeInfo.color}`}>
              {report.compliance_score.toFixed(1)}%
            </span>
          </div>
          <Progress
            value={report.compliance_score}
            className="h-2"
          />
        </div>

        {/* Check Summary */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          <div className="text-center">
            <p className="text-2xl font-bold">{report.total_checks}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{report.passed_checks}</p>
            <p className="text-xs text-muted-foreground">Passed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{report.failed_checks}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-yellow-600">{report.warning_checks}</p>
            <p className="text-xs text-muted-foreground">Warnings</p>
          </div>
        </div>

        {/* Pass Rate */}
        <div className="mt-3 p-2 bg-gray-50 rounded text-center">
          <p className="text-xs text-muted-foreground">Pass Rate</p>
          <p className="text-lg font-bold">
            {report.total_checks > 0
              ? ((report.passed_checks / report.total_checks) * 100).toFixed(1)
              : 0}%
          </p>
        </div>
      </CardHeader>

      <CardContent>
        {checksToDisplay.length > 0 ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold">
                {showAllChecks ? 'All Compliance Checks:' : 'Failed & Warning Checks:'}
              </h4>
              <p className="text-xs text-muted-foreground">
                Showing {checksToDisplay.length} of {report.checks.length}
              </p>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {checksToDisplay.map((check, idx) => (
                <ComplianceCheckCard key={idx} check={check} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-green-600">All checks passed!</p>
            <p className="text-xs text-muted-foreground mt-1">
              Fully compliant with {getStandardDisplayName(report.standard)}
            </p>
          </div>
        )}

        {/* Scan Time */}
        <div className="mt-4 pt-4 border-t text-xs text-muted-foreground text-center">
          Report generated: {new Date(report.timestamp).toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

interface ComplianceCheckCardProps {
  check: ComplianceCheck;
}

function ComplianceCheckCard({ check }: ComplianceCheckCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pass':
        return 'border-green-600 bg-green-50';
      case 'fail':
        return 'border-red-600 bg-red-50';
      case 'warning':
        return 'border-yellow-600 bg-yellow-50';
      default:
        return 'border-gray-600 bg-gray-50';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'fail':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      default:
        return <Info className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusBadgeVariant = (status: string): 'destructive' | 'default' | 'secondary' | 'outline' => {
    switch (status) {
      case 'fail':
        return 'destructive';
      case 'warning':
        return 'default';
      case 'pass':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className={`border-l-4 p-3 rounded ${getStatusColor(check.status)}`}>
      <div className="flex items-start gap-2">
        {getStatusIcon(check.status)}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-xs font-semibold">{check.id}</span>
            <Badge variant={getStatusBadgeVariant(check.status)} className="text-xs capitalize">
              {check.status.replace('_', ' ')}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {check.section}
            </Badge>
          </div>

          <p className="font-semibold text-sm mb-1">{check.title}</p>
          <p className="text-xs text-gray-700 mb-2">{check.description}</p>

          <div className="bg-white bg-opacity-50 rounded p-2 mb-2">
            <p className="text-xs font-semibold text-gray-600 mb-1">Details:</p>
            <p className="text-xs text-gray-700">{check.details}</p>
          </div>

          {check.status !== 'pass' && check.remediation && (
            <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2">
              <p className="text-xs font-semibold text-blue-800 mb-1">Remediation:</p>
              <p className="text-xs text-blue-700">{check.remediation}</p>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {check.resource && (
              <span>
                Resource: <span className="font-semibold">{check.resource}</span>
              </span>
            )}
            {check.namespace && (
              <span>
                Namespace: <span className="font-semibold">{check.namespace}</span>
              </span>
            )}
            <Badge variant="outline" className="text-xs capitalize">
              {check.severity}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
