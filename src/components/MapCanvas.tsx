import React, { useRef, useEffect, useState } from 'react';
import { TransformWrapper, TransformComponent, useTransformComponent } from "react-zoom-pan-pinch";

// Determine endianness for 32-bit color buffer
const isLittleEndian = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;

// Helper to create 32-bit color
const rgba = (r: number, g: number, b: number, a: number = 255) =>
    isLittleEndian ? (a << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | a;

const TRANSPARENT = 0;

const interpolateColor32 = isLittleEndian
    ? (c1: number, c2: number, progress: number) => {
      if (c1 === c2) return c1;
      if (c1 === TRANSPARENT) return c2;
      if (c2 === TRANSPARENT) return c1;

      const r1 = c1 & 0xff;
      const g1 = (c1 >> 8) & 0xff;
      const b1 = (c1 >> 16) & 0xff;
      const a1 = (c1 >>> 24) & 0xff;

      const r2 = c2 & 0xff;
      const g2 = (c2 >> 8) & 0xff;
      const b2 = (c2 >> 16) & 0xff;
      const a2 = (c2 >>> 24) & 0xff;

      const r = r1 + (r2 - r1) * progress | 0;
      const g = g1 + (g2 - g1) * progress | 0;
      const b = b1 + (b2 - b1) * progress | 0;
      const a = a1 + (a2 - a1) * progress | 0;

      return (a << 24) | (b << 16) | (g << 8) | r;
    }
    : (c1: number, c2: number, progress: number) => {
      if (c1 === c2) return c1;
      if (c1 === TRANSPARENT) return c2;
      if (c2 === TRANSPARENT) return c1;

      const r1 = (c1 >>> 24) & 0xff;
      const g1 = (c1 >> 16) & 0xff;
      const b1 = (c1 >> 8) & 0xff;
      const a1 = c1 & 0xff;

      const r2 = (c2 >>> 24) & 0xff;
      const g2 = (c2 >> 16) & 0xff;
      const b2 = (c2 >> 8) & 0xff;
      const a2 = c2 & 0xff;

      const r = r1 + (r2 - r1) * progress | 0;
      const g = g1 + (g2 - g1) * progress | 0;
      const b = b1 + (b2 - b1) * progress | 0;
      const a = a1 + (a2 - a1) * progress | 0;

      return (r << 24) | (g << 16) | (b << 8) | a;
    };

const SSTA_COLORS = new Uint32Array([
  rgba(5, 48, 97),    // < -2
  rgba(33, 102, 172), // < -1
  rgba(67, 147, 195), // < -0.5
  rgba(146, 197, 222),// < 0
  rgba(244, 165, 130),// < 0.5
  rgba(214, 96, 77),  // < 1
  rgba(178, 24, 43),  // < 2
  rgba(103, 0, 31)    // >= 2
]);

const DIFF_COLORS = new Uint32Array([
  rgba(49, 54, 149),   // < -0.8
  rgba(69, 117, 180),  // < -0.6
  rgba(116, 173, 209), // < -0.4
  rgba(171, 217, 233), // < -0.2
  rgba(224, 243, 248), // < 0
  rgba(254, 224, 144), // < 0.2
  rgba(253, 174, 97),  // < 0.4
  rgba(244, 109, 67),  // < 0.6
  rgba(215, 48, 39),   // < 0.8
  rgba(165, 0, 38)     // >= 0.8
]);

export function getColor32ForSSTa(val: number): number {
  if (val !== val || val < -999) return TRANSPARENT;
  if (val < -2) return SSTA_COLORS[0];
  if (val < -1) return SSTA_COLORS[1];
  if (val < -0.5) return SSTA_COLORS[2];
  if (val < 0) return SSTA_COLORS[3];
  if (val < 0.5) return SSTA_COLORS[4];
  if (val < 1) return SSTA_COLORS[5];
  if (val < 2) return SSTA_COLORS[6];
  return SSTA_COLORS[7];
}

export function getColor32ForDifference(val: number, maxAbs: number): number {
  if (val !== val || val < -999) return TRANSPARENT;
  let normalized = val / maxAbs;
  if (normalized < -1) normalized = -1;
  if (normalized > 1) normalized = 1;

  // Map [-1, 1] to [0, 9]
  const index = (normalized + 1) / 2 * 9;
  const i1 = Math.floor(index);
  const i2 = Math.ceil(index);
  const progress = index - i1;

  if (i1 === i2) return DIFF_COLORS[i1];
  return interpolateColor32(DIFF_COLORS[i1], DIFF_COLORS[i2], progress);
}

export function getAbsoluteColorRgb(val: number): string {
  if (val === 0) return 'rgb(255, 255, 255)';

  if (val > 0) {
    const step = Math.min(val + 1, 10);
    if (step <= 5) {
      const gb = Math.round(255 - (step * 51));
      return `rgb(255, ${gb}, ${gb})`;
    } else {
      const r = Math.round(255 - ((step - 5) * 31));
      return `rgb(${r}, 0, 0)`;
    }
  } else {
    const step = Math.min(-val + 1, 10);
    if (step <= 5) {
      const rg = Math.round(255 - (step * 51));
      return `rgb(${rg}, ${rg}, 255)`;
    } else {
      const b = Math.round(255 - ((step - 5) * 31));
      return `rgb(0, 0, ${b})`;
    }
  }
}

export const SstaLegend = ({ minTemp = -2, maxTemp = 2, horizontal = false }: { minTemp?: number, maxTemp?: number, horizontal?: boolean }) => {
  const range = maxTemp - minTemp;
  // Aim for roughly 6-7 steps, but keep them as integers since colors change per degree
  const stepSize = Math.max(1, Math.round(range / 6));

  const steps = [];
  const start = Math.floor(minTemp);
  const end = Math.ceil(maxTemp);

  for (let val = end; val >= start; val -= stepSize) {
    steps.push({
      val,
      color: getAbsoluteColorRgb(val)
    });
  }

  return (
      <div className={`bg-[#09162a] border border-[#00d4ff]/12 p-2 font-data text-[16px] tracking-wider flex ${horizontal ? 'flex-row items-center justify-center gap-3 w-auto flex-wrap max-w-full' : 'flex-col justify-center gap-1 shrink-0 w-[100px]'}`}>
        <div className={`text-[#00d4ff]/40 uppercase text-center text-[12px] ${horizontal ? 'pr-2 border-r border-[#00d4ff]/15' : 'mb-1 border-b border-[#00d4ff]/15 pb-1'}`}>SSTa (°C)</div>
        {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 whitespace-nowrap text-[#a8c8e8]/60">
              <span className="w-2 h-2 shrink-0" style={{backgroundColor: step.color}}></span>
              {step.val > 0 ? '+' : ''}{step.val.toFixed(1)}
            </div>
        ))}
      </div>
  );
};

