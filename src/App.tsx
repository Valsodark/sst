import React, {useState, useEffect, useRef, useMemo} from 'react';
import {
  Play, Pause,
  Map as MapIcon, Activity,
  Settings,
  Thermometer, AlertTriangle, Info, Loader2, CheckCircle2,
  ChevronDown, Menu, X
} from 'lucide-react';
import { format, addDays, parseISO } from 'date-fns';
import { cn } from './lib/utils';
import { MapCanvas, SstaLegend } from './components/MapCanvas';
import { DatePicker } from './components/DatePicker';
import { StatBox as StatBoxComponent } from "./components/StatBox";
// @ts-ignore
import h5wasm from 'h5wasm';
import { calculateBasinMetrics, BasinMetric } from './lib/basinMetrics';

const DIFF_ENTRIES = [
  { color: 'rgb(165,0,38)',   label: '≥ 0.8' },
  { color: 'rgb(215,48,39)',  label: '0.6–0.8' },
  { color: 'rgb(244,109,67)', label: '0.4–0.6' },
  { color: 'rgb(253,174,97)', label: '0.2–0.4' },
  { color: 'rgb(254,224,144)',label: '0.0–0.2' },
  { color: 'rgb(224,243,248)',label: '-0.2–0' },
  { color: 'rgb(171,217,233)',label: '-0.4–-0.2' },
  { color: 'rgb(116,173,209)',label: '-0.6–-0.4' },
  { color: 'rgb(69,117,180)', label: '-0.8–-0.6' },
  { color: 'rgb(49,54,149)',  label: '< -0.8' },
];

const DiffLegend = ({ horizontal = false }: { horizontal?: boolean }) => (
  <div className={`bg-[#060f1c] border border-[#00d4ff]/12 p-2 font-data text-[16px] tracking-wider flex ${horizontal ? 'flex-row items-center justify-center gap-3 w-auto flex-wrap max-w-full' : 'flex-col justify-center gap-1 shrink-0 w-[100px]'}`}>
    <div className={`text-[#00d4ff]/40 uppercase text-center ${horizontal ? 'pr-2 border-r border-[#00d4ff]/15' : 'mb-1 border-b border-[#00d4ff]/15 pb-1'}`}>Error</div>
    {DIFF_ENTRIES.map(({ color, label }) => (
      <div key={label} className="flex items-center gap-1.5 whitespace-nowrap text-[#a8c8e8]/60">
        <span className="w-2 h-2 shrink-0" style={{ backgroundColor: color }} />
        {label}
      </div>
    ))}
  </div>
);

// --- Interfaces ---
interface PredictionResult {
  start_date: string;
  target_date: string;
  message: string;
  mse: number | null;
  hasActual: boolean;
  input: Float32Array;
  prediction: Float32Array;
  actual: Float32Array | null;
  difference: Float32Array | null;
  width: number;
  height: number;
  input_min_temps: number[];
  input_max_temps: number[];
  pred_min_temp: number;
  pred_max_temp: number;
  actual_min_temp?: number;
  actual_max_temp?: number;
}

