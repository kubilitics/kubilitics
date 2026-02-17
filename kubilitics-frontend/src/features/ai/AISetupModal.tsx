import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Bot,
    Key,
    Eye,
    EyeOff,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    saveLLMProviderConfig,
    loadLLMProviderConfig,
    getAIInfo,
    type LLMProviderConfig,
} from '@/services/aiService';
import { motion, AnimatePresence } from 'framer-motion';

const AI_PROVIDER_OPTIONS = [
    { value: 'openai', label: 'OpenAI (GPT-4, GPT-3.5)', icon: 'openai' },
    { value: 'anthropic', label: 'Anthropic (Claude)', icon: 'anthropic' },
    { value: 'ollama', label: 'Ollama (Local LLM)', icon: 'ollama' },
    { value: 'custom', label: 'Custom (OpenAI-compatible)', icon: 'custom' },
] as const;

interface AISetupModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void;
}

export function AISetupModal({ open, onOpenChange, onComplete }: AISetupModalProps) {
    const [aiConfig, setAiConfig] = useState<LLMProviderConfig>({ provider: 'openai' });
    const [showApiKey, setShowApiKey] = useState(false);
    const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    useEffect(() => {
        const saved = loadLLMProviderConfig();
        if (saved && saved.provider !== 'none') {
            setAiConfig(saved);
        }
    }, [open]);

    const handleSave = async () => {
        setTestStatus('loading');
        try {
            saveLLMProviderConfig(aiConfig);
            await getAIInfo();
            setTestStatus('success');
            toast.success('AI Engine connected successfully!');
            setTimeout(() => {
                onOpenChange(false);
                onComplete?.();
            }, 1500);
        } catch (err: any) {
            setTestStatus('error');
            toast.error(err.message || 'Failed to connect to AI Engine');
        }
    };

    const handleProviderChange = (provider: LLMProviderConfig['provider']) => {
        setAiConfig((prev) => ({
            ...prev,
            provider,
            model: provider === 'openai' ? 'gpt-4o' :
                provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' :
                    provider === 'ollama' ? 'llama3' : '',
            base_url: provider === 'ollama' ? 'http://localhost:11434' : undefined,
        }));
        setTestStatus('idle');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden bg-white border-none rounded-[2.5rem] shadow-2xl shadow-slate-200">
                <div className="relative h-1.5 bg-blue-600/10">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: testStatus === 'loading' ? '100%' : '0%' }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="h-full bg-blue-600"
                    />
                </div>

                <div className="p-10">
                    <DialogHeader className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="p-3 rounded-2xl bg-blue-50">
                                <Bot className="h-6 w-6 text-blue-600" />
                            </div>
                            <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Intelligence Setup</DialogTitle>
                        </div>
                        <DialogDescription className="text-slate-500 text-base leading-relaxed">
                            Connect your preferred LLM to enable anomaly detection and proactive optimization across your ecosystem.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Service Provider</Label>
                            <Select value={aiConfig.provider} onValueChange={(v) => handleProviderChange(v as LLMProviderConfig['provider'])}>
                                <SelectTrigger className="bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl focus:ring-blue-100">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-slate-100 text-slate-900 rounded-xl shadow-xl">
                                    {AI_PROVIDER_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value} className="focus:bg-slate-50 rounded-lg mx-1">
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <AnimatePresence mode="wait">
                            <motion.div
                                key={aiConfig.provider}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="space-y-4"
                            >
                                {(aiConfig.provider === 'openai' || aiConfig.provider === 'anthropic' || aiConfig.provider === 'custom') && (
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Private API Key</Label>
                                        <div className="relative group">
                                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                            <Input
                                                type={showApiKey ? 'text' : 'password'}
                                                placeholder={aiConfig.provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                                                value={aiConfig.api_key || ''}
                                                onChange={(e) => setAiConfig({ ...aiConfig, api_key: e.target.value })}
                                                className="pl-10 pr-10 bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl font-mono focus:ring-blue-100"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowApiKey(!showApiKey)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                                            >
                                                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {(aiConfig.provider === 'ollama' || aiConfig.provider === 'custom') && (
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Endpoint URL</Label>
                                        <Input
                                            placeholder={aiConfig.provider === 'ollama' ? 'http://localhost:11434' : 'http://api.your-provider.com/v1'}
                                            value={aiConfig.base_url || ''}
                                            onChange={(e) => setAiConfig({ ...aiConfig, base_url: e.target.value })}
                                            className="bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl font-mono focus:ring-blue-100"
                                        />
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Model Profile</Label>
                                    <Input
                                        placeholder="e.g. gpt-4o, claude-3.5, llama3"
                                        value={aiConfig.model || ''}
                                        onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                                        className="bg-slate-50/50 border-slate-100 text-slate-900 h-12 rounded-xl font-mono focus:ring-blue-100"
                                    />
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    <div className="mt-10 flex gap-3">
                        <Button
                            variant="ghost"
                            className="flex-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl h-12 font-semibold"
                            onClick={() => onOpenChange(false)}
                        >
                            Back
                        </Button>
                        <Button
                            className={`flex-[1.5] h-12 rounded-xl text-white font-bold transition-all shadow-lg ${testStatus === 'success' ? 'bg-emerald-500 shadow-emerald-500/20' :
                                testStatus === 'error' ? 'bg-rose-500 shadow-rose-500/20' : 'bg-slate-900 hover:bg-slate-800 shadow-slate-900/20'
                                }`}
                            onClick={handleSave}
                            disabled={testStatus === 'loading'}
                        >
                            {testStatus === 'loading' ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : testStatus === 'success' ? (
                                <CheckCircle2 className="h-5 w-5" />
                            ) : testStatus === 'error' ? (
                                "Retry Sync"
                            ) : (
                                "Identify & Sync"
                            )}
                        </Button>
                    </div>

                    <p className="mt-8 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Zero-Trust Storage &bull; End-to-End Privacy
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
