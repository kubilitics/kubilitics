import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoadingState } from '@/components/PageLoadingState';
import { ServiceUnavailableBanner } from '@/components/ServiceUnavailableBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  RefreshCw,
  Download,
  Search
} from 'lucide-react';
import { VulnerabilityScanResults } from '@/components/VulnerabilityScanResults';
import { SecurityIssuesPanel } from '@/components/SecurityIssuesPanel';
import { ComplianceReportCard } from '@/components/ComplianceReportCard';
import { useSecurityScan } from '@/hooks/useSecurityScan';
import { useSecurityAnalysis } from '@/hooks/useSecurityAnalysis';
import { useComplianceCheck } from '@/hooks/useComplianceCheck';
import { AI_BASE_URL } from '@/services/aiService';

// Security endpoints (/api/v1/security/*) live on the AI backend (port 8081).
const API_BASE = AI_BASE_URL;

interface SecurityPosture {
  overall_score: number;
  overall_grade: string;
  vulnerability_summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  security_issues: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  compliance_score: number;
  recommendations: string[];
}

export function SecurityDashboard() {
  const [securityPosture, setSecurityPosture] = useState<SecurityPosture | null>(null);
  const [isLoadingPosture, setIsLoadingPosture] = useState(true);
  const [selectedImage, setSelectedImage] = useState('nginx:1.19');
  const [activeTab, setActiveTab] = useState('overview');

  // Example usage of hooks
  const { scanResult, isLoading: isScanLoading, scan } = useSecurityScan();
  const { analysisResult, isLoading: isAnalysisLoading, analyzePod } = useSecurityAnalysis();
  const { report: complianceReport, isLoading: isComplianceLoading, checkPod } = useComplianceCheck({
    standard: 'cis_kubernetes'
  });

  // Fetch overall security posture
  useEffect(() => {
    fetchSecurityPosture();
  }, []);

  const fetchSecurityPosture = async () => {
    setIsLoadingPosture(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/security/posture`);
      if (response.ok) {
        const data = await response.json();
        setSecurityPosture(data);
      }
    } catch (error) {
      console.error('Failed to fetch security posture:', error);
    } finally {
      setIsLoadingPosture(false);
    }
  };

  const handleScanImage = async () => {
    await scan(selectedImage);
  };

  const handleAnalyzePod = async () => {
    await analyzePod({
      name: 'example-pod',
      namespace: 'default',
      run_as_non_root: false,
      privileged: true,
      allow_privilege_escalation: true,
    });
  };

  const handleComplianceCheck = async () => {
    await checkPod({
      name: 'example-pod',
      namespace: 'default',
      privileged: true,
      run_as_non_root: false,
      capabilities: {
        add: ['NET_ADMIN'],
        drop: []
      }
    });
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return 'text-green-600';
      case 'B': return 'text-blue-600';
      case 'C': return 'text-yellow-600';
      case 'D': return 'text-orange-600';
      case 'F': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  if (isLoadingPosture && !securityPosture) {
    return <PageLoadingState message="Loading security posture..." />;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Network Error Banner */}
      {!securityPosture && !isLoadingPosture && (
        <ServiceUnavailableBanner
          serviceName="Security Service"
          message="Failed to load security posture. The AI backend might be unreachable."
          retryAction={fetchSecurityPosture}
          isRetrying={isLoadingPosture}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8 text-blue-600" />
            Security Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Comprehensive security monitoring and compliance for your Kubernetes cluster
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={fetchSecurityPosture}
            disabled={isLoadingPosture}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingPosture ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {securityPosture ? (
        <>
          {/* Security Posture Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Overall Score */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Security Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className={`text-4xl font-bold ${getGradeColor(securityPosture.overall_grade)}`}>
                    {securityPosture.overall_grade}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold">{securityPosture.overall_score}</p>
                    <p className="text-xs text-muted-foreground">out of 100</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Vulnerabilities */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Vulnerabilities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-red-600 font-semibold">Critical</span>
                    <span className="font-bold">{securityPosture.vulnerability_summary.critical}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-orange-600 font-semibold">High</span>
                    <span className="font-bold">{securityPosture.vulnerability_summary.high}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-yellow-600">Medium</span>
                    <span>{securityPosture.vulnerability_summary.medium}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-blue-600">Low</span>
                    <span>{securityPosture.vulnerability_summary.low}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Security Issues */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Security Issues
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-red-600 font-semibold">Critical</span>
                    <span className="font-bold">{securityPosture.security_issues.critical}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-orange-600 font-semibold">High</span>
                    <span className="font-bold">{securityPosture.security_issues.high}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-yellow-600">Medium</span>
                    <span>{securityPosture.security_issues.medium}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-blue-600">Low</span>
                    <span>{securityPosture.security_issues.low}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Compliance */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Compliance Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <p className="text-4xl font-bold text-blue-600">
                    {securityPosture.compliance_score.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    CIS Kubernetes Benchmark
                  </p>
                  <Badge variant="outline" className="mt-2">
                    {securityPosture.compliance_score >= 90 ? 'Excellent' :
                      securityPosture.compliance_score >= 75 ? 'Good' :
                        securityPosture.compliance_score >= 60 ? 'Fair' : 'Needs Improvement'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Recommendations */}
          {securityPosture.recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Top Security Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {securityPosture.recommendations.map((rec, idx) => (
                    <div key={idx} className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                      <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm">{rec}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabs for Different Security Aspects */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="vulnerabilities">Vulnerabilities</TabsTrigger>
              <TabsTrigger value="security-issues">Security Issues</TabsTrigger>
              <TabsTrigger value="compliance">Compliance</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Quick Scan Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Quick Image Scan</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={selectedImage}
                        onChange={(e) => setSelectedImage(e.target.value)}
                        placeholder="Enter image name (e.g., nginx:1.19)"
                        className="flex-1 px-3 py-2 border rounded text-sm bg-background"
                      />
                      <Button onClick={handleScanImage} disabled={isScanLoading}>
                        <Search className="h-4 w-4 mr-2" />
                        Scan
                      </Button>
                    </div>
                    {isScanLoading && (
                      <p className="text-sm text-muted-foreground">Scanning image...</p>
                    )}
                  </CardContent>
                </Card>

                {/* Quick Actions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={handleAnalyzePod}
                      disabled={isAnalysisLoading}
                    >
                      <Shield className="h-4 w-4 mr-2" />
                      Analyze Pod Security (Demo)
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={handleComplianceCheck}
                      disabled={isComplianceLoading}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Run Compliance Check (Demo)
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Results */}
              <div className="grid grid-cols-1 gap-4">
                {scanResult && (
                  <VulnerabilityScanResults scanResult={scanResult} showDetails={true} />
                )}
                {analysisResult && (
                  <SecurityIssuesPanel analysisResult={analysisResult} resourceType="pod" />
                )}
                {complianceReport && (
                  <ComplianceReportCard report={complianceReport} showAllChecks={false} />
                )}
              </div>
            </TabsContent>

            {/* Vulnerabilities Tab */}
            <TabsContent value="vulnerabilities" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Container Image Vulnerabilities</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Scan container images for known CVE vulnerabilities
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={selectedImage}
                      onChange={(e) => setSelectedImage(e.target.value)}
                      placeholder="Enter image name (e.g., nginx:1.19)"
                      className="flex-1 px-3 py-2 border rounded bg-background"
                    />
                    <Button onClick={handleScanImage} disabled={isScanLoading}>
                      {isScanLoading ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Scanning...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4 mr-2" />
                          Scan Image
                        </>
                      )}
                    </Button>
                  </div>

                  {scanResult && (
                    <VulnerabilityScanResults scanResult={scanResult} showDetails={true} />
                  )}

                  {!scanResult && !isScanLoading && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Enter an image name and click "Scan Image" to see vulnerability results</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Security Issues Tab */}
            <TabsContent value="security-issues" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Pod Security Analysis</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Analyze Kubernetes pod configurations for security best practices
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button onClick={handleAnalyzePod} disabled={isAnalysisLoading}>
                    {isAnalysisLoading ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Shield className="h-4 w-4 mr-2" />
                        Analyze Example Pod
                      </>
                    )}
                  </Button>

                  {analysisResult && (
                    <SecurityIssuesPanel analysisResult={analysisResult} resourceType="pod" />
                  )}

                  {!analysisResult && !isAnalysisLoading && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Click "Analyze Example Pod" to see security analysis results</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Compliance Tab */}
            <TabsContent value="compliance" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">CIS Kubernetes Benchmark Compliance</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Check compliance with CIS Kubernetes security benchmarks
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button onClick={handleComplianceCheck} disabled={isComplianceLoading}>
                    {isComplianceLoading ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Run Compliance Check
                      </>
                    )}
                  </Button>

                  {complianceReport && (
                    <ComplianceReportCard report={complianceReport} showAllChecks={true} />
                  )}

                  {!complianceReport && !isComplianceLoading && (
                    <div className="text-center py-12 text-muted-foreground">
                      <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Click "Run Compliance Check" to see CIS benchmark results</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : (
        // Empty state when posture fails to load
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <Shield className="h-16 w-16 mb-4 opacity-20" />
          <p className="text-lg font-medium">Security Data Unavailable</p>
          <p className="text-sm mt-2 max-w-md">
            The security posture could not be loaded. Ensure the backend is running and reachable.
          </p>
          <Button variant="outline" className="mt-4" onClick={fetchSecurityPosture}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
