import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NodeStatus {
    name: string;
    status: 'Ready' | 'NotReady';
}

interface InfrastructureMapProps {
    nodes: NodeStatus[];
}

export function InfrastructureMap({ nodes }: InfrastructureMapProps) {
    return (
        <div className="w-full">
            <div className="flex flex-wrap gap-3 mt-4">
                {nodes.map((node, i) => (
                    <motion.div
                        key={node.name}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: i * 0.05, type: 'spring', stiffness: 200 }}
                        className={cn(
                            "relative group h-12 w-12 rounded-xl flex items-center justify-center border transition-all duration-300",
                            node.status === 'Ready'
                                ? "bg-white border-[#326CE5]/20 shadow-sm hover:shadow-[#326CE5]/20 hover:border-[#326CE5]"
                                : "bg-amber-50 border-amber-200"
                        )}
                    >
                        {/* Glow effect for Ready nodes */}
                        {node.status === 'Ready' && (
                            <div className="absolute inset-0 bg-[#326CE5]/5 rounded-xl animate-pulse" />
                        )}

                        <div className={cn(
                            "h-3 w-3 rounded-full z-10",
                            node.status === 'Ready' ? "bg-[#326CE5]" : "bg-amber-500"
                        )} />

                        {/* Tooltip-like label on hover */}
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">
                            {node.name} ({node.status})
                        </div>
                    </motion.div>
                ))}

                {nodes.length === 0 && (
                    <div className="h-24 w-full flex items-center justify-center border-2 border-dashed border-[#326CE5]/10 rounded-2xl">
                        <span className="text-xs font-bold text-muted-foreground uppercase opacity-50">Discovery in progress...</span>
                    </div>
                )}
            </div>
        </div>
    );
}