export function getAbsoluteColor32(val: number): number {
  if (val !== val || val < -999) return TRANSPARENT;
  if (val === 0) return rgba(255, 255, 255);

  if (val > 0) {
    const step = Math.min(val + 1, 10);
    if (step <= 5) {
      const gb = 255 - (step * 51) | 0;
      return rgba(255, gb, gb);
    } else {
      const r = 255 - ((step - 5) * 31) | 0;
      return rgba(r, 0, 0);
    }
  } else {
    const step = Math.min(-val + 1, 10);
    if (step <= 5) {
      const rg = 255 - (step * 51) | 0;
      return rgba(rg, rg, 255);
    } else {
      const b = 255 - ((step - 5) * 31) | 0;
      return rgba(0, 0, b);
    }
  }
}

const COLOR_LUT = new Uint32Array(20000);
for (let i = 0; i < 20000; i++) {
  const val = (i - 10000) / 100;
  COLOR_LUT[i] = getAbsoluteColor32(val);
}

export function getAbsoluteColor32Fast(val: number): number {
  if (val !== val || val < -999) return TRANSPARENT;
  const idx = Math.round(val * 100) + 10000;
  if (idx < 0) return COLOR_LUT[0];
  if (idx >= 20000) return COLOR_LUT[19999];
  return COLOR_LUT[idx];
}

// Keep old functions for backward compatibility if needed
export function getColorForSSTa(val: number): [number, number, number, number] {
  if (isNaN(val) || val < -999) return [0, 0, 0, 0];
  if (val < -2) return [5, 48, 97, 255];
  if (val < -1) return [33, 102, 172, 255];
  if (val < -0.5) return [67, 147, 195, 255];
  if (val < 0) return [146, 197, 222, 255];
  if (val < 0.5) return [244, 165, 130, 255];
  if (val < 1) return [214, 96, 77, 255];
  if (val < 2) return [178, 24, 43, 255];
  return [103, 0, 31, 255];
}

