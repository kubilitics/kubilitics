import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { SecurityRadar } from '@/components/security/SecurityRadar';
import { ComplianceMedal } from '@/components/security/ComplianceMedal';

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

  // Hooks
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

  const handleScanImage = async () => await scan(selectedImage);
  const handleAnalyzePod = async () => await analyzePod({ name: 'example-pod', namespace: 'default', run_as_non_root: false, privileged: true, allow_privilege_escalation: true });
  const handleComplianceCheck = async () => await checkPod({ name: 'example-pod', namespace: 'default', privileged: true, run_as_non_root: false, capabilities: { add: ['NET_ADMIN'], drop: [] } });

  return (
    <div className="flex flex-col gap-6 p-6">
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
      <SectionOverviewHeader
        title="Security Dashboard"
        description="Comprehensive security monitoring and compliance for your Kubernetes cluster"
        icon={Shield}
        onSync={fetchSecurityPosture}
        isSyncing={isLoadingPosture}
        extraActions={
          <Button variant="outline" className="h-10">
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        }
      />

      {securityPosture ? (
        <div className="flex flex-col gap-6">
          {/* Hero Section: Radar + Medal + Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Visual Intelligence: Radar & Briefing */}
            <Card className="lg:col-span-8 overflow-hidden border-[#326CE5]/10 shadow-sm bg-white/50 backdrop-blur-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-0">
                <div>
                  <CardTitle className="text-xl font-black text-[#326CE5]">Security Intelligence</CardTitle>
                  <p className="text-xs text-muted-foreground font-medium">Real-time vulnerability distribution & risk assessment</p>
                </div>
                <Badge variant="outline" className="border-[#326CE5]/20 text-[#326CE5] px-3 font-bold">
                  AI Analyzed
                </Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  <SecurityRadar data={securityPosture?.vulnerability_summary} />

                  <div className="space-y-6 px-4">
                    <div className="space-y-2">
                      <h4 className="text-xs font-black uppercase tracking-widest text-[#326CE5]/60">Critical Briefing</h4>
                      <p className="text-sm font-medium leading-relaxed">
                        Your cluster has <span className="text-red-600 font-black">{securityPosture?.vulnerability_summary?.critical ?? 0} critical vulnerabilities</span>.
                        Immediate patching is recommended for images tagged as "latest" or older than 30 days.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10">
                        <span className="block text-2xl font-black text-[#326CE5]">{securityPosture?.vulnerability_summary?.high ?? 0}</span>
                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">High Risk</span>
                      </div>
                      <div className="p-3 rounded-2xl bg-[#326CE5]/5 border border-[#326CE5]/10">
                        <span className="block text-2xl font-black text-[#326CE5]">
                          {(securityPosture?.security_issues?.critical ?? 0) + (securityPosture?.security_issues?.high ?? 0)}
                        </span>
                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-tighter">Config Issues</span>
                      </div>
                    </div>

                    <Button variant="default" className="w-full bg-[#326CE5] hover:bg-[#2856b3] shadow-md shadow-[#326CE5]/20 py-6 text-sm font-bold rounded-2xl transition-all active:scale-95">
                      Generate Detailed Audit
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Compliance Standing & Fast Path */}
            <Card className="lg:col-span-4 border-[#326CE5]/10 shadow-sm flex flex-col items-center justify-center p-8 bg-white/50 backdrop-blur-sm relative overflow-hidden group">
              {/* Subtle Background Watermark */}
              <Shield className="absolute -bottom-10 -right-10 w-48 h-48 opacity-[0.02] text-[#326CE5] rotate-12" />

              <ComplianceMedal
                grade={securityPosture?.overall_grade || 'F'}
                score={securityPosture?.overall_score ?? 0}
              />

              <div className="mt-8 pt-8 border-t border-slate-100 w-full space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground italic">Last verified 2m ago</span>
                  <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100 text-[10px] font-black uppercase">Verified</Badge>
                </div>
                <Button variant="outline" className="w-full h-12 border-[#326CE5]/20 text-[#326CE5] font-bold hover:bg-[#326CE5]/5 rounded-xl transition-all">
                  View Compliance Roadmap
                </Button>
              </div>
            </Card>
          </div>

          {/* Top Recommendations */}
          {(securityPosture?.recommendations?.length ?? 0) > 0 && (
            <Card className="border-[#326CE5]/10 shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-black flex items-center gap-2 text-[#326CE5]">
                  <TrendingUp className="h-4 w-4" />
                  PROACTIVE RECOMMENDATIONS
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {securityPosture.recommendations.map((rec, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-xl hover:bg-[#326CE5]/5 transition-colors border border-transparent hover:border-[#326CE5]/10">
                      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm font-medium">{rec}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Deep Dive Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="bg-slate-100/50 p-1 rounded-xl w-fit">
              <TabsTrigger value="overview" className="rounded-lg px-6 font-bold data-[state=active]:bg-white data-[state=active]:text-[#326CE5] data-[state=active]:shadow-sm">Overview</TabsTrigger>
              <TabsTrigger value="vulnerabilities" className="rounded-lg px-6 font-bold data-[state=active]:bg-white data-[state=active]:text-[#326CE5] data-[state=active]:shadow-sm">Vulnerabilities</TabsTrigger>
              <TabsTrigger value="security-issues" className="rounded-lg px-6 font-bold data-[state=active]:bg-white data-[state=active]:text-[#326CE5] data-[state=active]:shadow-sm">Issues</TabsTrigger>
              <TabsTrigger value="compliance" className="rounded-lg px-6 font-bold data-[state=active]:bg-white data-[state=active]:text-[#326CE5] data-[state=active]:shadow-sm">Compliance</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-[#326CE5]/5 shadow-sm">
                  <CardHeader><CardTitle className="text-sm font-bold">Quick Image Scan</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={selectedImage}
                        onChange={(e) => setSelectedImage(e.target.value)}
                        placeholder="e.g. nginx:latest"
                        className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-sm bg-background focus:ring-2 focus:ring-[#326CE5]/20 focus:outline-none transition-all"
                      />
                      <Button onClick={handleScanImage} disabled={isScanLoading} className="bg-[#326CE5] rounded-xl px-6">
                        {isScanLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                        Scan
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-[#326CE5]/5 shadow-sm">
                  <CardHeader><CardTitle className="text-sm font-bold">System Actions</CardTitle></CardHeader>
                  <CardContent className="flex gap-3">
                    <Button variant="outline" onClick={handleAnalyzePod} disabled={isAnalysisLoading} className="flex-1 h-12 rounded-xl border-[#326CE5]/10 text-[#326CE5] font-bold">
                      Analyze Demo Pod
                    </Button>
                    <Button variant="outline" onClick={handleComplianceCheck} disabled={isComplianceLoading} className="flex-1 h-12 rounded-xl border-[#326CE5]/10 text-[#326CE5] font-bold">
                      Run Compliance
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {scanResult && <VulnerabilityScanResults scanResult={scanResult} showDetails={true} />}
                {analysisResult && <SecurityIssuesPanel analysisResult={analysisResult} resourceType="pod" />}
                {complianceReport && <ComplianceReportCard report={complianceReport} showAllChecks={false} />}
              </div>
            </TabsContent>

            <TabsContent value="vulnerabilities" className="mt-6">
              <Card className="border-[#326CE5]/5">
                <CardContent className="pt-6">
                  {scanResult ? <VulnerabilityScanResults scanResult={scanResult} showDetails={true} /> :
                    <div className="py-20 text-center"><Shield className="h-12 w-12 mx-auto mb-4 opacity-10" /><p className="text-muted-foreground font-medium">No scan data available. Start a scan to view results.</p></div>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security-issues" className="mt-6">
              <Card className="border-[#326CE5]/5">
                <CardContent className="pt-6">
                  {analysisResult ? <SecurityIssuesPanel analysisResult={analysisResult} resourceType="pod" /> :
                    <div className="py-20 text-center"><AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-10" /><p className="text-muted-foreground font-medium">No analysis data available. Run a pod analysis to view results.</p></div>}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="compliance" className="mt-6">
              <Card className="border-[#326CE5]/5">
                <CardContent className="pt-6">
                  {complianceReport ? <ComplianceReportCard report={complianceReport} showAllChecks={true} /> :
                    <div className="py-20 text-center"><CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-10" /><p className="text-muted-foreground font-medium">No report available. Run compliance check to view results.</p></div>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="h-[400px] flex flex-col items-center justify-center text-center">
          <Shield className="h-16 w-16 mb-6 text-[#326CE5]/20 animate-pulse" />
          <h3 className="text-xl font-black text-[#326CE5]">Initializing Security Shield</h3>
          <p className="text-sm text-muted-foreground mt-2 font-medium">Aggregating cluster-wide security telemetry...</p>
          <Button variant="outline" className="mt-6 border-[#326CE5]/20 text-[#326CE5] font-bold" onClick={fetchSecurityPosture}>
            Force Refresh
          </Button>
        </div>
      )}
    </div>
  );
}
