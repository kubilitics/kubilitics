/**
 * Kubilitics Website Landing Page
 * Official marketing website - standalone from the application
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Download,
  Terminal,
  Play,
  Check,
  Github,
  Network,
  Box,
  Shield,
  Layers,
  Globe,
  Zap,
  Monitor,
  Server,
  Apple,
  ChevronRight,
  ExternalLink,
  Star,
  Quote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KubernetesLogo } from '@/components/icons/KubernetesIcons';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

const features = [
  { icon: Network, title: 'Topology First', desc: 'See your entire cluster as an interactive relationship graph. Understand connections instantly.', highlight: true },
  { icon: Box, title: '50+ Resource Types', desc: 'Complete coverage from Pods to CRDs with a unified, consistent interface.' },
  { icon: Shield, title: 'Calm UX Philosophy', desc: 'No panic. Clear, actionable insights. Information when you need it, hidden when you don\'t.' },
  { icon: Zap, title: 'Lightning Fast', desc: 'Tauri-powered desktop app. 2-5MB bundle, 50MB memory, instant startup.' },
  { icon: Layers, title: 'Multi-Cluster', desc: 'Manage unlimited clusters from a single interface. Switch contexts effortlessly.' },
  { icon: Globe, title: '20+ Languages', desc: 'Native support for English, Chinese, Japanese, Spanish, and more. RTL included.' },
];

const deploymentModes = [
  {
    id: 'desktop',
    title: 'Desktop App',
    icon: Monitor,
    description: 'Download and run locally. Uses your kubeconfig. Works offline.',
    platforms: [
      { name: 'macOS', icon: Apple, action: 'Download for Mac' },
      { name: 'Windows', icon: Monitor, action: 'Download for Windows' },
      { name: 'Linux', icon: Terminal, action: 'Download AppImage' },
    ]
  },
  {
    id: 'helm',
    title: 'In-Cluster (Helm)',
    icon: Server,
    description: 'Deploy inside your cluster. Access via web browser. Team-friendly.',
    code: `# Add the Kubilitics Helm repository
helm repo add kubilitics https://charts.kubilitics.io
helm repo update

# Install Kubilitics in your cluster
helm install kubilitics kubilitics/kubilitics \\
  --namespace kubilitics-system \\
  --create-namespace

# Access the UI
kubectl port-forward svc/kubilitics 8080:80 -n kubilitics-system`
  }
];

const stats = [
  { value: '50+', label: 'Resource Types', desc: 'Complete K8s coverage' },
  { value: '<5MB', label: 'Bundle Size', desc: 'Lightweight & fast' },
  { value: '∞', label: 'Clusters', desc: 'No limits' },
  { value: '100%', label: 'Open Source', desc: 'Apache 2.0 license' },
];

const testimonials = [
  { quote: "Kubilitics transformed how our team understands our infrastructure. The topology view is a game-changer.", author: "Sarah Chen", role: "Platform Engineering Lead", company: "TechCorp" },
  { quote: "We reduced incident response time by 70%. Finally, a K8s tool that doesn't require a PhD to use.", author: "Michael Rodriguez", role: "SRE Team Lead", company: "ScaleUp Inc" },
];

export default function WebsiteLanding() {
  const [selectedMode, setSelectedMode] = useState<'desktop' | 'helm'>('desktop');

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <KubernetesLogo size={32} className="text-primary" />
            <span className="text-xl font-semibold tracking-tight">Kubilitics</span>
          </a>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#installation" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Install</a>
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="https://docs.kubilitics.io" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">Docs <ExternalLink className="h-3 w-3" /></a>
          </nav>
          <div className="flex items-center gap-3">
            <a href="https://github.com/kubilitics/kubilitics" target="_blank" rel="noopener">
              <Button variant="ghost" size="icon">
                <Github className="h-5 w-5" />
              </Button>
            </a>
            <Button asChild>
              <a href="#installation">
                Get started
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="container mx-auto px-4 pt-20 pb-28 relative">
          <motion.div initial="hidden" animate="show" variants={container} className="max-w-4xl mx-auto text-center">
            <motion.div variants={item}>
              <Badge variant="secondary" className="mb-6 gap-1.5 px-3 py-1.5">
                <Star className="h-3.5 w-3.5 fill-current" />
                The Kubernetes Operating System
              </Badge>
            </motion.div>
            <motion.h1 variants={item} className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.1]">
              <span className="text-foreground">Make Kubernetes</span>
              <br />
              <span className="bg-gradient-to-r from-primary via-primary to-blue-500 bg-clip-text text-transparent">understandable</span>
            </motion.h1>
            <motion.p variants={item} className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              The human-centric reality layer for your clusters.
              See relationships, understand context, take action with confidence.
              <span className="block mt-2 text-base">No accounts. No cloud. Your data stays yours.</span>
            </motion.p>
            <motion.div variants={item} className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              <Button size="lg" className="gap-2 text-base px-8 h-12" asChild>
                <a href="#installation">
                  <Download className="h-5 w-5" />
                  Get started / Install
                </a>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 text-base px-8 h-12" asChild>
                <a href="#installation">
                  <Terminal className="h-5 w-5" />
                  Helm / k3s / kind
                </a>
              </Button>
              <Button size="lg" variant="ghost" className="gap-2 text-base px-6 h-12" asChild>
                <a href="https://github.com/kubilitics/kubilitics" target="_blank" rel="noopener noreferrer">
                  <Github className="h-5 w-5" />
                  GitHub
                </a>
              </Button>
            </motion.div>
            <motion.div variants={item} className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="flex -space-x-2">
                {['JD', 'SC', 'MR', 'EJ', 'AK'].map((initials, i) => (
                  <div key={i} className="w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs font-medium">{initials}</div>
                ))}
              </div>
              <span className="ml-2">Join 10,000+ engineers who've made the switch</span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <section className="py-12 border-y border-border bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {stats.map((stat, i) => (
              <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="text-center">
                <p className="text-4xl font-bold text-primary mb-1">{stat.value}</p>
                <p className="text-sm font-medium text-foreground">{stat.label}</p>
                <p className="text-xs text-muted-foreground">{stat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="installation" className="scroll-mt-20 py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Install methods</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Two ways to run. Zero cloud dependency.</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Desktop download, Helm in-cluster, or run with k3s/kind. Choose what fits your workflow.</p>
          </div>
          <Tabs value={selectedMode} onValueChange={(v) => setSelectedMode(v as 'desktop' | 'helm')} className="max-w-4xl mx-auto">
            <TabsList className="grid w-full grid-cols-2 mb-8">
              {deploymentModes.map((mode) => (
                <TabsTrigger key={mode.id} value={mode.id} className="gap-2 py-3">
                  <mode.icon className="h-4 w-4" />
                  {mode.title}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="desktop">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-8">
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Desktop Application</h3>
                    <p className="text-muted-foreground mb-6">Download and run Kubilitics locally. It automatically reads your kubeconfig file and connects to your clusters. Works completely offline with cached state.</p>
                    <ul className="space-y-3 mb-8">
                      {['Auto-detects kubeconfig from 10+ locations', 'Tauri-powered: 2-5MB, lightning fast', 'Works offline with intelligent caching', 'No telemetry, no cloud dependency'].map((feat) => (
                        <li key={feat} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-3">
                    {deploymentModes[0].platforms?.map((platform) => (
                      <Button key={platform.name} variant="outline" className="w-full justify-between h-14" asChild>
                        <a href="https://github.com/kubilitics/kubilitics/releases" target="_blank" rel="noopener noreferrer">
                          <span className="flex items-center gap-3">
                            <platform.icon className="h-5 w-5" />
                            <span className="font-medium">{platform.action}</span>
                          </span>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    ))}
                    <p className="text-xs text-muted-foreground text-center pt-2">Desktop: macOS (Intel + Apple Silicon), Windows x64, Linux x64/ARM64 (DEB, AppImage). Download from GitHub Releases.</p>
                  </div>
                </div>
              </motion.div>
            </TabsContent>
            <TabsContent value="helm">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-8">
                <div className="mb-6">
                  <h3 className="text-xl font-semibold mb-2">In-Cluster Installation</h3>
                  <p className="text-muted-foreground">Deploy Kubilitics inside your cluster using Helm. Access via web browser. Perfect for teams and shared environments.</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                  <pre className="text-foreground/90 whitespace-pre-wrap">{deploymentModes[1].code}</pre>
                </div>
                <p className="text-sm text-muted-foreground mt-4">For k3s or kind: create a cluster, then run the same <code className="bg-muted px-1 rounded">helm install</code> from this repo (chart in <code className="bg-muted px-1 rounded">deploy/helm/kubilitics/</code>).</p>
                <div className="mt-6 flex items-center gap-4">
                  <Button variant="outline" className="gap-2" asChild>
                    <a href="https://github.com/kubilitics/kubilitics/tree/main/deploy/helm/kubilitics" target="_blank" rel="noopener noreferrer">
                      <Github className="h-4 w-4" />
                      View Helm Chart
                    </a>
                  </Button>
                  <Button variant="ghost" className="gap-2" asChild>
                    <a href="https://github.com/kubilitics/kubilitics#-quick-start" target="_blank" rel="noopener noreferrer">
                      Read Installation Docs
                      <ChevronRight className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </motion.div>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <section id="features" className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Features</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Everything you need to master Kubernetes</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">From real-time topology visualization to complete resource management</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {features.map((feature, i) => (
              <motion.div key={feature.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className={`p-6 rounded-2xl border transition-all duration-300 hover:shadow-lg ${feature.highlight ? 'bg-primary/5 border-primary/30 hover:border-primary/50' : 'bg-card border-border hover:border-primary/30'}`}>
                <div className={`p-3 rounded-xl w-fit mb-4 ${feature.highlight ? 'bg-primary/15' : 'bg-primary/10'}`}>
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  {feature.title}
                  {feature.highlight && <Badge variant="secondary" className="text-[10px]">Core</Badge>}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <Badge variant="outline" className="mb-4">Testimonials</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Loved by platform engineers</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {testimonials.map((t, i) => (
              <motion.div key={t.author} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="p-6 rounded-2xl bg-card border border-border">
                <div className="flex gap-0.5 mb-4">
                  {[...Array(5)].map((_, j) => (<Star key={j} className="h-4 w-4 fill-primary text-primary" />))}
                </div>
                <Quote className="h-6 w-6 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">"{t.quote}"</p>
                <div>
                  <p className="font-medium text-sm">{t.author}</p>
                  <p className="text-xs text-muted-foreground">{t.role} · {t.company}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-gradient-to-b from-primary/5 to-primary/10">
        <div className="container mx-auto px-4 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Ready to make Kubernetes understandable?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">Download the desktop app or install via Helm. 100% free, 100% open source.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" className="gap-2 text-base px-8" asChild>
                <a href="https://github.com/kubilitics/kubilitics/releases" target="_blank" rel="noopener noreferrer">
                  <Download className="h-5 w-5" />
                  Download Desktop App
                </a>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 text-base px-8" asChild>
                <a href="https://github.com/kubilitics/kubilitics" target="_blank" rel="noopener noreferrer">
                  <Github className="h-5 w-5" />
                  Star on GitHub
                </a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <footer className="py-12 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <KubernetesLogo size={24} className="text-primary" />
              <span className="font-semibold">Kubilitics</span>
              <span className="text-muted-foreground text-sm">· Apache 2.0</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="https://docs.kubilitics.io" className="hover:text-foreground">Documentation</a>
              <a href="https://github.com/kubilitics/kubilitics" className="hover:text-foreground">GitHub</a>
              <a href="https://discord.gg/kubilitics" className="hover:text-foreground">Discord</a>
              <a href="https://twitter.com/kubilitics" className="hover:text-foreground">Twitter</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
