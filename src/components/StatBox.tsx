import {cn} from "@/src/lib/utils.ts";
import React from "react";

export function StatBox({ label, value, subtext, color = "text-[#d4eaf7]" }: { label: string, value: string | number, subtext?: string, color?: string }) {
    return (
        <div className="bg-[#0a1628] border border-[#00d4ff]/10 p-3 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-[#00d4ff]/30 to-transparent" />
            <span className="text-[16px] tracking-[0.25em] text-[#00d4ff]/40 uppercase font-data mb-1.5 ml-2">{label}</span>
            <span className={cn("text-xl font-light tracking-tight ml-2", color)}>{value}</span>
            {subtext && <span className="text-[16px] text-[#00d4ff]/25 mt-1 font-data ml-2">{subtext}</span>}
        </div>
    );
}
