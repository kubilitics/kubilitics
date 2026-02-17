import { BackendProject } from '@/services/backendApiClient';
import { Focus, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ProjectCardProps {
    project: BackendProject;
    onClick?: () => void;
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
    return (
        <div
            className="relative group overflow-hidden bg-white/60 backdrop-blur-md rounded-[2.5rem] border border-slate-100 p-8 hover:shadow-2xl hover:shadow-blue-500/10 hover:border-blue-100 transition-all duration-500 cursor-pointer"
            onClick={onClick}
        >
            {/* Decorative top gradient */}
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-500/0 via-blue-500/40 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

            <div className="flex justify-between items-start mb-8">
                <div className="relative">
                    <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <div className="relative h-16 w-16 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-50 group-hover:border-blue-100 group-hover:translate-y-[-2px] transition-all duration-500">
                        <Focus className="h-8 w-8 text-slate-400 group-hover:text-blue-600 transition-colors" />
                    </div>
                </div>
                <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-none px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.1em] shadow-sm">
                    Active
                </Badge>
            </div>

            <div className="space-y-4 mb-10">
                <h3 className="text-2xl font-bold bg-gradient-to-br from-slate-900 to-slate-600 bg-clip-text text-transparent group-hover:from-blue-700 group-hover:to-blue-500 transition-all duration-500">
                    {project.name}
                </h3>
                <p className="text-sm text-slate-500 font-medium leading-relaxed line-clamp-2 min-h-[2.5rem]">
                    {project.description || 'No description provided for this logical environment.'}
                </p>
            </div>

            <div className="flex items-center justify-between pt-8 border-t border-slate-100/50">
                <div className="flex gap-10">
                    <div className="space-y-1">
                        <div className="text-2xl font-extrabold text-slate-900 tabular-nums tracking-tight tracking-[-0.02em]">
                            {project.cluster_count || 0}
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] flex items-center gap-1.5">
                            <span className="h-1 w-1 bg-blue-400 rounded-full" />
                            Clusters
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="text-2xl font-extrabold text-slate-900 tabular-nums tracking-tight tracking-[-0.02em]">
                            {project.namespace_count || 0}
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] flex items-center gap-1.5">
                            <span className="h-1 w-1 bg-purple-400 rounded-full" />
                            Namespaces
                        </div>
                    </div>
                </div>

                <div className="relative h-12 w-12 rounded-2xl bg-slate-900/5 flex items-center justify-center group-hover:bg-slate-900 group-hover:translate-x-1 transition-all duration-500">
                    <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-white transition-colors" />
                </div>
            </div>

            {/* Subtle bottom accent icon */}
            <div className="absolute bottom-[-20px] right-[-20px] opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-700 pointer-events-none">
                <Focus size={120} strokeWidth={1} />
            </div>
        </div>
    );
}
