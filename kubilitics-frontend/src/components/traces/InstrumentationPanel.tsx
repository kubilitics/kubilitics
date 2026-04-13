/**
 * InstrumentationPanel — enterprise-grade UX for per-deployment
 * OpenTelemetry auto-instrumentation.
 *
 * Handles:
 *  - Operator state machine (not_installed / installing / failed / ready)
 *  - Multi-container deployments (pod + sidecar(s))
 *  - Per-container language detection with confidence
 *  - Pre-flight check viewer with collapsible details
 *  - Blocking pre-flight failures disable the Instrument button
 *  - Manual instrumentation guides (Rust, Ruby, PHP, C++, generic)
 *  - Rollback error surfacing when instrument mutation reverts
 */
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Info,
  Loader2,
  ShieldAlert,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
  ContainerInstrumentation,
  InstrumentationStatus,
  PreflightCheck,
  TracingStatus,
} from '@/services/api/tracing';

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface InstrumentationPanelProps {
  clusterId: string;
  namespace: string;
  resourceName: string;
  instrStatus: InstrumentationStatus;
  tracingStatus: TracingStatus;
  onInstrument: (opts?: { language?: string; container?: string }) => void;
  onUninstrument: () => void;
  onInstallOperator: () => void;
  instrumentPending: boolean;
  uninstrumentPending: boolean;
  installOperatorPending?: boolean;
  lastRollbackReason?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const LANG_LABELS: Record<string, string> = {
  java: 'Java',
  python: 'Python',
  nodejs: 'Node.js',
  go: 'Go',
  dotnet: '.NET',
  rust: 'Rust',
  ruby: 'Ruby',
  php: 'PHP',
  cpp: 'C++',
  unknown: 'Unknown',
};

function langLabel(l?: string): string {
  if (!l) return 'Unknown';
  return LANG_LABELS[l.toLowerCase()] ?? l;
}

function confidenceClasses(c: ContainerInstrumentation['confidence']): string {
  switch (c) {
    case 'high':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
    case 'medium':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

async function copyToClipboard(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error('Failed to copy');
  }
}

/* ------------------------------------------------------------------ */
/* Code block with copy button                                         */
/* ------------------------------------------------------------------ */

function CodeBlock({
  code,
  filename,
  language,
}: {
  code: string;
  filename?: string;
  language?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/40 dark:bg-muted/20 overflow-hidden">
      {filename && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-muted/60 dark:bg-muted/30">
          <span className="text-[11px] font-mono text-muted-foreground">
            {filename}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] gap-1"
            onClick={() => copyToClipboard(code, `${filename} copied`)}
          >
            <Copy className="h-3 w-3" />
            Copy
          </Button>
        </div>
      )}
      <pre
        className={cn(
          'p-3 text-[11px] leading-relaxed font-mono overflow-x-auto',
          'text-foreground/90',
        )}
        data-language={language}
      >
        <code>{code}</code>
      </pre>
      {!filename && (
        <div className="flex justify-end px-2 pb-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] gap-1"
            onClick={() => copyToClipboard(code)}
          >
            <Copy className="h-3 w-3" />
            Copy
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Manual instrumentation guide                                        */
/* ------------------------------------------------------------------ */

interface GuideSnippet {
  tabKey: string;
  filename: string;
  language: string;
  code: string;
}

interface LanguageGuide {
  label: string;
  intro: string;
  snippets: GuideSnippet[];
  footer?: string;
}

function getLanguageGuide(
  language: string,
  serviceName: string,
): LanguageGuide {
  const l = language.toLowerCase();
  const endpointHttp = 'http://otel-collector.kubilitics-system:4318';
  const endpointGrpc = 'http://otel-collector.kubilitics-system:4317';

  switch (l) {
    case 'rust':
      return {
        label: 'Rust',
        intro:
          'Use tracing-opentelemetry + opentelemetry-otlp with the tonic (gRPC) exporter.',
        snippets: [
          {
            tabKey: 'cargo',
            filename: 'Cargo.toml',
            language: 'toml',
            code: `[dependencies]
opentelemetry = "0.21"
opentelemetry-otlp = { version = "0.14", features = ["tonic"] }
opentelemetry_sdk = { version = "0.21", features = ["rt-tokio"] }
tracing = "0.1"
tracing-opentelemetry = "0.22"
tracing-subscriber = "0.3"`,
          },
          {
            tabKey: 'main',
            filename: 'src/main.rs',
            language: 'rust',
            code: `use opentelemetry::global;
use opentelemetry_otlp::WithExportConfig;

fn init_tracer() -> Result<(), Box<dyn std::error::Error>> {
    global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint("${endpointGrpc}"),
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)?;
    Ok(())
}

fn main() {
    init_tracer().expect("failed to init tracer");
    // set OTEL_SERVICE_NAME=${serviceName} in your Deployment env
}`,
          },
        ],
      };

    case 'ruby':
      return {
        label: 'Ruby',
        intro:
          'Use the official opentelemetry-sdk + auto-instrumentation gems.',
        snippets: [
          {
            tabKey: 'gemfile',
            filename: 'Gemfile',
            language: 'ruby',
            code: `gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'`,
          },
          {
            tabKey: 'init',
            filename: 'config/initializers/opentelemetry.rb',
            language: 'ruby',
            code: `require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/all'

OpenTelemetry::SDK.configure do |c|
  c.service_name = '${serviceName}'
  c.use_all
end`,
          },
          {
            tabKey: 'env',
            filename: 'Deployment env',
            language: 'bash',
            code: `OTEL_EXPORTER_OTLP_ENDPOINT=${endpointHttp}
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=${serviceName}`,
          },
        ],
      };

    case 'php':
      return {
        label: 'PHP',
        intro: 'Install open-telemetry/sdk via Composer and enable autoload.',
        snippets: [
          {
            tabKey: 'composer',
            filename: 'composer',
            language: 'bash',
            code: `composer require open-telemetry/sdk open-telemetry/exporter-otlp`,
          },
          {
            tabKey: 'bootstrap',
            filename: 'bootstrap.php',
            language: 'php',
            code: `<?php
use OpenTelemetry\\API\\Globals;
use OpenTelemetry\\SDK\\Sdk;

putenv('OTEL_PHP_AUTOLOAD_ENABLED=true');
putenv('OTEL_SERVICE_NAME=${serviceName}');
putenv('OTEL_EXPORTER_OTLP_ENDPOINT=${endpointHttp}');
putenv('OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf');

Sdk::builder()->buildAndRegisterGlobal();
$tracer = Globals::tracerProvider()->getTracer('${serviceName}');`,
          },
        ],
      };

    case 'cpp':
    case 'c++':
      return {
        label: 'C++',
        intro:
          'Link opentelemetry-cpp and initialize the OTLP HTTP exporter at startup.',
        snippets: [
          {
            tabKey: 'cmake',
            filename: 'CMakeLists.txt',
            language: 'cmake',
            code: `find_package(opentelemetry-cpp CONFIG REQUIRED)
target_link_libraries(myapp PRIVATE
    opentelemetry-cpp::api
    opentelemetry-cpp::sdk
    opentelemetry-cpp::otlp_http_exporter
)`,
          },
          {
            tabKey: 'init',
            filename: 'tracer_init.cpp',
            language: 'cpp',
            code: `#include "opentelemetry/exporters/otlp/otlp_http_exporter_factory.h"
#include "opentelemetry/sdk/trace/simple_processor_factory.h"
#include "opentelemetry/sdk/trace/tracer_provider_factory.h"
#include "opentelemetry/trace/provider.h"

void InitTracer() {
    namespace otlp = opentelemetry::exporter::otlp;
    namespace trace_sdk = opentelemetry::sdk::trace;

    otlp::OtlpHttpExporterOptions opts;
    opts.url = "${endpointHttp}/v1/traces";
    auto exporter = otlp::OtlpHttpExporterFactory::Create(opts);
    auto processor =
        trace_sdk::SimpleSpanProcessorFactory::Create(std::move(exporter));
    auto provider =
        trace_sdk::TracerProviderFactory::Create(std::move(processor));
    opentelemetry::trace::Provider::SetTracerProvider(provider);
}`,
          },
        ],
      };

    default:
      return {
        label: langLabel(language),
        intro:
          "Auto-instrumentation isn't available for this stack. Set these environment variables on your container, then add OTel SDK calls per the OpenTelemetry docs for your language.",
        snippets: [
          {
            tabKey: 'env',
            filename: 'Deployment env',
            language: 'bash',
            code: `OTEL_EXPORTER_OTLP_ENDPOINT=${endpointHttp}
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=${serviceName}`,
          },
        ],
        footer:
          'See https://opentelemetry.io/docs/languages/ for SDK instructions.',
      };
  }
}

function ManualInstrumentationGuide({
  language,
  serviceName,
}: {
  language: string;
  serviceName: string;
  namespace: string;
}) {
  const guide = useMemo(
    () => getLanguageGuide(language, serviceName),
    [language, serviceName],
  );
  const [active, setActive] = useState(guide.snippets[0]?.tabKey ?? '');

  return (
    <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Download className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="text-[11px] leading-relaxed">
          <div className="text-foreground font-medium">
            Manual setup for {guide.label}
          </div>
          <p className="text-muted-foreground">{guide.intro}</p>
        </div>
      </div>

      {guide.snippets.length > 1 ? (
        <Tabs value={active} onValueChange={setActive}>
          <TabsList className="h-8">
            {guide.snippets.map((s) => (
              <TabsTrigger
                key={s.tabKey}
                value={s.tabKey}
                className="text-[11px] h-6 px-2"
              >
                {s.filename}
              </TabsTrigger>
            ))}
          </TabsList>
          {guide.snippets.map((s) => (
            <TabsContent key={s.tabKey} value={s.tabKey} className="mt-2">
              <CodeBlock
                code={s.code}
                filename={s.filename}
                language={s.language}
              />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        guide.snippets.map((s) => (
          <CodeBlock
            key={s.tabKey}
            code={s.code}
            filename={s.filename}
            language={s.language}
          />
        ))
      )}

      {guide.footer && (
        <p className="text-[11px] text-muted-foreground">{guide.footer}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pre-flight check viewer                                             */
/* ------------------------------------------------------------------ */

function PreflightIcon({ c }: { c: PreflightCheck }) {
  if (c.passed) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
  }
  if (c.severity === 'blocking') {
    return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
  }
  if (c.severity === 'warning') {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  }
  return <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function PreflightSection({
  checks,
  hasBlocker,
}: {
  checks: PreflightCheck[];
  hasBlocker: boolean;
}) {
  const [open, setOpen] = useState(hasBlocker);
  const passedCount = checks.filter((c) => c.passed).length;
  const warnCount = checks.filter(
    (c) => !c.passed && c.severity === 'warning',
  ).length;
  const blockCount = checks.filter(
    (c) => !c.passed && c.severity === 'blocking',
  ).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs transition-colors',
            hasBlocker
              ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
              : warnCount > 0
                ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                : 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10',
          )}
        >
          <div className="flex items-center gap-2">
            {hasBlocker ? (
              <ShieldAlert className="h-4 w-4 text-red-500" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            )}
            <span className="text-foreground font-medium">
              Pre-flight checks
            </span>
            <span className="text-muted-foreground font-normal">
              ({passedCount} passed
              {warnCount > 0 && `, ${warnCount} warning${warnCount > 1 ? 's' : ''}`}
              {blockCount > 0 && `, ${blockCount} blocked`})
            </span>
          </div>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1.5">
        {checks.map((c, i) => (
          <div
            key={`${c.name}-${i}`}
            className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px]"
          >
            <PreflightIcon c={c} />
            <div className="min-w-0 flex-1 leading-relaxed">
              <div className="text-foreground font-medium">{c.message}</div>
              {c.detail && (
                <div className="text-muted-foreground mt-0.5">{c.detail}</div>
              )}
            </div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ------------------------------------------------------------------ */
/* Operator state strip                                                */
/* ------------------------------------------------------------------ */

function OperatorStateStrip({
  state,
  message,
  onInstall,
  pending,
}: {
  state: TracingStatus['operator_state'];
  message?: string;
  onInstall: () => void;
  pending: boolean;
}) {
  if (!state || state === 'ready') return null;

  if (state === 'installing') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        <span className="text-muted-foreground">
          Installing OpenTelemetry Operator (cert-manager + operator + CRDs, ~2
          min)...
        </span>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="flex items-start justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs">
        <div className="flex items-start gap-2 min-w-0">
          <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-foreground font-medium">
              Operator install failed
            </div>
            {message && (
              <div className="text-muted-foreground break-words">{message}</div>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs shrink-0"
          disabled={pending}
          onClick={onInstall}
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            'Retry install'
          )}
        </Button>
      </div>
    );
  }

  // not_installed
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-foreground font-medium">
          OpenTelemetry Operator not installed
        </span>
      </div>
      <Button
        size="sm"
        className="h-7 text-xs gap-1.5"
        disabled={pending}
        onClick={onInstall}
      >
        {pending ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Installing...
          </>
        ) : (
          'Install'
        )}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main panel                                                          */
/* ------------------------------------------------------------------ */

export function InstrumentationPanel({
  namespace,
  resourceName,
  instrStatus,
  tracingStatus,
  onInstrument,
  onUninstrument,
  onInstallOperator,
  instrumentPending,
  uninstrumentPending,
  installOperatorPending = false,
  lastRollbackReason,
}: InstrumentationPanelProps) {
  // Build container list (fall back to synthesizing one from legacy fields).
  const containers: ContainerInstrumentation[] = useMemo(() => {
    if (instrStatus.containers && instrStatus.containers.length > 0) {
      return instrStatus.containers;
    }
    return [
      {
        name: resourceName,
        image: '',
        detected_language: instrStatus.detected_language ?? 'unknown',
        confidence: 'medium',
        detection_source: 'image-name',
        supports_auto: instrStatus.supports_language ?? false,
        instrumented: instrStatus.instrumented,
      },
    ];
  }, [instrStatus, resourceName]);

  const defaultContainer =
    containers.find((c) => c.supports_auto)?.name ?? containers[0].name;
  const [selectedContainer, setSelectedContainer] = useState(defaultContainer);
  const [showGuide, setShowGuide] = useState(false);

  const selected =
    containers.find((c) => c.name === selectedContainer) ?? containers[0];

  const preflight = instrStatus.preflight_checks;
  const hasBlocker = !!preflight?.checks.some(
    (c) => !c.passed && c.severity === 'blocking',
  );

  const operatorReady =
    tracingStatus.operator_state === 'ready' ||
    (!tracingStatus.operator_state && instrStatus.otel_operator_ready);

  return (
    <div className="px-4 pt-3 space-y-3">
      {/* 1. Operator state strip */}
      <OperatorStateStrip
        state={tracingStatus.operator_state}
        message={tracingStatus.operator_message}
        onInstall={onInstallOperator}
        pending={installOperatorPending}
      />

      {/* Only render rest if operator is ready */}
      {operatorReady && (
        <>
          {/* 2. Container picker */}
          {containers.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground">
                Container:
              </span>
              {containers.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => {
                    setSelectedContainer(c.name);
                    setShowGuide(false);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                    selectedContainer === c.name
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  {c.name}
                  {c.instrumented && (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  )}
                  {!c.supports_auto && !c.instrumented && (
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 3. Detection display */}
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">Detected language:</span>
              <span className="font-medium text-foreground">
                {langLabel(selected.detected_language)}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] h-4 px-1.5',
                  confidenceClasses(selected.confidence),
                )}
              >
                {selected.confidence} confidence
              </Badge>
              <span className="text-muted-foreground">
                • source:{' '}
                <span className="font-mono text-[10px]">
                  {selected.detection_source}
                </span>
              </span>
            </div>
            {selected.image && (
              <div className="text-muted-foreground truncate">
                <span className="text-[10px]">Image: </span>
                <code className="font-mono text-[10px] text-foreground/80">
                  {selected.image}
                </code>
              </div>
            )}
          </div>

          {/* 4. Pre-flight checks */}
          {preflight && preflight.checks.length > 0 && (
            <PreflightSection
              checks={preflight.checks}
              hasBlocker={hasBlocker}
            />
          )}

          {/* 5. Rollback error */}
          {lastRollbackReason && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs">
              <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="min-w-0 leading-relaxed">
                <div className="text-foreground font-medium">
                  Instrumentation reverted
                </div>
                <div className="text-muted-foreground break-words">
                  Rollout failed: {lastRollbackReason}
                </div>
                <div className="text-muted-foreground">
                  The deployment was returned to its previous state.
                </div>
              </div>
            </div>
          )}

          {/* 6. Action area */}
          {selected.instrumented ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-foreground font-medium">
                  Instrumented{' '}
                  <span className="text-muted-foreground font-normal">
                    ({langLabel(selected.detected_language)})
                  </span>
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={uninstrumentPending}
                onClick={onUninstrument}
              >
                {uninstrumentPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  'Disable instrumentation'
                )}
              </Button>
            </div>
          ) : selected.supports_auto ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary shrink-0" />
                <span className="text-foreground">
                  This container is not instrumented
                </span>
              </div>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={instrumentPending || hasBlocker}
                title={
                  hasBlocker
                    ? 'Resolve blocking pre-flight checks first'
                    : undefined
                }
                onClick={() =>
                  onInstrument({
                    container:
                      containers.length > 1 ? selected.name : undefined,
                    language: selected.detected_language,
                  })
                }
              >
                {instrumentPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Instrumenting...
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3" />
                    Instrument with OpenTelemetry
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <div className="text-foreground font-medium">
                      Auto-instrumentation not available for{' '}
                      {langLabel(selected.detected_language)}
                    </div>
                    <div className="text-muted-foreground">
                      The OpenTelemetry Operator doesn't support this stack.
                      Use manual instrumentation below.
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={() => setShowGuide((v) => !v)}
                >
                  {showGuide ? 'Hide guide' : 'View setup guide'}
                </Button>
              </div>
              {showGuide && (
                <ManualInstrumentationGuide
                  language={selected.detected_language}
                  serviceName={resourceName}
                  namespace={namespace}
                />
              )}
            </div>
          )}

          {/* Pending operator state = also show "still installing" subtle hint */}
          {!operatorReady && tracingStatus.operator_state === undefined && (
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">
                OpenTelemetry Operator is still initializing...
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