export function getColorForDifference(val: number, maxAbs: number): [number, number, number, number] {
  if (isNaN(val) || val < -999) return [0, 0, 0, 0];
  const normalized = Math.max(-1, Math.min(1, val / maxAbs));
  if (normalized < -0.8) return [49, 54, 149, 255];
  if (normalized < -0.6) return [69, 117, 180, 255];
  if (normalized < -0.4) return [116, 173, 209, 255];
  if (normalized < -0.2) return [171, 217, 233, 255];
  if (normalized < 0) return [224, 243, 248, 255];
  if (normalized < 0.2) return [254, 224, 144, 255];
  if (normalized < 0.4) return [253, 174, 97, 255];
  if (normalized < 0.6) return [244, 109, 67, 255];
  if (normalized < 0.8) return [215, 48, 39, 255];
  return [165, 0, 38, 255];
}

interface MapCanvasProps {
  data: number[] | Float32Array | null;
  width: number;
  height: number;
  flipY?: boolean;
  cmap?: 'sst' | 'difference';
  offset?: number;
  onClick?: () => void;
  allowSelection?: boolean;
  minTemp?: number;
  maxTemp?: number;
  animateTransition?: boolean;
  dataVersion?: number;
}

const globalMaskCache: Record<string, Uint8Array> = {};

const DetailedViewBox = ({ selectedPoint, cmap, onClose, containerRef }: { selectedPoint: any, cmap: string, onClose: () => void, containerRef?: React.RefObject<HTMLDivElement> }) => {
  const transformState = useTransformComponent(({ state }) => state);
  const scale = transformState?.scale ?? 1;
  const posX = transformState?.positionX ?? 0;
  const posY = transformState?.positionY ?? 0;

  if (!selectedPoint) return null;

  const transformedX = selectedPoint.x * scale + posX;
  const transformedY = selectedPoint.y * scale + posY;

  const containerWidth = containerRef?.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
  const containerHeight = containerRef?.current?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);

  const boxWidth = 192; // w-48 = 12rem = 192px
  const boxHeight = 220; // approximate height

  // Default position: bottom-right of the circle
  let left = transformedX + 15;
  let top = transformedY + 15;

  // Flip to left if it overflows right
  if (left + boxWidth > containerWidth - 12) {
    left = transformedX - boxWidth - 15;
  }

  // Flip to top if it overflows bottom
  if (top + boxHeight > containerHeight - 12) {
    top = transformedY - boxHeight - 15;
  }

  // Ensure it doesn't overflow left or top
  if (left < 12) left = 12;
  if (top < 12) top = 12;

  return (
      <div
          className="absolute w-48 bg-[#060f1c]/95 border border-[#00d4ff]/20 shadow-2xl p-3 z-50 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 zoom-in-95 duration-300 ease-out"
          style={{ left, top }}
      >
        <div className="flex justify-between items-center mb-2 border-b border-[#00d4ff]/15 pb-2">
          <h3 className="font-data text-[16px] tracking-[0.2em] uppercase text-[#00d4ff]/70">Area Info</h3>
          <button onClick={onClose} className="text-[#00d4ff]/40 hover:text-[#00d4ff] pointer-events-auto">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div className="space-y-2 text-[16px] font-data">
          <div className="flex justify-between">
            <span className="text-[#00d4ff]/40">Center Lat:</span>
            <span className="text-[#a8c8e8]">{selectedPoint.lat}°</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#00d4ff]/40">Center Lon:</span>
            <span className="text-[#a8c8e8]">{selectedPoint.lon}°</span>
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-[#00d4ff]/10">
            <span className="text-[#00d4ff]/40">{cmap === 'difference' ? 'Max Error:' : 'Max:'}</span>
            <span className="text-rose-400">{selectedPoint.max.toFixed(2)} °C</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#00d4ff]/40">{cmap === 'difference' ? 'Avg Error:' : 'Avg:'}</span>
            <span className="text-[#a8c8e8]">{selectedPoint.avg.toFixed(2)} °C</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#00d4ff]/40">Std Dev:</span>
            <span className="text-[#a8c8e8]">{selectedPoint.stdDev.toFixed(2)} °C</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#00d4ff]/40">{cmap === 'difference' ? 'Min Error:' : 'Min:'}</span>
            <span className="text-blue-400">{selectedPoint.min.toFixed(2)} °C</span>
          </div>
        </div>
      </div>
  );
};

