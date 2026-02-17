import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
    Monitor,
    Cloud,
    ArrowRight,
    Zap,
    Shield,
    BarChart3,
    CheckCircle2,
    Info
} from 'lucide-react';
import { KubernetesLogo } from '@/components/icons/KubernetesIcons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useClusterStore } from '@/stores/clusterStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

const container: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.15
        }
    }
};

const item: Variants = {
    hidden: { opacity: 0, y: 30 },
    show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } }
};

export default function ModeSelection() {
    const navigate = useNavigate();
    const setAppMode = useClusterStore((s) => s.setAppMode);
    const [showComparison, setShowComparison] = useState(false);

    const handleSelectMode = (mode: 'desktop' | 'in-cluster') => {
        setAppMode(mode);
        if (mode === 'desktop') {
            navigate('/connect');
        } else {
            navigate('/connect'); // Will handle in-cluster details there
        }
    };

    return (
        <div className="relative min-h-screen bg-[#020617] text-slate-50 overflow-hidden flex flex-col items-center justify-center p-6">
            {/* Background Ambient Glow */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />

            <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="relative z-10 w-full max-w-5xl"
            >
                <motion.div variants={item} className="text-center mb-16">
                    <div className="flex items-center justify-center gap-4 mb-8">
                        <div className="relative">
                            <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full" />
                            <KubernetesLogo size={64} className="relative text-blue-400" />
                        </div>
                        <span className="text-5xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-400">
                            Kubilitics
                        </span>
                    </div>
                    <h1 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight">
                        Choose your journey.
                    </h1>
                    <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
                        The Kubernetes Operating System adapts to your environment.
                        Select how you want to experience the future of cluster management.
                    </p>
                </motion.div>

                <div className="grid md:grid-cols-2 gap-8 mb-12">
                    {/* Desktop Mode Card */}
                    <motion.div variants={item}>
                        <Card
                            onClick={() => handleSelectMode('desktop')}
                            className="group relative h-full bg-slate-900/40 border-slate-800/50 backdrop-blur-xl hover:border-blue-500/50 hover:bg-slate-800/60 transition-all duration-500 cursor-pointer overflow-hidden p-8"
                        >
                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Monitor size={120} />
                            </div>

                            <div className="relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                                    <Monitor className="text-blue-400" size={28} />
                                </div>
                                <h3 className="text-2xl font-bold mb-3 tracking-tight group-hover:text-blue-400 transition-colors">
                                    Desktop Engine
                                </h3>
                                <p className="text-slate-400 mb-8 leading-relaxed">
                                    The ultimate local experience. Auto-detects your kubeconfigs and runs entirely on your hardware. Zero setup, maximum power.
                                </p>

                                <ul className="space-y-3 mb-10">
                                    {[
                                        'Auto-discovery of ~/.kube/config',
                                        'Support for GKE, EKS, AKS, & Kind',
                                        'Offline-first architecture',
                                        'Native OS integration'
                                    ].map((feature) => (
                                        <li key={feature} className="flex items-center gap-3 text-sm text-slate-300">
                                            <CheckCircle2 size={16} className="text-blue-500/70" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white border-none h-12 text-base font-medium transition-all group-hover:translate-x-1">
                                    Start Desktop Engine
                                    <ArrowRight size={18} className="ml-2" />
                                </Button>
                            </div>
                        </Card>
                    </motion.div>

                    {/* In-Cluster Card */}
                    <motion.div variants={item}>
                        <Card
                            onClick={() => handleSelectMode('in-cluster')}
                            className="group relative h-full bg-slate-900/40 border-slate-800/50 backdrop-blur-xl hover:border-purple-500/50 hover:bg-slate-800/60 transition-all duration-500 cursor-pointer overflow-hidden p-8"
                        >
                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Cloud size={120} />
                            </div>

                            <div className="relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                                    <Cloud className="text-purple-400" size={28} />
                                </div>
                                <h3 className="text-2xl font-bold mb-3 tracking-tight group-hover:text-purple-400 transition-colors">
                                    In-Cluster OS
                                </h3>
                                <p className="text-slate-400 mb-8 leading-relaxed">
                                    Deploy Kubilitics directly into your cluster. Perfect for team collaboration, shared monitoring, and production visibility.
                                </p>

                                <ul className="space-y-3 mb-10">
                                    {[
                                        'Helm-based deployment',
                                        'Native RBAC integration',
                                        'Shared persistent analytics',
                                        'Zero local configuration'
                                    ].map((feature) => (
                                        <li key={feature} className="flex items-center gap-3 text-sm text-slate-300">
                                            <CheckCircle2 size={16} className="text-purple-500/70" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Button className="w-full bg-purple-600 hover:bg-purple-500 text-white border-none h-12 text-base font-medium transition-all group-hover:translate-x-1">
                                    Deploy to Cluster
                                    <ArrowRight size={18} className="ml-2" />
                                </Button>
                            </div>
                        </Card>
                    </motion.div>
                </div>

                <motion.div variants={item} className="flex flex-col items-center gap-6">
                    <button
                        onClick={() => setShowComparison(true)}
                        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
                    >
                        <Info size={16} />
                        Not sure which to choose? Compare modes
                    </button>

                    <div className="flex items-center gap-8 py-8 px-12 rounded-full bg-slate-900/50 border border-slate-800/50 backdrop-blur-md">
                        <div className="flex flex-col items-center text-center">
                            <span className="text-2xl font-bold text-white">50+</span>
                            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Resources</span>
                        </div>
                        <div className="w-px h-8 bg-slate-800" />
                        <div className="flex flex-col items-center text-center">
                            <span className="text-2xl font-bold text-white">Real-Time</span>
                            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Discovery</span>
                        </div>
                        <div className="w-px h-8 bg-slate-800" />
                        <div className="flex flex-col items-center text-center">
                            <span className="text-2xl font-bold text-white">AI</span>
                            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Augmented</span>
                        </div>
                    </div>
                </motion.div>
            </motion.div>

            {/* Comparison Dialog */}
            <Dialog open={showComparison} onOpenChange={setShowComparison}>
                <DialogContent className="max-w-3xl bg-[#0a0f1e] border-slate-800 text-slate-50">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-bold tracking-tight">Compare Kubilitics Modes</DialogTitle>
                        <DialogDescription className="text-slate-400">
                            Find the version that best fits your workflow.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="mt-6 overflow-hidden rounded-xl border border-slate-800">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-900/50">
                                <tr>
                                    <th className="p-4 text-left font-medium text-slate-400">Feature</th>
                                    <th className="p-4 text-center font-bold text-blue-400">Desktop</th>
                                    <th className="p-4 text-center font-bold text-purple-400">In-Cluster</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {[
                                    { name: 'Installation', desktop: 'One-click executable', cluster: 'Helm Chart / YAML' },
                                    { name: 'Architecture', desktop: 'Local process', cluster: 'K8s Deployment' },
                                    { name: 'Connectivity', desktop: 'Direct via Kubeconfig', cluster: 'In-cluster API Access' },
                                    { name: 'Data Privacy', desktop: '100% Local', cluster: 'Stay within VPC' },
                                    { name: 'Updates', desktop: 'Automatic per release', cluster: 'GitOps / Manual' },
                                    { name: 'Collaboration', desktop: 'Individual', cluster: 'Team-based access' },
                                ].map((row) => (
                                    <tr key={row.name} className="hover:bg-white/5 transition-colors">
                                        <td className="p-4 font-medium text-slate-300">{row.name}</td>
                                        <td className="p-4 text-center text-slate-400">{row.desktop}</td>
                                        <td className="p-4 text-center text-slate-400">{row.cluster}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-6 grid grid-cols-3 gap-4">
                        <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 flex flex-col items-center text-center">
                            <Zap className="text-blue-400 mb-2" size={20} />
                            <span className="text-xs font-semibold">High Performance</span>
                        </div>
                        <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/10 flex flex-col items-center text-center">
                            <Shield className="text-purple-400 mb-2" size={20} />
                            <span className="text-xs font-semibold">Enterprise Ready</span>
                        </div>
                        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 flex flex-col items-center text-center">
                            <BarChart3 className="text-emerald-400 mb-2" size={20} />
                            <span className="text-xs font-semibold">Advanced Analytics</span>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