export default function App() {
  const [apiUrl, setApiUrl] = useState<string>('https://trimuerto-stta-app.hf.space');
  const [targetDate, setTargetDate] = useState<string>('2026-03-18');
  const [selectedModel, setSelectedModel] = useState<string>('best_sst_convlstm.keras');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);

  const [timeStep, setTimeStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [predictionView, setPredictionView] = useState<'prediction' | 'actual' | 'difference'>('prediction');
  const [isViewTransitioning, setIsViewTransitioning] = useState(false);
  const [suppressNextMainAnimation, setSuppressNextMainAnimation] = useState(false);
  const [timelineData, setTimelineData] = useState<Float32Array | null>(null);
  const [timelineDataVersion, setTimelineDataVersion] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [aiSummaryText, setAiSummaryText] = useState<string | null>(null);
  const [isAiSummaryModalOpen, setIsAiSummaryModalOpen] = useState(false);

  useEffect(() => {
    setAiSummaryText(null);
    setAiSummaryError(null);
  }, [result]);

  // console.log('App rendering, timeStep:', timeStep, 'result exists:', !!result);

  const [openSections, setOpenSections] = useState<Array<'controls' | 'metrics' | 'about'>>(['controls', 'metrics']);
  const [isMobile, setIsMobile] = useState(false);

  // Track mobile viewport (below the lg breakpoint where the drawer is used)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => {
      setIsMobile(mq.matches);
      // On mobile, collapse to a single open accordion — keep Mission Parameters open
      if (mq.matches) setOpenSections(prev => (prev.length > 1 ? ['controls'] : prev));
    };
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Lock background scroll while the mobile drawer is open
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isMobileMenuOpen]);

  const toggleSection = (section: 'controls' | 'metrics' | 'about') => {
    setOpenSections(prev => {
      if (prev.includes(section)) {
        return prev.filter(s => s !== section);
      }
      // On mobile only one accordion may be open at a time
      if (isMobile) {
        return [section];
      }
      const next = [...prev, section];
      if (next.length > 2) {
        next.shift();
      }
      return next;
    });
  };

  const getDay11FrameData = (view: 'prediction' | 'actual' | 'difference', nextResult: PredictionResult) => {
    if (view === 'actual' && nextResult.actual) return nextResult.actual;
    if (view === 'difference' && nextResult.difference) return nextResult.difference;
    return nextResult.prediction;
  };

  const handleViewChange = (newView: 'prediction' | 'actual' | 'difference') => {
    if (!result || newView === predictionView) return;

    setIsViewTransitioning(true);
    setSuppressNextMainAnimation(true);

    requestAnimationFrame(() => {
      if (timelineData) {
        timelineData.set(getDay11FrameData(newView, result), 10 * frameSize);
        setTimelineDataVersion(v => v + 1);
      }

      setPredictionView(newView);

      requestAnimationFrame(() => {
        setIsViewTransitioning(false);
        setTimeout(() => setSuppressNextMainAnimation(false), 0);
      });
    });
  };
  const handleOpenSummary = () => {
    setIsAiSummaryModalOpen(true);
    if (!aiSummaryText && !aiSummaryLoading) {
      fetchAiSummary();
    }
  };

  const fetchAiSummary = async () => {
    if (!result || !timelineData || aiSummaryText || aiSummaryLoading) return;

    setAiSummaryLoading(true);
    setAiSummaryError(null);
    setAiSummaryText(null);

    try {
      const selectedDate = result.target_date;
      const dataType = result.actual ? 'Prediction and Ground Truth' : 'Prediction';
      const summaryTimeStep = 10;

      let csvData = `Date,DataType,TimeStep,Basin,Mean,Max,Min,Median,StdDev,Pct>1C,Pct>2C,Pct<-1C\n`;
      const appendMetricsToCsv = (metrics: BasinMetric[], tStep: number, dateStr: string, dType: string) => {
        metrics.forEach(m => {
          csvData += `${dateStr},${dType},Day ${tStep + 1},${m.basinName},${m.meanAnomaly.toFixed(2)},${m.maxAnomaly.toFixed(2)},${m.minAnomaly.toFixed(2)},${m.medianAnomaly.toFixed(2)},${m.stdDev.toFixed(2)},${m.percentAbove1.toFixed(1)}%,${m.percentAbove2.toFixed(1)}%,${m.percentBelowMinus1.toFixed(1)}%\n`;
        });
      };

      for (let i = 0; i < 10; i++) {
        const historyDate = format(addDays(parseISO(result.start_date), i), 'yyyy-MM-dd');
        const historyMetrics = calculateBasinMetrics(result.input, result.width, result.height, i * result.width * result.height);
        appendMetricsToCsv(historyMetrics, i, historyDate, 'Input Data');
      }

      const predDate = result.target_date;
      const predMetrics = calculateBasinMetrics(result.prediction, result.width, result.height, 0);
      appendMetricsToCsv(predMetrics, 10, predDate, 'Prediction');

      if (result.actual) {
        const actMetrics = calculateBasinMetrics(result.actual, result.width, result.height, 0);
        appendMetricsToCsv(actMetrics, 10, predDate, 'Ground Truth');
      }

      const prompt = `You are generating a short-term ocean basin summary from sea-surface temperature anomaly data. Use only the provided basin data.

The user has selected the date: ${selectedDate} (Day ${summaryTimeStep + 1}, ${dataType}).

Focus primarily on the selected date and the 10 days leading up to it. Identify:
- the warmest basin
- the basin with the strongest warm-anomaly extent
- recent warming, cooling, or stability
- persistence of positive anomalies
- any notable basin-specific event

Do not invent missing facts. Do not overclaim. Do not discuss long-term climate trends unless they are directly supported by the provided data. Keep the language clear, concise, and non-technical. Do not use the asterisk symbol "*". Use proper symbols like % and °C.

You must follow this exact output format and section order. Use these section titles exactly as written, without quotation marks:

Assessment of the 10 days leading to the ${selectedDate}.

Write exactly one concise paragraph summarizing the basin conditions for the selected date and the short-term behavior leading up to it.

Highlights

Write exactly 5 bullet points, one for each ocean:
- Pacific
- Atlantic
- Indian
- Southern
- Arctic

Each bullet point should describe one important takeaway based only on the data.

Comparison of Prediction and Ground Truth

If both Prediction and Ground Truth data are present for the selected date, write a short comparison paragraph explaining how closely the prediction matches the ground truth and where they differ most.

If both Prediction and Ground Truth data are not present for the selected date, write exactly:
Not available for this date.

Rules:
- Use the section titles exactly as written above
- Do not add any extra sections
- Do not skip the comparison section
- Do not use markdown tables
- Do not use bold formatting
- Do not use asterisks
- Keep the result compact and readable
- Base everything only on the provided data

Data (CSV format):
${csvData}`;

      // @ts-ignore
      const puter = window.puter;
      if (!puter?.ai?.chat) {
        throw new Error('Puter is unavailable. The AI service script may be blocked by your network or an ad blocker — try disabling it or check your connection.');
      }

      // Puter uses a "User Pays" model: the first AI call triggers Puter's own
      // sign-in popup. Prompt for sign-in explicitly so we can handle the user
      // cancelling it gracefully, rather than letting ai.chat() throw opaquely.
      try {
        if (puter.auth?.isSignedIn && !puter.auth.isSignedIn()) {
          await puter.auth.signIn();
        }
      } catch {
        throw new Error('Sign-in required. The AI summary is an optional feature powered by Puter — sign in (or create a free account) in the popup to use it. The rest of the app works without it.');
      }

      const response = await puter.ai.chat(prompt);
      const raw = response?.message?.content ?? response;
      let text: string;
      if (typeof raw === 'string') {
        text = raw;
      } else if (Array.isArray(raw)) {
        text = raw.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') || 'No summary generated.';
      } else {
        text = 'No summary generated.';
      }
      setAiSummaryText(text);
    } catch (err: any) {
      console.error('Error generating AI summary:', err);
      setAiSummaryError(err.message || 'Failed to generate summary.');
    } finally {
      setAiSummaryLoading(false);
    }
  };

  const [fullScreenMap, setFullScreenMap] = useState<'main' | 'prediction' | 'actual' | 'difference' | null>(null);


  const handlePredict = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setIsPlaying(false);
    setResult(null);
    setTimeStep(0);

    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      const baseUrl = apiUrl.replace(/\/$/, '');
      // console.log('Fetching data...');
      const response = await fetch(`${baseUrl}/predict?start_date=${targetDate}&model=${selectedModel}`, {
        method: 'GET',
      });

      // console.log('Response received, status:', response.status);
      if (!response.ok) {
        let errorMsg = `Server error: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) errorMsg = errorData.detail;
        } catch (e) {
          errorMsg = await response.text();
        }
        setError(errorMsg);
        return;
      }

      // console.log('Reading array buffer...');
      const arrayBuffer = await response.arrayBuffer();
      // console.log('Array buffer read, size:', arrayBuffer.byteLength);

      const header = new Uint8Array(arrayBuffer.slice(0, 8));
      const isHDF5 = header[0] === 0x89 && header[1] === 0x48 && header[2] === 0x44 && header[3] === 0x46;
      if (!isHDF5) {
        const isCDF = header[0] === 0x43 && header[1] === 0x44 && header[2] === 0x46;
        const hex = Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' ');
        throw new Error(
          isCDF
            ? 'Server returned NetCDF3 (classic CDF) format — h5wasm requires NetCDF4 (HDF5). Fix the backend: use format="NETCDF4" when writing the file.'
            : `Server returned an unrecognised file (header: ${hex}). Expected an HDF5/NetCDF4 file.`
        );
      }

      // console.log('Parsing NetCDF4...');
      // @ts-ignore
      const { FS } = await h5wasm.ready;
      const filepath = '/tmp/pred.nc';
      FS.writeFile(filepath, new Uint8Array(arrayBuffer));
      // Suppress HDF5 driver-probe diagnostics — libhdf5-wasm probes multiple
      // file drivers and logs cascading warnings before settling on the right one.
      const origConsoleError = console.error;
      console.error = () => {};
      // @ts-ignore
      const ncFile = new h5wasm.File(filepath, 'r');
      console.error = origConsoleError;
      // console.log('NetCDF4 parsed successfully');

      try {
        await new Promise(resolve => setTimeout(resolve, 0));

        const getAttr = (name: string) => {
          const attr = (ncFile.attrs as any)[name];
          if (!attr) return undefined;
          const val = attr.value;
          if ((ArrayBuffer.isView(val) || Array.isArray(val)) && (val as any).length === 1) return (val as any)[0];
          return val;
        };

        const getFloat32Array = (variableName: string): Float32Array | null => {
          const ds = (ncFile as any).get(variableName);
          if (!ds) return null;
          const val = ds.value;
          if (val instanceof Float32Array) return val;
          return new Float32Array(val as number[]);
        };

        const hasActualAttr = getAttr('has_actual') === 1;

        // console.log('Extracting variables...');
        console.time('Extract Input');
        const inputData = getFloat32Array('input')!;
        console.timeEnd('Extract Input');

        await new Promise(resolve => setTimeout(resolve, 0));

        console.time('Extract Prediction');
        const predictionData = getFloat32Array('prediction')!;
        console.timeEnd('Extract Prediction');

        await new Promise(resolve => setTimeout(resolve, 0));

        console.time('Extract Actual');
        // Load "actual" (ground truth) whenever it's present in the file, not just
        // when the has_actual attribute is set — some responses omit the attribute.
        const actualData = getFloat32Array('actual');
        const hasActual = hasActualAttr || actualData !== null;
        console.timeEnd('Extract Actual');

        await new Promise(resolve => setTimeout(resolve, 0));

        console.time('Extract Difference');
        let differenceData = getFloat32Array('difference');
        if (!differenceData && actualData && predictionData) {
          // Backend didn't include a difference map — derive it as (prediction − actual)
          // so the Error view works. Positive ⇒ over-predicted (red), negative ⇒ under (blue).
          const diff = new Float32Array(predictionData.length);
          for (let i = 0; i < diff.length; i++) {
            const p = predictionData[i];
            const a = actualData[i];
            diff[i] = (p !== p || p < -999 || a !== a || a < -999) ? NaN : p - a;
          }
          differenceData = diff;
        }
        console.timeEnd('Extract Difference');

        await new Promise(resolve => setTimeout(resolve, 0));

        // console.log('Setting result state...');
        setResult({
          start_date: getAttr('start_date') as string,
          target_date: getAttr('target_date') as string,
          message: getAttr('message') as string,
          mse: getAttr('mse') !== -1.0 ? getAttr('mse') as number : null,
          input_min_temps: Array.from(getAttr('input_min_temps') as any || []),
          input_max_temps: Array.from(getAttr('input_max_temps') as any || []),
          pred_min_temp: getAttr('pred_min_temp') as number,
          pred_max_temp: getAttr('pred_max_temp') as number,
          actual_min_temp: hasActual ? getAttr('actual_min_temp') as number : undefined,
          actual_max_temp: hasActual ? getAttr('actual_max_temp') as number : undefined,
          hasActual,
          input: inputData,
          prediction: predictionData,
          actual: actualData,
          difference: differenceData,
          width: 1080,
          height: 511
        });

        setPredictionView('prediction');
        setTimeStep(10);
        // console.log('Result state set');
      } finally {
        ncFile.close();
        try { FS.unlink(filepath); } catch {}
      }
    } catch (err) {
      console.error('Error in handlePredict:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
      // console.log('handlePredict finished');
    }
  };

  // Animation loop
  useEffect(() => {
    let interval: number;
    if (isPlaying && result) {
      interval = window.setInterval(() => {
        setTimeStep(prev => {
          if (prev >= 10) {
            return 0;
          }
          return prev + 1;
        });
      }, 800);
    }
    return () => clearInterval(interval);
  }, [isPlaying, result]);

  const parsedTargetDate = useMemo(() => result ? parseISO(result.target_date) : parseISO(targetDate), [result, targetDate]);
  const startDate = useMemo(() => addDays(parsedTargetDate, -10), [parsedTargetDate]);
  const currentDate = format(addDays(startDate, timeStep), 'MMM dd, yyyy');
  const frameSize = useMemo(() => result ? result.width * result.height : 0, [result]);

  const predictionViewRef = useRef(predictionView);
  useEffect(() => {
    predictionViewRef.current = predictionView;
  }, [predictionView]);

  useEffect(() => {
    if (!result || !frameSize) {
      setTimelineData(null);
      return;
    }

    const combined = new Float32Array(11 * frameSize);
    combined.set(result.input, 0);

    let day11Data = result.prediction;
    if (predictionViewRef.current === 'actual' && result.actual) {
      day11Data = result.actual;
    } else if (predictionViewRef.current === 'difference' && result.difference) {
      day11Data = result.difference;
    }

    combined.set(day11Data, 10 * frameSize);
    setTimelineData(combined);
    setTimelineDataVersion(v => v + 1);
  }, [result, frameSize]);

  const currentMap = useMemo(() => {
    if (!result || !timelineData || !frameSize) return null;

    const isDay11 = timeStep === 10;
    const day11Map =
        predictionView === 'actual' && result.actual ? {
              cmap: 'sst' as const,
              minTemp: result.actual_min_temp,
              maxTemp: result.actual_max_temp,
              title: 'Ground Truth'
            } :
            predictionView === 'difference' && result.difference ? {
              cmap: 'difference' as const,
              minTemp: undefined,
              maxTemp: undefined,
              title: 'Error (Difference)'
            } : {
              cmap: 'sst' as const,
              minTemp: result.pred_min_temp,
              maxTemp: result.pred_max_temp,
              title: 'ConvLSTM Prediction'
            };

    return {
      data: timelineData,
      offset: timeStep * frameSize,
      cmap: isDay11 ? day11Map.cmap : ('sst' as const),
      minTemp: isDay11 ? day11Map.minTemp : result.input_min_temps?.[timeStep],
      maxTemp: isDay11 ? day11Map.maxTemp : result.input_max_temps?.[timeStep],
      title: isDay11 ? day11Map.title : `Input Data - Day ${timeStep + 1}`
    };
  }, [result, timelineData, frameSize, timeStep, predictionView]);

  const fullScreenMapProps = useMemo(() => {
    if (!fullScreenMap || !result) return null;
    if (fullScreenMap === 'main' && currentMap) {
      return {
        data: currentMap.data,
        width: result.width,
        height: result.height,
        cmap: currentMap.cmap,
        title: currentMap.title,
        offset: currentMap.offset,
        minTemp: currentMap.minTemp,
        maxTemp: currentMap.maxTemp,
        showTimeline: true
      };
    } else if (fullScreenMap === 'prediction') {
      return {
        data: result.prediction,
        width: result.width,
        height: result.height,
        cmap: 'sst' as const,
        title: 'ConvLSTM Prediction',
        minTemp: result.pred_min_temp,
        maxTemp: result.pred_max_temp,
        showTimeline: false
      };
    } else if (fullScreenMap === 'actual' && result.actual) {
      return {
        data: result.actual,
        width: result.width,
        height: result.height,
        cmap: 'sst' as const,
        title: 'Ground Truth',
        minTemp: result.actual_min_temp,
        maxTemp: result.actual_max_temp,
        showTimeline: false
      };
    } else if (fullScreenMap === 'difference' && result.difference) {
      return {
        data: result.difference,
        width: result.width,
        height: result.height,
        cmap: 'difference' as const,
        title: 'Error (Difference)',
        showTimeline: false
      };
    }
    return null;
  }, [fullScreenMap, result, currentMap]);

  return (
      <div className="min-h-screen flex flex-col" style={{background:'var(--ocean-black)',color:'var(--data-white)',fontFamily:"'Chakra Petch',sans-serif"}}>

        {/* ── HEADER ─────────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 border-b" style={{background:'rgba(4,12,20,0.92)',borderColor:'rgba(0,212,255,0.1)',backdropFilter:'blur(12px)'}}>
          <div className="max-w-[1400px] mx-auto px-4 h-12 flex items-center justify-between">

            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="relative w-7 h-7 flex items-center justify-center" style={{border:'1px solid rgba(0,212,255,0.35)',transform:'rotate(45deg)'}}>
                <Thermometer className="w-3.5 h-3.5" style={{color:'#00d4ff',transform:'rotate(-45deg)'}} />
              </div>
              <div>
                <div className="text-sm font-bold tracking-[0.12em]" style={{color:'#d4eaf7'}}>
                  Ocean<span style={{color:'#00d4ff'}}>AI</span>
                </div>
                <div className="font-data text-[9px] tracking-[0.22em] uppercase" style={{color:'rgba(0,212,255,0.4)'}}>
                  ConvLSTM SSTa v2
                </div>
              </div>
            </div>

            {/* Center readout */}
            <div className="hidden md:flex items-center gap-6 font-data text-[10px] tracking-[0.18em] uppercase" style={{color:'rgba(0,212,255,0.35)'}}>
              {result ? (
                <>
                  <span style={{color:'rgba(0,212,255,0.55)'}}>DATE: {result.target_date}</span>
                  {result.mse !== null && <span>MSE: {result.mse.toFixed(4)}</span>}
                  <span style={{color:'rgba(52,211,153,0.6)'}}>■ DATA LOADED</span>
                </>
              ) : <span>■ AWAITING PARAMETERS</span>}
            </div>

            {/* Status + mobile toggle */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 font-data text-[10px] tracking-[0.18em] uppercase"
                style={{
                  border: `1px solid ${isLoading ? 'rgba(251,191,36,0.3)' : result ? 'rgba(0,212,255,0.25)' : 'rgba(100,140,170,0.2)'}`,
                  background: isLoading ? 'rgba(251,191,36,0.04)' : result ? 'rgba(0,212,255,0.05)' : 'rgba(100,140,170,0.03)',
                  color: isLoading ? '#fbbf24' : result ? '#00d4ff' : 'rgba(100,140,170,0.5)',
                }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{
                  background: isLoading ? '#fbbf24' : result ? '#00d4ff' : 'rgba(100,140,170,0.4)',
                  animation: (isLoading || result) ? 'pulse 2s ease-in-out infinite' : 'none',
                }} />
                {isLoading ? 'Processing' : result ? 'Model Active' : 'Standby'}
              </div>
              <button onClick={() => setIsMobileMenuOpen(true)} className="lg:hidden p-2 transition-colors"
                style={{border:'1px solid rgba(0,212,255,0.2)',color:'rgba(0,212,255,0.5)'}}>
                <Menu className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* ── MAIN ──────────────────────────────────────────────────── */}
        <main className="flex-1 max-w-[1400px] w-full mx-auto p-3 grid grid-cols-1 lg:grid-cols-12 gap-3">

          {/* ── LEFT: MAP COLUMN ──────────────────────────────────── */}
          <div className="lg:col-span-8 flex flex-col gap-3 pb-20 lg:pb-0">

            {/* PRIMARY SENSOR FEED */}
            <div className="flex flex-col overflow-hidden" style={{background:'#060f1c',border:'1px solid rgba(0,212,255,0.12)',minHeight:'520px'}}>

              {/* Panel header bar */}
              <div className="px-4 py-2.5 flex items-center justify-between" style={{borderBottom:'1px solid rgba(0,212,255,0.1)',background:'rgba(4,12,20,0.7)'}}>
                <div className="flex items-center gap-3">
                  <div className="flex gap-0.5">
                    <div className="w-1 h-4" style={{background:'#00d4ff'}} />
                    <div className="w-1 h-4" style={{background:'rgba(0,212,255,0.35)'}} />
                    <div className="w-1 h-4" style={{background:'rgba(0,212,255,0.15)'}} />
                  </div>
                  <span className="font-data text-[11px] lg:text-[16px] tracking-[0.22em] uppercase" style={{color:'rgba(0,212,255,0.65)'}}>
                    Primary Sensor Feed
                  </span>
                </div>
                {result && (
                  <div className="font-data text-[11px] lg:text-[16px] px-3 py-1" style={{color:'#00d4ff',background:'rgba(0,212,255,0.06)',border:'1px solid rgba(0,212,255,0.2)'}}>
                    {currentDate.toUpperCase()}
                  </div>
                )}
              </div>

              {/* Map body */}
              <div className="flex-1 flex flex-col p-3" style={{background:'rgba(0,0,0,0.25)'}}>
                {isLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-6" style={{minHeight:'380px'}}>
                    <div className="relative w-24 h-24 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full" style={{border:'1px solid rgba(0,212,255,0.12)'}} />
                      <div className="absolute inset-3 rounded-full" style={{border:'1px solid rgba(0,212,255,0.08)'}} />
                      <div className="absolute inset-0 rounded-full" style={{border:'1px solid transparent',borderTopColor:'rgba(0,212,255,0.6)',borderRightColor:'rgba(0,212,255,0.2)',animation:'spin-slow 1.4s linear infinite'}} />
                      <div className="w-2 h-2 rounded-full" style={{background:'#00d4ff',animation:'pulse 1.4s ease-in-out infinite'}} />
                      {/* Sonar ping rings */}
                      <div className="absolute inset-0 rounded-full" style={{border:'1px solid rgba(0,212,255,0.4)',animation:'sonar-ping 1.4s ease-out infinite'}} />
                      <div className="absolute inset-0 rounded-full" style={{border:'1px solid rgba(0,212,255,0.25)',animation:'sonar-ping 1.4s ease-out 0.7s infinite'}} />
                    </div>
                    <div className="font-data text-[16px] tracking-[0.3em] uppercase text-center" style={{color:'rgba(0,212,255,0.4)',animation:'pulse 2s ease-in-out infinite'}}>
                      Neural Model Processing...
                    </div>
                  </div>
                ) : !result ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-5" style={{minHeight:'380px'}}>
                    {/* Decorative chart grid */}
                    <div className="relative w-52 h-28 overflow-hidden">
                      {[0,1,2,3,4].map(i => (
                        <div key={i} className="absolute w-full" style={{top:`${i*25}%`,borderTop:'1px solid rgba(0,212,255,0.07)'}} />
                      ))}
                      {[0,1,2,3,4,5,6,7].map(i => (
                        <div key={i} className="absolute h-full" style={{left:`${i*14.28}%`,borderLeft:'1px solid rgba(0,212,255,0.07)'}} />
                      ))}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <MapIcon className="w-9 h-9" style={{color:'rgba(0,212,255,0.15)'}} />
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="font-data text-[16px] tracking-[0.25em] uppercase" style={{color:'rgba(0,212,255,0.3)'}}>Awaiting Mission Parameters</div>
                      <div className="font-data text-[16px] mt-1" style={{color:'rgba(0,212,255,0.15)'}}>Configure endpoint and execute prediction</div>
                    </div>
                  </div>
                ) : currentMap ? (
                  <div className="flex flex-col w-full animate-in fade-in duration-300">
                    {/* Sequence / view row */}
                    <div className="flex items-center justify-between mb-2.5 h-7">
                      {timeStep < 10 ? (
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{background:'#00d4ff'}} />
                          <span className="font-data text-[11px] lg:text-[16px] tracking-[0.2em] uppercase" style={{color:'rgba(0,212,255,0.6)'}}>
                            Input Sequence — Day {timeStep + 1} / 10
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full" style={{background:'#818cf8',animation:'pulse 2s ease-in-out infinite'}} />
                          <span className="font-data text-[11px] lg:text-[16px] tracking-[0.2em] uppercase" style={{color:'rgba(129,140,248,0.8)'}}>
                            Prediction Output — Day 11
                          </span>
                        </div>
                      )}
                      {timeStep === 10 && (
                        <div className="relative">
                          <select
                            value={predictionView}
                            onChange={(e) => handleViewChange(e.target.value as any)}
                            className="font-data text-[11px] lg:text-[16px] tracking-[0.1em] uppercase pl-2 pr-6 py-1 focus:outline-none"
                            style={{background:'#0a1628',border:'1px solid rgba(0,212,255,0.2)',color:'rgba(0,212,255,0.8)'}}>
                            <option value="prediction">Prediction</option>
                            <option value="actual">Ground Truth</option>
                          </select>
                          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{color:'rgba(0,212,255,0.5)'}} />
                        </div>
                      )}
                    </div>

                    {/* Map + legend */}
                    <div className="flex gap-2">
                      <div className="flex-1 relative bg-black overflow-hidden aspect-[1080/511]"
                        style={{border:`1px solid ${timeStep < 10 ? 'rgba(0,212,255,0.15)' : predictionView === 'actual' ? 'rgba(52,211,153,0.25)' : predictionView === 'prediction' ? 'rgba(129,140,248,0.3)' : 'rgba(251,113,133,0.3)'}`}}>
                        {/* HUD corners */}
                        <div className="absolute top-2 left-2 w-4 h-4 pointer-events-none z-10" style={{borderTop:'1px solid rgba(0,212,255,0.45)',borderLeft:'1px solid rgba(0,212,255,0.45)'}} />
                        <div className="absolute top-2 right-2 w-4 h-4 pointer-events-none z-10" style={{borderTop:'1px solid rgba(0,212,255,0.45)',borderRight:'1px solid rgba(0,212,255,0.45)'}} />
                        <div className="absolute bottom-2 left-2 w-4 h-4 pointer-events-none z-10" style={{borderBottom:'1px solid rgba(0,212,255,0.45)',borderLeft:'1px solid rgba(0,212,255,0.45)'}} />
                        <div className="absolute bottom-2 right-2 w-4 h-4 pointer-events-none z-10" style={{borderBottom:'1px solid rgba(0,212,255,0.45)',borderRight:'1px solid rgba(0,212,255,0.45)'}} />
                        <div className="absolute top-3 left-6 font-data text-[10px] lg:text-[16px] tracking-widest uppercase pointer-events-none z-10" style={{color:'rgba(0,212,255,0.3)'}}>
                          {timeStep < 10 ? `IN-D${String(timeStep+1).padStart(2,'0')}` : predictionView.slice(0,4).toUpperCase()}
                        </div>
                        {(!result.actual && timeStep === 10 && predictionView === 'actual') || (!result.difference && timeStep === 10 && predictionView === 'difference') ? (
                          <div className="w-full h-full flex items-center justify-center font-data text-[16px] tracking-widest uppercase" style={{color:'rgba(0,212,255,0.2)'}}>No Data Available</div>
                        ) : (
                          <>
                            {isViewTransitioning && (
                              <div className="absolute inset-0 z-20 flex items-center justify-center" style={{background:'rgba(0,0,0,0.5)',backdropFilter:'blur(4px)'}}>
                                <Loader2 className="w-6 h-6 animate-spin" style={{color:'#818cf8'}} />
                              </div>
                            )}
                            <MapCanvas
                              data={currentMap.data}
                              dataVersion={timelineDataVersion}
                              offset={currentMap.offset}
                              width={result.width}
                              height={result.height}
                              cmap={currentMap.cmap}
                              minTemp={currentMap.minTemp}
                              maxTemp={currentMap.maxTemp}
                              animateTransition={!suppressNextMainAnimation}
                              onClick={() => setFullScreenMap('main')}
                            />
                          </>
                        )}
                      </div>
                      {timeStep === 10 && predictionView === 'difference' ? <DiffLegend /> : (
                        <SstaLegend
                          minTemp={timeStep < 10 ? result.input_min_temps?.[timeStep] : (predictionView === 'actual' ? result.actual_min_temp : result.pred_min_temp)}
                          maxTemp={timeStep < 10 ? result.input_max_temps?.[timeStep] : (predictionView === 'actual' ? result.actual_max_temp : result.pred_max_temp)}
                        />
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Timeline strip */}
              {result && (
                <div className="px-4 py-3" style={{borderTop:'1px solid rgba(0,212,255,0.1)',background:'rgba(4,12,20,0.8)'}}>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="font-data text-[11px] lg:text-[16px] tracking-[0.28em] uppercase" style={{color:'rgba(0,212,255,0.35)'}}>Temporal Navigation</span>
                    <button
                      onClick={() => { if (!isPlaying && timeStep >= 10) setTimeStep(0); setIsPlaying(!isPlaying); }}
                      className="flex items-center gap-1.5 font-data text-[11px] lg:text-[16px] tracking-[0.2em] uppercase px-2.5 py-1 transition-all"
                      style={{border:'1px solid rgba(0,212,255,0.18)',color:'rgba(0,212,255,0.55)'}}>
                      {isPlaying ? <><Pause className="w-3 h-3" /> Halt</> : <><Play className="w-3 h-3" /> Sequence</>}
                    </button>
                  </div>
                  <input type="range" min="0" max="10" value={timeStep}
                    onChange={(e) => { setTimeStep(parseInt(e.target.value)); setIsPlaying(false); }}
                    className="w-full" />
                  <div className="flex justify-between font-data text-[11px] lg:text-[16px] mt-1.5" style={{color:'rgba(0,212,255,0.25)'}}>
                    <span>D01</span><span>D05</span><span>D10</span>
                    <span style={{color:'rgba(129,140,248,0.45)'}}>PRED</span>
                  </div>
                </div>
              )}
            </div>

            {/* SUB-MAPS: Prediction / Ground Truth / Error */}
            {result && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {([
                  { key:'prediction', label:'Prediction',   accent:'rgba(129,140,248,0.55)', data:result.prediction, min:result.pred_min_temp,   max:result.pred_max_temp,   cmap:'sst'        },
                  { key:'actual',     label:'Ground Truth', accent:'rgba(52,211,153,0.55)',  data:result.actual,     min:result.actual_min_temp, max:result.actual_max_temp, cmap:'sst'        },
                  { key:'difference', label:'Error',        accent:'rgba(251,113,133,0.55)', data:result.difference, min:undefined,              max:undefined,              cmap:'difference' },
                ] as const).map(({ key, label, accent, data: sd, min, max, cmap: sc }) => (
                  <div key={key} className="overflow-hidden" style={{background:'#060f1c',border:`1px solid ${accent.replace('0.55','0.18')}`}}>
                    <div className="px-2.5 py-1.5" style={{borderBottom:`1px solid ${accent.replace('0.55','0.12')}`,background:'rgba(4,12,20,0.65)'}}>
                      <span className="font-data text-[9px] lg:text-[16px] tracking-[0.2em] uppercase" style={{color:accent}}>{label}</span>
                    </div>
                    <div className="p-1.5 aspect-[1080/511]" style={{background:'rgba(0,0,0,0.2)'}}>
                      {sd ? (
                        <MapCanvas data={sd} width={result.width} height={result.height} minTemp={min} maxTemp={max}
                          cmap={sc} animateTransition={false} onClick={() => setFullScreenMap(key as any)} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-data text-[16px] tracking-widest uppercase" style={{color:'rgba(0,212,255,0.15)'}}>N/A</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── RIGHT: INSTRUMENT PANEL ───────────────────────────── */}
          {isMobileMenuOpen && (
            <div className="fixed top-0 left-0 right-0 drawer-fill bg-black/70 z-40 lg:hidden" style={{backdropFilter:'blur(4px)'}} onClick={() => setIsMobileMenuOpen(false)} />
          )}

          <div className={cn(
            "flex flex-col gap-3 transition-transform duration-300 ease-in-out",
            "lg:col-span-4 lg:relative lg:inset-auto lg:translate-x-0 lg:z-0 lg:w-auto lg:max-w-none lg:h-auto lg:p-0 lg:border-none lg:flex",
            "fixed top-0 right-0 z-50 w-[90vw] max-w-[340px] drawer-fill p-4 overflow-y-auto",
            isMobileMenuOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
          )} style={{background: isMobileMenuOpen ? '#040c14' : 'transparent', borderLeft: isMobileMenuOpen ? '1px solid rgba(0,212,255,0.12)' : 'none'}}>

            {/* Mobile top row */}
            <div className="flex items-center justify-between lg:hidden mb-3 pb-3" style={{borderBottom:'1px solid rgba(0,212,255,0.1)'}}>
              <span className="font-data text-[16px] tracking-[0.22em] uppercase" style={{color:'rgba(0,212,255,0.5)'}}>Mission Control</span>
              <button onClick={() => setIsMobileMenuOpen(false)} className="p-1.5 transition-colors" style={{border:'1px solid rgba(0,212,255,0.2)',color:'rgba(0,212,255,0.5)'}}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* MISSION PARAMETERS */}
            <div className="overflow-hidden" style={{background:'#060f1c',border:'1px solid rgba(0,212,255,0.12)'}}>
              <button onClick={() => toggleSection('controls')} className="w-full px-4 py-3 flex items-center justify-between transition-colors"
                style={{borderBottom:'1px solid rgba(0,212,255,0.1)',background:'rgba(4,12,20,0.6)'}}>
                <div className="flex items-center gap-2.5">
                  <Settings className="w-3.5 h-3.5" style={{color:'rgba(0,212,255,0.5)'}} />
                  <span className="font-data text-[16px] tracking-[0.2em] uppercase" style={{color:'rgba(0,212,255,0.7)'}}>Mission Parameters</span>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${openSections.includes('controls') ? 'rotate-180' : ''}`} style={{color:'rgba(0,212,255,0.35)'}} />
              </button>
              {openSections.includes('controls') && (
                <div className="p-4">
                  <form onSubmit={handlePredict} className="space-y-4">
                    <div>
                      <label className="block font-data text-[16px] tracking-[0.28em] uppercase mb-1.5" style={{color:'rgba(0,212,255,0.4)'}}>// API Endpoint</label>
                      <input type="text" value={apiUrl} onChange={e => setApiUrl(e.target.value)}
                        className="w-full px-3 py-2 font-data text-[16px] focus:outline-none"
                        style={{background:'#0a1628',border:'1px solid rgba(0,212,255,0.18)',color:'#d4eaf7'}}
                        placeholder="https://trimuerto-stta-app.hf.space" required disabled />
                    </div>
                    <div>
                      <label className="block font-data text-[16px] tracking-[0.28em] uppercase mb-1.5" style={{color:'rgba(0,212,255,0.4)'}}>// Target Date</label>
                      <DatePicker value={targetDate} onChange={setTargetDate} min="2026-03-04" max="2026-03-18" />
                    </div>
                    <div>
                      <label className="block font-data text-[16px] tracking-[0.28em] uppercase mb-1.5" style={{color:'rgba(0,212,255,0.4)'}}>// Neural Model</label>
                      <div className="relative">
                        <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                          className="w-full pl-3 pr-9 py-2 font-data text-[16px] focus:outline-none"
                          style={{background:'#0a1628',border:'1px solid rgba(0,212,255,0.18)',color:'#d4eaf7'}}>
                          <option value="best_sst_convlstm.keras">Best Weights</option>
                          <option value="final_sst_convlstm.keras">Final Weights</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{color:'rgba(0,212,255,0.4)'}} />
                      </div>
                    </div>
                    <button type="submit" disabled={isLoading}
                      className="w-full py-2.5 font-data text-[16px] tracking-[0.22em] uppercase transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{background:'rgba(0,212,255,0.08)',border:'1px solid rgba(0,212,255,0.28)',color:'#00d4ff'}}>
                      {isLoading
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...</>
                        : <><Play className="w-3.5 h-3.5" style={{color:'rgba(0,212,255,0.6)'}} /> Execute Prediction</>}
                    </button>
                  </form>
                  {error && (
                    <div className="mt-4 p-3 flex items-start gap-2 font-data text-[16px]" style={{background:'rgba(251,113,133,0.05)',border:'1px solid rgba(251,113,133,0.2)',color:'#fb7185'}}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ANALYSIS RESULTS */}
            {result && (
              <div className="overflow-hidden" style={{background:'#060f1c',border:'1px solid rgba(0,212,255,0.12)'}}>
                <button onClick={() => toggleSection('metrics')} className="w-full px-4 py-3 flex items-center justify-between transition-colors"
                  style={{borderBottom:'1px solid rgba(0,212,255,0.1)',background:'rgba(4,12,20,0.6)'}}>
                  <div className="flex items-center gap-2.5">
                    <Activity className="w-3.5 h-3.5" style={{color:'rgba(0,212,255,0.5)'}} />
                    <span className="font-data text-[16px] tracking-[0.2em] uppercase" style={{color:'rgba(0,212,255,0.7)'}}>Analysis Results</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 transition-transform ${openSections.includes('metrics') ? 'rotate-180' : ''}`} style={{color:'rgba(0,212,255,0.35)'}} />
                </button>
                {openSections.includes('metrics') && (
                  <div className="p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-2 p-3 font-data text-[16px]" style={{background:'rgba(52,211,153,0.05)',border:'1px solid rgba(52,211,153,0.18)',color:'#34d399'}}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{result.message}</span>
                    </div>
                    {result.mse !== null && (
                      <div className="grid grid-cols-2 gap-2">
                        <StatBoxComponent label="MSE" value={result.mse.toFixed(4)} subtext="Mean Squared Error" color="text-[#fbbf24]" />
                        <StatBoxComponent label="Status" value="Success" color="text-[#34d399]" />
                      </div>
                    )}
                    <button onClick={handleOpenSummary} disabled={aiSummaryLoading || !timelineData}
                      className="w-full py-2.5 font-data text-[16px] tracking-[0.18em] uppercase transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{background:'rgba(129,140,248,0.08)',border:'1px solid rgba(129,140,248,0.25)',color:'#818cf8'}}>
                      {aiSummaryLoading
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</>
                        : aiSummaryText
                          ? <><Activity className="w-3.5 h-3.5" /> View AI Summary</>
                          : <><Activity className="w-3.5 h-3.5" /> Generate AI Summary</>}
                    </button>
                    <p className="font-data text-[11px] lg:text-[13px] tracking-[0.12em] text-center" style={{color:'rgba(129,140,248,0.4)'}}>
                      Optional · powered by Puter AI · sign-in required
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* SYSTEM INFO */}
            <div className="overflow-hidden" style={{background:'#060f1c',border:'1px solid rgba(0,212,255,0.12)'}}>
              <button onClick={() => toggleSection('about')} className="w-full px-4 py-3 flex items-center justify-between transition-colors"
                style={{borderBottom:'1px solid rgba(0,212,255,0.1)',background:'rgba(4,12,20,0.6)'}}>
                <div className="flex items-center gap-2.5">
                  <Info className="w-3.5 h-3.5" style={{color:'rgba(0,212,255,0.5)'}} />
                  <span className="font-data text-[16px] tracking-[0.2em] uppercase" style={{color:'rgba(0,212,255,0.7)'}}>System Info</span>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${openSections.includes('about') ? 'rotate-180' : ''}`} style={{color:'rgba(0,212,255,0.35)'}} />
              </button>
              {openSections.includes('about') && (
                <div className="p-4 space-y-3 font-data text-[16px] leading-relaxed" style={{color:'rgba(0,212,255,0.4)'}}>
                  <p>ConvLSTM neural network trained on global Sea Surface Temperature Anomaly (SSTa) data. Ingests 10 prior days and outputs the predicted anomaly map for the target date.</p>
                  <div className="pt-3" style={{borderTop:'1px solid rgba(0,212,255,0.1)'}}>
                    <div className="mb-1" style={{color:'rgba(0,212,255,0.55)'}}>// Error Map Key</div>
                    <p>Positive (red) → over-predicted. Negative (blue) → under-predicted. Near-zero (white) → high accuracy.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── AI SUMMARY MODAL ──────────────────────────────────── */}
          {isAiSummaryModalOpen && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 animate-in fade-in duration-200" style={{background:'rgba(0,0,0,0.88)',backdropFilter:'blur(8px)'}}>
              <div className="w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{background:'#060f1c',border:'1px solid rgba(0,212,255,0.2)',boxShadow:'0 0 60px rgba(0,212,255,0.05)'}}>
                <div className="flex justify-between items-center px-5 py-3.5" style={{borderBottom:'1px solid rgba(0,212,255,0.12)',background:'rgba(4,12,20,0.85)'}}>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-0.5">
                      <div className="w-1 h-4" style={{background:'#818cf8'}} />
                      <div className="w-1 h-4" style={{background:'rgba(129,140,248,0.4)'}} />
                    </div>
                    <h2 className="font-data text-[16px] tracking-[0.22em] uppercase" style={{color:'rgba(129,140,248,0.9)'}}>AI Basin Intelligence</h2>
                  </div>
                  <button onClick={() => setIsAiSummaryModalOpen(false)} className="p-1.5 transition-all" style={{border:'1px solid rgba(0,212,255,0.15)',color:'rgba(0,212,255,0.45)'}}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-6 overflow-y-auto">
                  {aiSummaryLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-5">
                      <div className="relative w-14 h-14">
                        <div className="absolute inset-0 rounded-full" style={{border:'1px solid rgba(129,140,248,0.15)'}} />
                        <div className="absolute inset-0 rounded-full" style={{border:'1px solid transparent',borderTopColor:'rgba(129,140,248,0.6)',animation:'spin-slow 1.4s linear infinite'}} />
                      </div>
                      <div className="font-data text-[16px] tracking-[0.3em] uppercase" style={{color:'rgba(129,140,248,0.4)',animation:'pulse 2s ease-in-out infinite'}}>
                        Analyzing basin data...
                      </div>
                    </div>
                  ) : aiSummaryError ? (
                    <div className="flex items-start gap-3 p-4 font-data text-[16px]" style={{background:'rgba(251,113,133,0.05)',border:'1px solid rgba(251,113,133,0.18)',color:'#fb7185'}}>
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="mb-1" style={{color:'rgba(251,113,133,0.8)'}}>// Generation Failed</div>
                        <p style={{opacity:0.7}}>{aiSummaryError}</p>
                      </div>
                    </div>
                  ) : aiSummaryText ? (
                    <div className="space-y-2 text-[16px] leading-relaxed" style={{color:'rgba(212,234,247,0.75)'}}>
                      {aiSummaryText.split('\n').map((line, i) => {
                        if (line.startsWith('#')) {
                          const text = line.replace(/^#+\s/, '');
                          return <div key={i} className="font-data text-[16px] tracking-[0.18em] uppercase mt-5 mb-2 pb-1.5" style={{color:'#00d4ff',borderBottom:'1px solid rgba(0,212,255,0.12)'}}>{text}</div>;
                        }
                        if (line.startsWith('- ') || line.startsWith('* ')) {
                          return <div key={i} className="flex gap-2 ml-2"><span style={{color:'rgba(0,212,255,0.5)'}}>▸</span><span>{line.substring(2)}</span></div>;
                        }
                        if (line.trim() === '') return <div key={i} className="h-1.5" />;
                        return <p key={i}>{line}</p>;
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* ── FULLSCREEN MAP MODAL ──────────────────────────────── */}
          {fullScreenMap && fullScreenMapProps && (
            <div className="fixed inset-0 z-[200] flex flex-col p-4 animate-in fade-in duration-200" style={{background:'rgba(2,7,12,0.97)'}}>
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{background:'#00d4ff',animation:'pulse 2s ease-in-out infinite'}} />
                  <h2 className="font-data text-[16px] tracking-[0.25em] uppercase" style={{color:'rgba(0,212,255,0.8)'}}>{fullScreenMapProps.title}</h2>
                </div>
                <button onClick={() => setFullScreenMap(null)} className="p-2 transition-all" style={{border:'1px solid rgba(0,212,255,0.18)',color:'rgba(0,212,255,0.5)'}}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 relative flex flex-col justify-center min-h-0 gap-4">
                <div className="relative overflow-hidden bg-black flex shrink min-h-0 w-full h-full" style={{border:'1px solid rgba(0,212,255,0.15)'}}>
                  {/* HUD corners */}
                  <div className="absolute top-3 left-3 w-5 h-5 pointer-events-none z-10" style={{borderTop:'1px solid rgba(0,212,255,0.4)',borderLeft:'1px solid rgba(0,212,255,0.4)'}} />
                  <div className="absolute top-3 right-3 w-5 h-5 pointer-events-none z-10" style={{borderTop:'1px solid rgba(0,212,255,0.4)',borderRight:'1px solid rgba(0,212,255,0.4)'}} />
                  <div className="absolute bottom-3 left-3 w-5 h-5 pointer-events-none z-10" style={{borderBottom:'1px solid rgba(0,212,255,0.4)',borderLeft:'1px solid rgba(0,212,255,0.4)'}} />
                  <div className="absolute bottom-3 right-3 w-5 h-5 pointer-events-none z-10" style={{borderBottom:'1px solid rgba(0,212,255,0.4)',borderRight:'1px solid rgba(0,212,255,0.4)'}} />
                  <MapCanvas
                    data={fullScreenMapProps.data}
                    dataVersion={timelineDataVersion}
                    width={fullScreenMapProps.width}
                    height={fullScreenMapProps.height}
                    cmap={fullScreenMapProps.cmap}
                    offset={fullScreenMapProps.offset}
                    minTemp={fullScreenMapProps.minTemp}
                    maxTemp={fullScreenMapProps.maxTemp}
                    allowSelection={true}
                    animateTransition={!suppressNextMainAnimation}
                  />
                </div>
                <div className="flex-shrink-0 flex flex-col items-center gap-3 pb-2">
                  {fullScreenMapProps.cmap === 'sst'
                    ? <SstaLegend minTemp={fullScreenMapProps.minTemp} maxTemp={fullScreenMapProps.maxTemp} horizontal />
                    : <DiffLegend horizontal />}
                  {fullScreenMapProps.showTimeline && result && (
                    <div className="w-full max-w-4xl p-3" style={{border:'1px solid rgba(0,212,255,0.1)',background:'rgba(4,12,20,0.92)',backdropFilter:'blur(8px)'}}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-data text-[11px] lg:text-[16px] tracking-[0.28em] uppercase" style={{color:'rgba(0,212,255,0.35)'}}>Timeline</span>
                        <button onClick={() => { if (!isPlaying && timeStep >= 10) setTimeStep(0); setIsPlaying(!isPlaying); }}
                          className="flex items-center gap-1.5 font-data text-[11px] lg:text-[16px] tracking-[0.2em] uppercase px-2.5 py-1 transition-all"
                          style={{border:'1px solid rgba(0,212,255,0.18)',color:'rgba(0,212,255,0.55)'}}>
                          {isPlaying ? <><Pause className="w-3 h-3" /> Halt</> : <><Play className="w-3 h-3" /> Play</>}
                        </button>
                      </div>
                      <div className="flex items-center gap-4">
                        <input type="range" min={0} max={10} step={1} value={timeStep}
                          onChange={e => { setTimeStep(parseInt(e.target.value)); setIsPlaying(false); }}
                          className="flex-1" />
                        <div className="font-data text-[16px] min-w-[56px] text-right" style={{color:'rgba(0,212,255,0.45)'}}>
                          {timeStep === 10 ? (predictionView === 'actual' ? 'TRUTH' : predictionView === 'difference' ? 'DIFF' : 'PRED') : `D${String(timeStep+1).padStart(2,'0')}`}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
  );
}