import {cn} from "@/src/lib/utils.ts";
import React from "react";

export function StatBox({ label, value, subtext, color = "text-zinc-100" }: { label: string, value: string | number, subtext?: string, color?: string }) {
    return (
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-3 flex flex-col">
            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">{label}</span>
            <span className={cn("text-xl font-light tracking-tight", color)}>{value}</span>
            {subtext && <span className="text-[10px] text-zinc-500 mt-1">{subtext}</span>}
        </div>
    );
}