export const MapCanvas = React.memo(function MapCanvas({ data, width, height, flipY = true, cmap = 'sst', offset = 0, onClick, allowSelection = false, minTemp: propMinTemp, maxTemp: propMaxTemp, animateTransition = true, dataVersion = 0 }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedPoint, setSelectedPoint] = useState<{ x: number, y: number, radiusRender: number, lat: string, lon: string, min: number, max: number, avg: number, stdDev: number, offsetX: number, offsetY: number, renderWidth: number, renderHeight: number, dataX: number, dataY: number } | null>(null);

  const prevOffsetRef = useRef(offset);
  const prevDataRef = useRef(data);
  const prevDataVersionRef = useRef(dataVersion);
  const animationRef = useRef<number | null>(null);
  const hasDrawnRef = useRef(false);

  const prevMinTempRef = useRef<number | undefined>(propMinTemp);
  const prevMaxTempRef = useRef<number | undefined>(propMaxTemp);
  const prevCmapRef = useRef(cmap);
  const maskRef = useRef<Uint8Array | null>(null);
  const imgDataRef = useRef<{ imgData: ImageData, buf32: Uint32Array, width: number, height: number } | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSelectedPoint(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || width === 0 || height === 0) return;
    // NOTE: no `desynchronized: true` here. That low-latency hint routes the
    // canvas through a separate hardware overlay on Chrome/Windows, which
    // upscales with linear filtering and ignores image-rendering:pixelated,
    // making the map look blurry.
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let maxAbs = 0.1;
    let minTemp = propMinTemp !== undefined ? propMinTemp : 999;
    let maxTemp = propMaxTemp !== undefined ? propMaxTemp : -999;

    if (cmap === 'difference') {
      const end = offset + width * height;
      for (let i = offset; i < end; i++) {
        const val = data[i];
        if (val > -999 && val === val) {
          const absVal = val < 0 ? -val : val;
          if (absVal > maxAbs) maxAbs = absVal;
        }
      }
    } else if (propMinTemp === undefined || propMaxTemp === undefined) {
      const end = offset + width * height;
      for (let i = offset; i < end; i++) {
        const val = data[i];
        if (val > -999 && val === val) {
          if (val < minTemp) minTemp = val;
          if (val > maxTemp) maxTemp = val;
        }
      }
      if (minTemp === 999) minTemp = -2;
      if (maxTemp === -999) maxTemp = 2;
    }

    if (!imgDataRef.current || imgDataRef.current.width !== width || imgDataRef.current.height !== height) {
      const imgData = ctx.createImageData(width, height);
      const buf32 = new Uint32Array(imgData.data.buffer);
      imgDataRef.current = { imgData, buf32, width, height };
    }
    const { imgData, buf32 } = imgDataRef.current;

    const CONTINENT_COLOR = rgba(255, 255, 255, 255);
    const OUTLINE_COLOR = rgba(0, 0, 0, 255);
    const isOcean = (v: number) => v === v && v >= -999;

    const cacheKey = `${width}x${height}`;
    if (!globalMaskCache[cacheKey]) {
      const mask = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          mask[idx] = isOcean(data[idx]) ? 0 : 1;
        }
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (mask[idx] === 1) {
            let isOutline = false;
            if (y > 0 && mask[idx - width] === 0) isOutline = true;
            else if (y < height - 1 && mask[idx + width] === 0) isOutline = true;
            else if (x > 0 && mask[idx - 1] === 0) isOutline = true;
            else if (x < width - 1 && mask[idx + 1] === 0) isOutline = true;
            if (isOutline) mask[idx] = 2;
          }
        }
      }
      globalMaskCache[cacheKey] = mask;
    }
    const mask = globalMaskCache[cacheKey];

    const drawFrame = (progress: number, fromData: number[] | Float32Array, fromOffset: number, toData: number[] | Float32Array, toOffset: number, currentMinTemp?: number, currentMaxTemp?: number) => {
      const isSame = progress >= 1 || (fromData === toData && fromOffset === toOffset);

      if (cmap === 'sst') {
        if (isSame) {
          for (let y = 0; y < height; y++) {
            const renderY = flipY ? (height - 1 - y) : y;
            const rowOffset = renderY * width;
            const toDataOffset = toOffset + y * width;
            const maskOffset = y * width;
            for (let x = 0; x < width; x++) {
              const m = mask[maskOffset + x];
              if (m === 0) {
                buf32[rowOffset + x] = getAbsoluteColor32Fast(toData[toDataOffset + x]);
              } else {
                buf32[rowOffset + x] = m === 2 ? OUTLINE_COLOR : CONTINENT_COLOR;
              }
            }
          }
        } else {
          for (let y = 0; y < height; y++) {
            const renderY = flipY ? (height - 1 - y) : y;
            const rowOffset = renderY * width;
            const fromDataOffset = fromOffset + y * width;
            const toDataOffset = toOffset + y * width;
            const maskOffset = y * width;
            for (let x = 0; x < width; x++) {
              const m = mask[maskOffset + x];
              if (m === 0) {
                const valFrom = fromData[fromDataOffset + x];
                const valTo = toData[toDataOffset + x];
                if (valFrom !== valFrom || valFrom < -999 || valTo !== valTo || valTo < -999) {
                  buf32[rowOffset + x] = getAbsoluteColor32Fast(valTo);
                } else {
                  buf32[rowOffset + x] = getAbsoluteColor32Fast(valFrom + (valTo - valFrom) * progress);
                }
              } else {
                buf32[rowOffset + x] = m === 2 ? OUTLINE_COLOR : CONTINENT_COLOR;
              }
            }
          }
        }
      } else {
        if (isSame) {
          for (let y = 0; y < height; y++) {
            const renderY = flipY ? (height - 1 - y) : y;
            const rowOffset = renderY * width;
            const toDataOffset = toOffset + y * width;
            const maskOffset = y * width;
            for (let x = 0; x < width; x++) {
              const m = mask[maskOffset + x];
              if (m === 0) {
                buf32[rowOffset + x] = getColor32ForDifference(toData[toDataOffset + x], maxAbs);
              } else {
                buf32[rowOffset + x] = m === 2 ? OUTLINE_COLOR : CONTINENT_COLOR;
              }
            }
          }
        } else {
          for (let y = 0; y < height; y++) {
            const renderY = flipY ? (height - 1 - y) : y;
            const rowOffset = renderY * width;
            const fromDataOffset = fromOffset + y * width;
            const toDataOffset = toOffset + y * width;
            const maskOffset = y * width;
            for (let x = 0; x < width; x++) {
              const m = mask[maskOffset + x];
              if (m === 0) {
                const valFrom = fromData[fromDataOffset + x];
                const valTo = toData[toDataOffset + x];
                if (valFrom !== valFrom || valFrom < -999 || valTo !== valTo || valTo < -999) {
                  buf32[rowOffset + x] = getColor32ForDifference(valTo, maxAbs);
                } else {
                  buf32[rowOffset + x] = getColor32ForDifference(valFrom + (valTo - valFrom) * progress, maxAbs);
                }
              } else {
                buf32[rowOffset + x] = m === 2 ? OUTLINE_COLOR : CONTINENT_COLOR;
              }
            }
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    };

    if (!hasDrawnRef.current) {
      drawFrame(1, data, offset, data, offset, minTemp, maxTemp);
      prevOffsetRef.current = offset;
      prevDataRef.current = data;
      prevDataVersionRef.current = dataVersion;
      prevMinTempRef.current = minTemp;
      prevMaxTempRef.current = maxTemp;
      prevCmapRef.current = cmap;
      hasDrawnRef.current = true;
      return;
    }

    if (prevCmapRef.current !== cmap) {
      drawFrame(1, data, offset, data, offset, minTemp, maxTemp);
      prevOffsetRef.current = offset;
      prevDataRef.current = data;
      prevDataVersionRef.current = dataVersion;
      prevMinTempRef.current = minTemp;
      prevMaxTempRef.current = maxTemp;
      prevCmapRef.current = cmap;
      return;
    }

    if (prevDataRef.current === data && prevDataVersionRef.current === dataVersion && prevOffsetRef.current === offset && prevMinTempRef.current === minTemp && prevMaxTempRef.current === maxTemp && prevCmapRef.current === cmap) {
      // Nothing changed, no need to redraw
      return;
    }

    if (animateTransition && prevDataRef.current !== null && prevOffsetRef.current !== null && (prevDataRef.current === data || prevDataVersionRef.current !== dataVersion)) {
      const fromData = prevDataRef.current;
      const fromOffset = prevOffsetRef.current;
      const toData = data;
      const toOffset = offset;

      const fromMinTemp = prevMinTempRef.current !== undefined ? prevMinTempRef.current : 999;
      const fromMaxTemp = prevMaxTempRef.current !== undefined ? prevMaxTempRef.current : -999;
      const toMinTemp = minTemp;
      const toMaxTemp = maxTemp;

      let startTime: number | null = null;
      const duration = 600; // 600ms transition

      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        let progress = elapsed / duration;
        if (progress > 1) progress = 1;

        // Easing function (easeOutCubic)
        const easeProgress = progress === 1 ? 1 : 1 - Math.pow(1 - progress, 3);

        const currentMinTemp = fromMinTemp + (toMinTemp - fromMinTemp) * easeProgress;
        const currentMaxTemp = fromMaxTemp + (toMaxTemp - fromMaxTemp) * easeProgress;

        drawFrame(easeProgress, fromData, fromOffset, toData, toOffset, currentMinTemp, currentMaxTemp);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          prevOffsetRef.current = offset;
          prevDataRef.current = data;
          prevDataVersionRef.current = dataVersion;
          prevMinTempRef.current = minTemp;
          prevMaxTempRef.current = maxTemp;
          prevCmapRef.current = cmap;
        }
      };

      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = requestAnimationFrame(animate);
    } else {
      drawFrame(1, data, offset, data, offset, minTemp, maxTemp);
      prevOffsetRef.current = offset;
      prevDataRef.current = data;
      prevDataVersionRef.current = dataVersion;
      prevMinTempRef.current = minTemp;
      prevMaxTempRef.current = maxTemp;
      prevCmapRef.current = cmap;
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [data, dataVersion, width, height, flipY, cmap, offset, propMinTemp, propMaxTemp, animateTransition]);

  // Approximate lat/lon mapping for a global grid
  // Assuming standard 0-360 lon (or -180 to 180) and -90 to 90 lat
  const getLatLon = (x: number, y: number) => {
    const lon = (x / width) * 360 - 180;
    const lat = (y / height) * 180 - 90;
    return { lat: lat.toFixed(2), lon: lon.toFixed(2) };
  };

  const getEventCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();

    let clientX, clientY;
    if ('touches' in e) {
      if (e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        return null;
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const canvasAspect = width / height;
    const rectAspect = rect.width / rect.height;

    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (canvasAspect > rectAspect) {
      renderHeight = rect.width / canvasAspect;
      offsetY = (rect.height - renderHeight) / 2;
    } else {
      renderWidth = rect.height * canvasAspect;
      offsetX = (rect.width - renderWidth) / 2;
    }

    const imageX = clientX - rect.left - offsetX;
    const imageY = clientY - rect.top - offsetY;

    if (imageX < 0 || imageX >= renderWidth || imageY < 0 || imageY >= renderHeight) {
      return null;
    }

    const scaleX = width / renderWidth;
    const scaleY = height / renderHeight;

    return {
      x: Math.floor(imageX * scaleX),
      y: Math.floor(imageY * scaleY),
      renderX: imageX + offsetX,
      renderY: imageY + offsetY,
      radiusRender: 10 / scaleX,
      offsetX,
      offsetY,
      renderWidth,
      renderHeight
    };
  };

  useEffect(() => {
    if (selectedPoint && data && width > 0 && height > 0) {
      const radius = 10;
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = 0;
      const values: number[] = [];

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx*dx + dy*dy <= radius*radius) {
            const nx = selectedPoint.dataX + dx;
            const ny = selectedPoint.dataY + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const val = data[offset + ny * width + nx];
              if (val > -999 && !isNaN(val)) {
                if (val < min) min = val;
                if (val > max) max = val;
                sum += val;
                count++;
                values.push(val);
              }
            }
          }
        }
      }

      if (count > 0) {
        const avg = sum / count;
        const squareDiffs = values.map(value => {
          const diff = value - avg;
          return diff * diff;
        });
        const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / count;
        const stdDev = Math.sqrt(avgSquareDiff);

        setSelectedPoint(prev => {
          if (!prev) return null;
          return {
            ...prev,
            min,
            max,
            avg,
            stdDev
          };
        });
      }
    }
  }, [data, offset, width, height, selectedPoint?.dataX, selectedPoint?.dataY]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (onClick) {
      onClick();
      return;
    }

    if (!allowSelection || !data) return;

    const coords = getEventCoordinates(e);
    if (!coords) return;

    const { x, y, renderX, renderY, radiusRender, offsetX, offsetY, renderWidth, renderHeight } = coords;

    if (x >= 0 && x < width && y >= 0 && y < height) {
      const dataY = flipY ? (height - 1 - y) : y;

      const radius = 10;
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = 0;
      const values: number[] = [];

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx*dx + dy*dy <= radius*radius) {
            const nx = x + dx;
            const ny = dataY + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const val = data[offset + ny * width + nx];
              if (val > -999 && !isNaN(val)) {
                if (val < min) min = val;
                if (val > max) max = val;
                sum += val;
                count++;
                values.push(val);
              }
            }
          }
        }
      }

      if (count > 0) {
        const avg = sum / count;
        const squareDiffs = values.map(value => {
          const diff = value - avg;
          return diff * diff;
        });
        const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / count;
        const stdDev = Math.sqrt(avgSquareDiff);

        const { lat, lon } = getLatLon(x, dataY);

        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const canvasAspect = width / height;
          const containerAspect = containerRect.width / containerRect.height;

          let untransformedRenderWidth = containerRect.width;
          let untransformedRenderHeight = containerRect.height;
          let untransformedOffsetX = 0;
          let untransformedOffsetY = 0;

          if (canvasAspect > containerAspect) {
            untransformedRenderHeight = containerRect.width / canvasAspect;
            untransformedOffsetY = (containerRect.height - untransformedRenderHeight) / 2;
          } else {
            untransformedRenderWidth = containerRect.height * canvasAspect;
            untransformedOffsetX = (containerRect.width - untransformedRenderWidth) / 2;
          }

          const untransformedRenderX = (x / width) * untransformedRenderWidth + untransformedOffsetX;
          const untransformedRenderY = (y / height) * untransformedRenderHeight + untransformedOffsetY;
          const untransformedRadiusRender = 10 * (untransformedRenderWidth / width);

          setSelectedPoint({
            x: untransformedRenderX,
            y: untransformedRenderY,
            radiusRender: untransformedRadiusRender,
            lat,
            lon,
            min,
            max,
            avg,
            stdDev,
            offsetX: untransformedOffsetX,
            offsetY: untransformedOffsetY,
            renderWidth: untransformedRenderWidth,
            renderHeight: untransformedRenderHeight,
            dataX: x,
            dataY: dataY
          });
        }
      }
    }
  };

  if (!data) return <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[16px]">No data</div>;

  const renderCanvasContent = () => (
      <>
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className={`w-full h-full object-contain bg-black rounded-lg ${onClick ? 'cursor-pointer' : (allowSelection ? 'cursor-crosshair' : '')}`}
            style={{ imageRendering: 'pixelated', touchAction: allowSelection ? 'none' : 'auto' }}
            onClick={handleCanvasClick}
        />

        {/* Selection Circle.
            The <svg> is always rendered (not just when a point is selected) so it
            shares the canvas's transform layer. This forces Chrome to paint the
            canvas into the parent layer at full display resolution with the
            canvas's image-rendering:pixelated honored, instead of bilinear-scaling
            a cached low-res texture (which made the map look blurry until the
            detail view was opened). */}
        {/* Selection Circle */}
        {selectedPoint && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r={selectedPoint.radiusRender} fill="none" stroke="black" strokeWidth="2" strokeDasharray="4 2" vectorEffect="non-scaling-stroke" />
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r="3" fill="black" vectorEffect="non-scaling-stroke" />
            </svg>
        )}
      </>
  );

  return (
      <div className="relative w-full h-full group overflow-hidden" ref={containerRef}>
        {allowSelection ? (
            <TransformWrapper
                initialScale={typeof window !== 'undefined' && window.innerWidth < 640 ? 2.5 : 1}
                minScale={1}
                maxScale={8}
                centerOnInit
                wheel={{ step: 0.1 }}
                doubleClick={{ disabled: true }}
                panning={{ disabled: false }}

            >
              <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full">
                {renderCanvasContent()}
              </TransformComponent>
              <DetailedViewBox selectedPoint={selectedPoint} cmap={cmap} onClose={() => setSelectedPoint(null)} containerRef={containerRef} />
            </TransformWrapper>
        ) : (
            <>
              {renderCanvasContent()}
            </>
        )}

        {onClick && (
            <div className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none backdrop-blur-sm border border-white/10">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            </div>
        )}
      </div>
  );
});
