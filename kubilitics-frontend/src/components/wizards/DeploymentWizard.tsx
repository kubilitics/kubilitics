import { useState, useMemo, useEffect } from 'react';
import { ResourceWizard, WizardStep } from './ResourceWizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, X, Sparkles, Zap, AlertTriangle, CheckCircle2, Info, DollarSign, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useCreateK8sResource } from '@/hooks/useKubernetes';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';
import { useWizardAISuggestions, type ResourceSuggestion, type ValidationIssue } from '@/hooks/useWizardAISuggestions';
import { cn } from '@/lib/utils';

interface DeploymentWizardProps {
  onClose: () => void;
  onSubmit?: (yaml: string) => void;
}

interface ContainerConfig {
  name: string;
  image: string;
  port: string;
  cpu: string;
  memory: string;
}

interface LabelEntry {
  key: string;
  value: string;
}

// ─── AI Suggestion Panel ──────────────────────────────────────────────────────

interface AISuggestionPanelProps {
  image: string;
  namespace: string;
  replicas: number;
  currentCpu: string;
  currentMemory: string;
  onApply: (s: ResourceSuggestion) => void;
}

function AISuggestionPanel({ image, namespace, replicas, currentCpu, currentMemory, onApply }: AISuggestionPanelProps) {
  const { suggestion, suggesting, error, suggest } = useWizardAISuggestions();
  const [open, setOpen] = useState(false);

  const confidence = suggestion?.suggestion.confidence;
  const confBadge =
    confidence === 'high'
      ? 'bg-emerald-100 text-emerald-700'
      : confidence === 'medium'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-600';

  const handleSuggest = () => {
    setOpen(true);
    suggest({ image, namespace, replicas, existingCpu: currentCpu, existingMemory: currentMemory });
  };

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-indigo-50 transition-colors"
        onClick={() => {
          if (!open) handleSuggest();
          else setOpen(v => !v);
        }}
      >
        <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" />
        <span className="text-sm font-semibold text-indigo-700">AI Resource Suggestions</span>
        {confidence && (
          <span className={cn('ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0', confBadge)}>
            {confidence} confidence
          </span>
        )}
        {!suggestion && !suggesting && (
          <span className="ml-auto text-xs text-indigo-500 shrink-0">Click to suggest</span>
        )}
        {open ? <ChevronUp className="h-4 w-4 text-indigo-400 shrink-0 ml-1" /> : <ChevronDown className="h-4 w-4 text-indigo-400 shrink-0 ml-1" />}
      </button>

      {open && (
        <div className="border-t border-indigo-200 px-4 py-4 space-y-3">
          {suggesting && (
            <div className="flex items-center gap-2 text-sm text-indigo-600">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Analyzing {image || 'image'}…
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
              <Button size="sm" variant="ghost" className="h-6 text-xs ml-auto" onClick={handleSuggest}>Retry</Button>
            </div>
          )}

          {suggestion && !suggesting && (
            <>
              <div className="text-xs text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2 flex gap-2">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-indigo-500" />
                <span>{suggestion.rationale}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'CPU Request', value: suggestion.suggestion.cpu_request },
                  { label: 'CPU Limit', value: suggestion.suggestion.cpu_limit },
                  { label: 'Memory Request', value: suggestion.suggestion.memory_request },
                  { label: 'Memory Limit', value: suggestion.suggestion.memory_limit },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-white border border-indigo-100 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">{label}</p>
                    <p className="text-sm font-mono font-bold text-indigo-700">{value}</p>
                  </div>
                ))}
              </div>

              {suggestion.suggestion.replicas > 0 && (
                <div className="flex items-center gap-2 text-xs text-indigo-600">
                  <Zap className="h-3.5 w-3.5 shrink-0" />
                  Suggested replicas: <span className="font-bold">{suggestion.suggestion.replicas}</span>
                </div>
              )}

              {suggestion.cost_estimate && (
                <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
                  <DollarSign className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Estimated: <strong>${suggestion.cost_estimate.monthly_total_usd}/month</strong>
                    {' '}(CPU: ${suggestion.cost_estimate.monthly_cpu_cost_usd} + Mem: ${suggestion.cost_estimate.monthly_mem_cost_usd})
                    {' '}for {suggestion.cost_estimate.replicas} replica{suggestion.cost_estimate.replicas > 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {suggestion.similar_images && suggestion.similar_images.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Similar: {suggestion.similar_images.join(' · ')}
                </div>
              )}

              <Button
                size="sm"
                className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700"
                onClick={() => onApply(suggestion.suggestion)}
              >
                <CheckCircle2 className="h-4 w-4" />
                Apply Suggestions to Container
              </Button>
            </>
          )}

          {!suggestion && !suggesting && !error && (
            <div className="text-xs text-muted-foreground">
              Enter an image name then click "AI Resource Suggestions" to get tailored recommendations.
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs w-full text-indigo-500"
            onClick={handleSuggest}
            disabled={suggesting || !image?.trim()}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh suggestions
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── AI Validation Panel ──────────────────────────────────────────────────────

function severityIcon(s: ValidationIssue['severity']) {
  if (s === 'error') return <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />;
  if (s === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />;
  return <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />;
}

interface AIValidationPanelProps {
  containers: ContainerConfig[];
  replicas: string;
  namespace: string;
}

function AIValidationPanel({ containers, replicas, namespace }: AIValidationPanelProps) {
  const { validation, validating, error, validate } = useWizardAISuggestions();

  useEffect(() => {
    if (containers.some(c => c.image)) {
      validate({
        resourceKind: 'Deployment',
        containers: containers.map(c => ({
          name: c.name || 'container',
          image: c.image,
          cpu: c.cpu,
          memory: c.memory,
          port: c.port,
          has_probes: false,
          run_as_root: false,
        })),
        replicas: parseInt(replicas) || 1,
        namespace,
      });
    }
    // Only re-run when containers length / replicas / namespace changes (not every keystroke)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers.length, replicas, namespace]);

  const scoreColor = !validation ? 'text-slate-400'
    : validation.score >= 80 ? 'text-emerald-600'
    : validation.score >= 60 ? 'text-amber-600'
    : 'text-red-600';

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
        <CheckCircle2 className="h-4 w-4 text-slate-500 shrink-0" />
        <span className="text-sm font-semibold text-slate-700">AI Configuration Check</span>
        {validating && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400 ml-auto" />}
        {validation && !validating && (
          <span className={cn('ml-auto text-lg font-black', scoreColor)}>
            {validation.score}/100
          </span>
        )}
      </div>
      <div className="p-4 space-y-2">
        {validating && !validation && <p className="text-xs text-muted-foreground">Checking configuration…</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {validation && !validating && (
          <>
            <p className="text-xs text-muted-foreground">{validation.summary}</p>
            {validation.issues.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                No issues found — configuration looks great!
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {validation.issues.map((issue, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded-lg px-3 py-2 text-xs flex gap-2',
                      issue.severity === 'error' ? 'bg-red-50 border border-red-200'
                        : issue.severity === 'warning' ? 'bg-amber-50 border border-amber-200'
                        : 'bg-blue-50 border border-blue-100',
                    )}
                  >
                    {severityIcon(issue.severity)}
                    <div className="space-y-0.5 min-w-0">
                      <p className={cn(
                        'font-semibold',
                        issue.severity === 'error' ? 'text-red-700'
                          : issue.severity === 'warning' ? 'text-amber-700'
                          : 'text-blue-700',
                      )}>
                        {issue.message}
                      </p>
                      <p className="text-muted-foreground">{issue.fix}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export function DeploymentWizard({ onClose, onSubmit }: DeploymentWizardProps) {
  const { config } = useKubernetesConfigStore();
  const createResource = useCreateK8sResource('deployments');

  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('default');
  const [replicas, setReplicas] = useState('1');
  const [labels, setLabels] = useState<LabelEntry[]>([{ key: 'app', value: '' }]);
  const [containers, setContainers] = useState<ContainerConfig[]>([
    { name: '', image: '', port: '80', cpu: '100m', memory: '128Mi' },
  ]);
  const [strategy, setStrategy] = useState('RollingUpdate');

  const addLabel = () => setLabels([...labels, { key: '', value: '' }]);
  const removeLabel = (index: number) => setLabels(labels.filter((_, i) => i !== index));
  const updateLabel = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...labels];
    updated[index][field] = value;
    setLabels(updated);
  };

  const addContainer = () =>
    setContainers([...containers, { name: '', image: '', port: '80', cpu: '100m', memory: '128Mi' }]);
  const removeContainer = (index: number) => setContainers(containers.filter((_, i) => i !== index));
  const updateContainer = (index: number, field: keyof ContainerConfig, value: string) => {
    const updated = [...containers];
    updated[index][field] = value;
    setContainers(updated);
  };

  const applyAISuggestion = (containerIndex: number, s: ResourceSuggestion) => {
    const updated = [...containers];
    updated[containerIndex] = { ...updated[containerIndex], cpu: s.cpu_request, memory: s.memory_request };
    setContainers(updated);
    if (s.replicas > 0 && parseInt(replicas) === 1) {
      setReplicas(String(s.replicas));
    }
  };

  const yaml = useMemo(() => {
    const labelsObj = labels.reduce((acc, l) => {
      if (l.key) acc[l.key] = l.value || name || 'app';
      return acc;
    }, {} as Record<string, string>);

    const containersYaml = containers
      .map(
        (c) => `      - name: ${c.name || 'container'}
        image: ${c.image || 'nginx:latest'}
        ports:
          - containerPort: ${c.port || 80}
        resources:
          requests:
            cpu: ${c.cpu || '100m'}
            memory: ${c.memory || '128Mi'}
          limits:
            cpu: ${c.cpu || '100m'}
            memory: ${c.memory || '128Mi'}`
      )
      .join('\n');

    const labelsYaml = Object.entries(labelsObj)
      .map(([k, v]) => `    ${k}: ${v}`)
      .join('\n');

    return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name || 'my-deployment'}
  namespace: ${namespace}
  labels:
${labelsYaml}
spec:
  replicas: ${replicas}
  strategy:
    type: ${strategy}
  selector:
    matchLabels:
${labelsYaml}
  template:
    metadata:
      labels:
${labelsYaml}
    spec:
      containers:
${containersYaml}`;
  }, [name, namespace, replicas, labels, containers, strategy]);

  const steps: WizardStep[] = [
    {
      id: 'basic',
      title: 'Basic Info',
      description: 'Set the deployment name, namespace, and replicas',
      isValid: name.length > 0,
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Deployment Name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-deployment" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="namespace">Namespace</Label>
              <Select value={namespace} onValueChange={setNamespace}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">default</SelectItem>
                  <SelectItem value="production">production</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                  <SelectItem value="development">development</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="replicas">Replicas</Label>
              <Input id="replicas" type="number" min="1" value={replicas} onChange={(e) => setReplicas(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy">Update Strategy</Label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RollingUpdate">Rolling Update</SelectItem>
                  <SelectItem value="Recreate">Recreate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'labels',
      title: 'Labels',
      description: 'Define labels for resource identification',
      content: (
        <div className="space-y-4">
          {labels.map((label, index) => (
            <div key={index} className="flex items-center gap-3">
              <Input placeholder="Key" value={label.key} onChange={(e) => updateLabel(index, 'key', e.target.value)} className="flex-1" />
              <span className="text-muted-foreground">=</span>
              <Input placeholder="Value" value={label.value} onChange={(e) => updateLabel(index, 'value', e.target.value)} className="flex-1" />
              {labels.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeLabel(index)}><X className="h-4 w-4" /></Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addLabel} className="gap-1.5">
            <Plus className="h-4 w-4" />Add Label
          </Button>
        </div>
      ),
    },
    {
      id: 'containers',
      title: 'Containers',
      description: 'Configure container images and resources — use AI Suggest for smart sizing',
      isValid: containers.every((c) => c.name && c.image),
      content: (
        <div className="space-y-4">
          {containers.map((container, index) => (
            <Card key={index}>
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">Container {index + 1}</Badge>
                  {containers.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeContainer(index)}><X className="h-4 w-4" /></Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input value={container.name} onChange={(e) => updateContainer(index, 'name', e.target.value)} placeholder="container-name" />
                  </div>
                  <div className="space-y-2">
                    <Label>Image *</Label>
                    <Input value={container.image} onChange={(e) => updateContainer(index, 'image', e.target.value)} placeholder="nginx:latest" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input value={container.port} onChange={(e) => updateContainer(index, 'port', e.target.value)} placeholder="80" />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">CPU <span className="text-[10px] text-muted-foreground font-normal">(req=limit)</span></Label>
                    <Input
                      value={container.cpu}
                      onChange={(e) => updateContainer(index, 'cpu', e.target.value)}
                      placeholder="100m"
                      className={container.cpu !== '100m' ? 'border-indigo-300 bg-indigo-50/30' : ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1">Memory <span className="text-[10px] text-muted-foreground font-normal">(req=limit)</span></Label>
                    <Input
                      value={container.memory}
                      onChange={(e) => updateContainer(index, 'memory', e.target.value)}
                      placeholder="128Mi"
                      className={container.memory !== '128Mi' ? 'border-indigo-300 bg-indigo-50/30' : ''}
                    />
                  </div>
                </div>

                {/* AI Suggestion Panel — E-PLAT-006 */}
                <AISuggestionPanel
                  image={container.image}
                  namespace={namespace}
                  replicas={parseInt(replicas) || 1}
                  currentCpu={container.cpu}
                  currentMemory={container.memory}
                  onApply={(s) => applyAISuggestion(index, s)}
                />
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" size="sm" onClick={addContainer} className="gap-1.5">
            <Plus className="h-4 w-4" />Add Container
          </Button>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Review your deployment configuration and AI validation',
      content: (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground">Name</p><p className="font-medium">{name || 'my-deployment'}</p></div>
                <div><p className="text-muted-foreground">Namespace</p><p className="font-medium">{namespace}</p></div>
                <div><p className="text-muted-foreground">Replicas</p><p className="font-medium">{replicas}</p></div>
                <div><p className="text-muted-foreground">Strategy</p><p className="font-medium">{strategy}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground mb-2">Containers</p>
              <div className="space-y-2">
                {containers.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{c.name || 'container'}</Badge>
                    <span className="text-sm font-mono">{c.image || 'nginx:latest'}</span>
                    <span className="text-xs text-muted-foreground ml-auto">CPU: {c.cpu} · Mem: {c.memory}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* AI Validation Panel — E-PLAT-006 */}
          <AIValidationPanel containers={containers} replicas={replicas} namespace={namespace} />
        </div>
      ),
    },
  ];

  const handleSubmit = async () => {
    if (config.isConnected) {
      await createResource.mutateAsync({ yaml, namespace });
    }
    onSubmit?.(yaml);
    onClose();
  };

  return (
    <ResourceWizard
      title="Create Deployment"
      resourceType="Deployment"
      steps={steps}
      yaml={yaml}
      onClose={onClose}
      onSubmit={handleSubmit}
      isSubmitting={createResource.isPending}
    />
  );
}
