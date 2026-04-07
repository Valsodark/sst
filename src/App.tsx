import React, {useState, useEffect, useRef, useMemo} from 'react';
import {
  Play, Pause,
  Map as MapIcon, Activity,
  Settings,
  Thermometer, AlertTriangle, Info, Loader2, CheckCircle2,
  Database, ChevronDown, Menu, X
} from 'lucide-react';
import { format, addDays, parseISO } from 'date-fns';
import { cn } from './lib/utils';
import { MapCanvas, SstaLegend } from './components/MapCanvas';
import { StatBox as StatBoxComponent } from "./components/StatBox";
// @ts-ignore
import { NetCDFReader } from 'netcdfjs';
import { calculateBasinMetrics, BasinMetric } from './lib/basinMetrics';

const DiffLegend = ({ horizontal = false }: { horizontal?: boolean }) => (
    <div className={`bg-zinc-900/80 border border-zinc-800/80 p-2 rounded-lg text-[11px] font-mono text-zinc-300 flex ${horizontal ? 'flex-row items-center justify-center gap-3 w-auto flex-wrap max-w-full' : 'flex-col justify-center gap-1.5 shrink-0 w-[110px]'}`}>
      <div className={`text-zinc-400 font-semibold text-center ${horizontal ? 'pr-2 border-r border-zinc-800' : 'mb-1 border-b border-zinc-800 pb-1'}`}>Error</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(165, 0, 38)'}}></span> ≥ 0.8</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(215, 48, 39)'}}></span> 0.6 to 0.8</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(244, 109, 67)'}}></span> 0.4 to 0.6</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(253, 174, 97)'}}></span> 0.2 to 0.4</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(254, 224, 144)'}}></span> 0.0 to 0.2</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(224, 243, 248)'}}></span> -0.2 to 0.0</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(171, 217, 233)'}}></span> -0.4 to -0.2</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(116, 173, 209)'}}></span> -0.6 to -0.4</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(69, 117, 180)'}}></span> -0.8 to -0.6</div>
      <div className="flex items-center gap-2 whitespace-nowrap"><span className="w-2.5 h-2.5 rounded-sm shadow-sm shrink-0" style={{backgroundColor: 'rgb(49, 54, 149)'}}></span> &lt; -0.8</div>
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
  const [apiUrl, setApiUrl] = useState<string>('http://localhost:8000');
  const [targetDate, setTargetDate] = useState<string>('2023-01-11');
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
    // Clear cached AI summary when a new prediction result is loaded
    setAiSummaryText(null);
    setAiSummaryError(null);
  }, [result]);

  console.log('App rendering, timeStep:', timeStep, 'result exists:', !!result);

  const [openSections, setOpenSections] = useState<Array<'controls' | 'metrics' | 'about'>>(['controls', 'metrics']);

  const toggleSection = (section: 'controls' | 'metrics' | 'about') => {
    setOpenSections(prev => {
      if (prev.includes(section)) {
        return prev.filter(s => s !== section);
      } else {
        const next = [...prev, section];
        if (next.length > 2) {
          next.shift();
        }
        return next;
      }
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
  const [fullScreenMap, setFullScreenMap] = useState<'main' | 'prediction' | 'actual' | 'difference' | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const generateAiSummary = async () => {
    if (!result || !timelineData) return;

    setIsAiSummaryModalOpen(true);

    if (aiSummaryText) {
      return; // Use cached summary
    }

    setAiSummaryLoading(true);
    setAiSummaryError(null);
    setAiSummaryText(null);

    try {
      const targetDate = result.target_date;
      const selectedDate = result.target_date;
      const dataType = result.actual ? 'Prediction and Ground Truth' : 'Prediction';
      const summaryTimeStep = 10;

      // Convert metrics to CSV format to save tokens and speed up inference
      let csvData = `Date,DataType,TimeStep,Basin,Mean,Max,Min,Median,StdDev,Pct>1C,Pct>2C,Pct<-1C\n`;

      const appendMetricsToCsv = (metrics: BasinMetric[], tStep: number, dateStr: string, dType: string) => {
        metrics.forEach(m => {
          csvData += `${dateStr},${dType},Day ${tStep + 1},${m.basinName},${m.meanAnomaly.toFixed(2)},${m.maxAnomaly.toFixed(2)},${m.minAnomaly.toFixed(2)},${m.medianAnomaly.toFixed(2)},${m.stdDev.toFixed(2)},${m.percentAbove1.toFixed(1)}%,${m.percentAbove2.toFixed(1)}%,${m.percentBelowMinus1.toFixed(1)}%\n`;
        });
      };

      // Add all input days (0 to 9)
      for (let i = 0; i < 10; i++) {
        const historyDate = format(addDays(parseISO(result.start_date), i), 'yyyy-MM-dd');
        const historyMetrics = calculateBasinMetrics(result.input, result.width, result.height, i * result.width * result.height);
        appendMetricsToCsv(historyMetrics, i, historyDate, 'Input Data');
      }

      // Add prediction day (10)
      const predDate = result.target_date;
      const predMetrics = calculateBasinMetrics(result.prediction, result.width, result.height, 0);
      appendMetricsToCsv(predMetrics, 10, predDate, 'Prediction');

      if (result.actual) {
        const actMetrics = calculateBasinMetrics(result.actual, result.width, result.height, 0);
        appendMetricsToCsv(actMetrics, 10, predDate, 'Ground Truth');
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('AI Summary Payload (CSV):\n', csvData);
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

Example output:

Assessment of the 10 days leading to the 2026-03-28.

Conditions on 2026-03-28 show uneven basin behavior, with the Indian Ocean holding the highest average positive anomaly while the Pacific has the broadest area of strong warm conditions. Over the previous 10 days, most basins remained on the warm side, although the Southern Ocean was more variable and the Arctic showed sharper day-to-day swings. Overall, the pattern suggests persistent positive anomalies in several basins rather than a single uniform global signal.

Highlights
- Pacific: Warm anomalies remain widespread, with a large share of the basin above +1°C and relatively steady conditions over the 10-day period.
- Atlantic: Positive anomalies persist, but short-term changes are smaller than in the Pacific and Indian basins.
- Indian: This is the warmest basin on the selected date, with consistently elevated anomaly values through much of the 10-day window.
- Southern: Conditions are more mixed, with weaker anomalies and greater short-term variability than in the other basins.
- Arctic: Positive anomalies are present, but the basin shows stronger short-term fluctuations than the Atlantic or Pacific.

Comparison of Prediction and Ground Truth
The prediction broadly matches the ground truth in showing the Indian Ocean as the warmest basin and the Pacific as having extensive warm coverage. The largest differences appear in the Southern and Arctic basins, where the prediction slightly overstates the strength of positive anomalies.

The example output shows the required structure and tone only. Do not copy its wording or conclusions. Generate a new summary based only on the provided data.

Data (CSV format):
${csvData}`;

      // @ts-ignore
      const response = await window.puter.ai.chat(prompt);

      setAiSummaryText(response?.message?.content || response || 'No summary generated.');
    } catch (err: any) {
      console.error('Error generating AI summary:', err);
      setAiSummaryError(err.message || 'Failed to generate summary.');
    } finally {
      setAiSummaryLoading(false);
    }
  };

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
      console.log('Fetching data...');
      const response = await fetch(`${baseUrl}/predict?start_date=${targetDate}&model=${selectedModel}`, {
        method: 'GET',
      });

      console.log('Response received, status:', response.status);
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

      console.log('Reading array buffer...');
      const arrayBuffer = await response.arrayBuffer();
      console.log('Array buffer read, size:', arrayBuffer.byteLength);

      console.log('Parsing NetCDF...');
      const ncReader = new NetCDFReader(arrayBuffer);
      console.log('NetCDF parsed successfully');

      await new Promise(resolve => setTimeout(resolve, 0));

      const getAttr = (name: string) => {
        const attr = ncReader.globalAttributes.find((a: any) => a.name === name);
        if (!attr) return undefined;
        if (typeof attr.value === 'string') return attr.value;
        if (Array.isArray(attr.value) && attr.value.length === 1) return attr.value[0];
        return attr.value;
      };

      const getFloat32Array = (variableName: string): Float32Array | null => {
        const variable = ncReader.variables.find((v: any) => v.name === variableName);
        if (!variable) return null;

        const ioBuffer = (ncReader as any).buffer;

        if (variable.record) {
          const recordDimension = (ncReader as any).header.recordDimension;
          const numRecords = recordDimension.length;
          const floatsPerRecord = variable.size / 4;
          const bytesPerRecord = variable.size;
          const step = recordDimension.recordStep;

          const floatArray = new Float32Array(numRecords * floatsPerRecord);
          const uint8Array = new Uint8Array(floatArray.buffer);
          const sourceUint8 = new Uint8Array(ioBuffer.buffer, ioBuffer.byteOffset);

          let outIdx = 0;
          for (let i = 0; i < numRecords; i++) {
            let offset = variable.offset + i * step;
            for (let j = 0; j < bytesPerRecord; j += 4) {
              uint8Array[outIdx++] = sourceUint8[offset + j + 3];
              uint8Array[outIdx++] = sourceUint8[offset + j + 2];
              uint8Array[outIdx++] = sourceUint8[offset + j + 1];
              uint8Array[outIdx++] = sourceUint8[offset + j];
            }
          }
          return floatArray;
        }

        const numElements = variable.size / 4;
        const floatArray = new Float32Array(numElements);
        const uint8Array = new Uint8Array(floatArray.buffer);
        const sourceUint8 = new Uint8Array(ioBuffer.buffer, ioBuffer.byteOffset + variable.offset, variable.size);

        for (let i = 0; i < variable.size; i += 4) {
          uint8Array[i] = sourceUint8[i + 3];
          uint8Array[i + 1] = sourceUint8[i + 2];
          uint8Array[i + 2] = sourceUint8[i + 1];
          uint8Array[i + 3] = sourceUint8[i];
        }
        return floatArray;
      };

      const hasActual = getAttr('has_actual') === 1;

      console.log('Extracting variables...');
      console.time('Extract Input');
      const inputData = getFloat32Array('input')!;
      console.timeEnd('Extract Input');

      await new Promise(resolve => setTimeout(resolve, 0));

      console.time('Extract Prediction');
      const predictionData = getFloat32Array('prediction')!;
      console.timeEnd('Extract Prediction');

      await new Promise(resolve => setTimeout(resolve, 0));

      console.time('Extract Actual');
      const actualData = hasActual ? getFloat32Array('actual') : null;
      console.timeEnd('Extract Actual');

      await new Promise(resolve => setTimeout(resolve, 0));

      console.time('Extract Difference');
      const differenceData = hasActual ? getFloat32Array('difference') : null;
      console.timeEnd('Extract Difference');

      await new Promise(resolve => setTimeout(resolve, 0));

      console.log('Setting result state...');
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
      console.log('Result state set');
    } catch (err) {
      console.error('Error in handlePredict:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
      console.log('handlePredict finished');
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
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-blue-500/30">
        {/* Header */}
        <header className="border-b border-zinc-800/60 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Thermometer className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <h1 className="text-sm font-semibold tracking-tight">Ocean AI Predictor</h1>
                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">ConvLSTM SSTa Model</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex bg-zinc-900 rounded-lg p-1 border border-zinc-800/60">
                <button
                    className="px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2 bg-zinc-800 text-white shadow-sm"
                >
                  <Activity className="w-3.5 h-3.5" /> API Prediction
                </button>
              </div>

              {result && (
                  <div className="hidden sm:flex px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-mono text-zinc-400">Model Active</span>
                  </div>
              )}

              <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="lg:hidden p-2 text-zinc-400 hover:text-white bg-zinc-900/50 rounded-lg border border-zinc-800/60"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">

          <div className="lg:col-span-8 flex flex-col gap-4">

            {/* Main Viewer */}
            <div className="bg-[#121212] border border-zinc-800/60 rounded-xl overflow-hidden flex flex-col min-h-[600px]">
              <div className="p-3 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-900/30">
                <div className="flex items-center gap-2">
                  <MapIcon className="w-4 h-4 text-zinc-400" />
                  <h2 className="text-sm font-medium">Spatial Analysis</h2>
                </div>
                {result && (
                    <div className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2 py-1 rounded border border-blue-500/20">
                      {currentDate}
                    </div>
                )}
              </div>

              <div className="p-4 flex-1 flex flex-col items-center justify-center bg-black/20 relative">
                {isLoading ? (
                    <div className="text-zinc-500 flex flex-col items-center animate-pulse">
                      <Loader2 className="w-12 h-12 mb-4 animate-spin opacity-50 text-blue-500" />
                      <p>Running prediction model...</p>
                    </div>
                ) : !result ? (
                    <div className="text-zinc-500 flex flex-col items-center">
                      <MapIcon className="w-12 h-12 mb-4 opacity-20" />
                      <p>Run a prediction to view spatial data</p>
                    </div>
                ) : (
                    <div className="flex flex-col w-full h-full animate-in fade-in duration-300 justify-center relative">
                      {isLoading && (
                          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm rounded-lg">
                            <Loader2 className="w-12 h-12 mb-4 animate-spin text-blue-500" />
                            <p className="text-zinc-300 font-mono text-sm animate-pulse">Running prediction model...</p>
                          </div>
                      )}
                      {timeStep < 10 ? (
                          <div className="flex items-center justify-between mb-4 w-full h-[28px]">
                            <div className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                              Input Sequence: Day {timeStep + 1} of 10
                            </div>
                          </div>
                      ) : (
                          <div className="flex items-center justify-between mb-4 w-full h-[28px]">
                            <div className="text-xs font-mono text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                              Prediction Results (Day 11)
                            </div>
                            <select
                                value={predictionView}
                                onChange={(e) => handleViewChange(e.target.value as any)}
                                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="prediction">Prediction Only</option>
                              <option value="actual">Result Only</option>
                            </select>
                          </div>
                      )}

                      <div className="flex flex-col items-center w-full">
                        <div className={cn(
                            "text-xs font-semibold font-mono mb-2 uppercase tracking-wider",
                            timeStep < 10 ? "text-zinc-400" : (predictionView === 'actual' ? "text-zinc-400" : predictionView === 'prediction' ? "text-indigo-400" : "text-rose-400")
                        )}>
                          {timeStep < 10 ? 'Input Data' : (predictionView === 'actual' ? 'Ground Truth' : predictionView === 'prediction' ? 'ConvLSTM Prediction' : 'Error (Difference)')}
                        </div>
                        <div className="flex w-full gap-2">
                          <div className={cn(
                              "flex-1 relative bg-black rounded-lg overflow-hidden border aspect-[1080/511] transition-colors duration-300",
                              timeStep < 10 ? "border-zinc-800" : (predictionView === 'actual' ? "border-zinc-800" : predictionView === 'prediction' ? "border-indigo-500/50" : "border-rose-500/50")
                          )}>
                            {(!result.actual && timeStep === 10 && predictionView === 'actual') || (!result.difference && timeStep === 10 && predictionView === 'difference') ? (
                                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">No data available</div>
                            ) : currentMap ? (
                                <>
                                  {isViewTransitioning && (
                                      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm rounded-lg">
                                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                                        <p className="text-zinc-300 font-mono text-sm animate-pulse">Loading view...</p>
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
                            ) : null}
                          </div>
                          {timeStep === 10 && predictionView === 'difference' ? (
                              <DiffLegend />
                          ) : (
                              <SstaLegend minTemp={timeStep < 10 ? result.input_min_temps?.[timeStep] : (predictionView === 'actual' ? result.actual_min_temp : predictionView === 'prediction' ? result.pred_min_temp : undefined)} maxTemp={timeStep < 10 ? result.input_max_temps?.[timeStep] : (predictionView === 'actual' ? result.actual_max_temp : predictionView === 'prediction' ? result.pred_max_temp : undefined)} />
                          )}
                        </div>
                      </div>
                    </div>
                )}
              </div>

              {/* Thumbnail Timeline Strip */}
              {result && (
                  <div className="border-t border-zinc-800/60 bg-zinc-950/50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Timeline Navigation</div>
                      <button
                          onClick={() => {
                            if (!isPlaying && timeStep >= 10) setTimeStep(0);
                            setIsPlaying(!isPlaying);
                          }}
                          className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors bg-zinc-800/50 hover:bg-zinc-800 px-2 py-1 rounded"
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        {isPlaying ? 'Pause' : 'Auto-Play'}
                      </button>
                    </div>
                    {/* Custom Slider Scrollbar */}
                    <div className="mt-3 px-1">
                      <input
                          type="range"
                          min="0"
                          max="10"
                          value={timeStep}
                          onChange={(e) => {
                            setTimeStep(parseInt(e.target.value));
                            setIsPlaying(false);
                          }}
                          className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-blue-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:bg-blue-400 transition-all"
                      />
                      <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-1 px-1">
                        <span>Day 1</span>
                        <span>Target</span>
                      </div>
                    </div>
                  </div>
              )}
            </div>

            {/* Three Blocks: Prediction, Ground Truth, Difference */}
            {result && (
                <div className="flex flex-col gap-4">
                  {/* Prediction Map */}
                  <div className="bg-[#121212] border border-zinc-800/60 rounded-xl overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-900/30">
                      <h3 className="text-xs font-medium text-indigo-400 uppercase tracking-wider">Prediction</h3>
                    </div>
                    <div className="p-2 bg-black/20 relative aspect-[1080/511]">
                      <MapCanvas
                          data={result.prediction}
                          width={result.width}
                          height={result.height}
                          minTemp={result.pred_min_temp}
                          maxTemp={result.pred_max_temp}
                          animateTransition={false}
                          onClick={() => setFullScreenMap('prediction')}
                      />
                    </div>
                  </div>

                  {/* Ground Truth Map */}
                  <div className="bg-[#121212] border border-zinc-800/60 rounded-xl overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-900/30">
                      <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Ground Truth</h3>
                    </div>
                    <div className="p-2 bg-black/20 relative aspect-[1080/511]">
                      {result.actual ? (
                          <MapCanvas
                              data={result.actual}
                              width={result.width}
                              height={result.height}
                              minTemp={result.actual_min_temp}
                              maxTemp={result.actual_max_temp}
                              animateTransition={false}
                              onClick={() => setFullScreenMap('actual')}
                          />
                      ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">No data</div>
                      )}
                    </div>
                  </div>

                  {/* Difference Map */}
                  <div className="bg-[#121212] border border-zinc-800/60 rounded-xl overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-900/30">
                      <h3 className="text-xs font-medium text-rose-400 uppercase tracking-wider">Difference</h3>
                    </div>
                    <div className="p-2 bg-black/20 relative aspect-[1080/511]">
                      {result.difference ? (
                          <MapCanvas
                              data={result.difference}
                              width={result.width}
                              height={result.height}
                              cmap="difference"
                              animateTransition={false}
                              onClick={() => setFullScreenMap('difference')}
                          />
                      ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">No data</div>
                      )}
                    </div>
                  </div>
                </div>
            )}

          </div>

          {/* Right Column: Controls & Stats */}
          {/* Mobile Backdrop */}
          {isMobileMenuOpen && (
              <div
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                  onClick={() => setIsMobileMenuOpen(false)}
              />
          )}

          <div className={cn(
              "flex flex-col gap-4 transition-transform duration-300 ease-in-out",
              // Desktop styles
              "lg:col-span-4 lg:relative lg:inset-auto lg:translate-x-0 lg:z-0 lg:w-auto lg:h-auto lg:p-0 lg:bg-transparent lg:border-none lg:flex",
              // Mobile styles
              "fixed inset-y-0 right-0 z-50 w-[85vw] sm:w-96 h-full bg-[#0a0a0a] border-l border-zinc-800/60 p-4 overflow-y-auto shadow-2xl",
              isMobileMenuOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"
          )}>

            <div className="flex items-center justify-between lg:hidden mb-2 pb-4 border-b border-zinc-800/60">
              <h2 className="text-lg font-semibold text-zinc-100">Menu</h2>
              <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-zinc-400 hover:text-white bg-zinc-900/50 rounded-lg border border-zinc-800/60">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Controls */}
            <div className="bg-[#121212] border border-zinc-800/60 rounded-xl overflow-hidden">
              <button
                  onClick={() => toggleSection('controls')}
                  className="w-full p-3 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-900/30 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-zinc-400" />
                  <h2 className="text-sm font-medium">Model Configuration</h2>
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${openSections.includes('controls') ? 'rotate-180' : ''}`} />
              </button>
              {openSections.includes('controls') && (
                  <div className="p-4">
                    <form onSubmit={handlePredict} className="space-y-4">
                      <div>
                        <label className="block text-xs font-mono text-zinc-400 mb-1 uppercase tracking-wider">API URL</label>
                        <input
                            type="text"
                            value={apiUrl}
                            onChange={(e) => setApiUrl(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="http://localhost:8000"
                            required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono text-zinc-400 mb-1 uppercase tracking-wider">Target Date</label>
                        <input
                            type="date"
                            value={targetDate}
                            onChange={(e) => setTargetDate(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
                            required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono text-zinc-400 mb-1 uppercase tracking-wider">Model</label>
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="best_sst_convlstm.keras">Best weights model</option>
                          <option value="final_sst_convlstm.keras">Final weights model</option>
                        </select>
                      </div>
                      <button
                          type="submit"
                          disabled={isLoading}
                          className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2 rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
                        ) : (
                            'Run Prediction'
                        )}
                      </button>
                    </form>

                    {error && (
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-md flex items-start gap-2 text-red-400 text-sm">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <p>{error}</p>
                        </div>
                    )}
                  </div>
              )}
            </div>

            {/* Model Evaluation */}
            {result && (
                <div className="bg-[#121212] border border-zinc-800/60 rounded-xl overflow-hidden">
                  <button
                      onClick={() => toggleSection('metrics')}
                      className="w-full p-3 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-900/30 hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-zinc-400" />
                      <h2 className="text-sm font-medium">Prediction Results</h2>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${openSections.includes('metrics') ? 'rotate-180' : ''}`} />
                  </button>
                  {openSections.includes('metrics') && (
                      <div className="p-4 flex flex-col gap-3">
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md flex items-start gap-2 text-emerald-400 text-sm">
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                          <p>{result.message}</p>
                        </div>

                        {result.mse !== null && (
                            <div className="grid grid-cols-2 gap-3 mt-2">
                              <StatBoxComponent label="MSE" value={result.mse.toFixed(4)} subtext="Mean Squared Error" color="text-amber-400" />
                              <StatBoxComponent label="Status" value="Success" color="text-emerald-400" />
                            </div>
                        )}

                        <div className="mt-2">
                          <button
                              onClick={generateAiSummary}
                              disabled={aiSummaryLoading || !timelineData}
                              className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2"
                          >
                            {aiSummaryLoading ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Generating...
                                </>
                            ) : aiSummaryText ? (
                                <>
                                  <Activity className="w-4 h-4" />
                                  View Summary
                                </>
                            ) : (
                                <>
                                  <Activity className="w-4 h-4" />
                                  Generate AI Basin Summary
                                </>
                            )}
                          </button>
                        </div>
                      </div>
                  )}
                </div>
            )}

            {/* Info Box */}
            <div className="bg-[#121212] border border-zinc-800/60 rounded-xl overflow-hidden">
              <button
                  onClick={() => toggleSection('about')}
                  className="w-full p-3 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-900/30 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-zinc-400" />
                  <h2 className="text-sm font-medium">About</h2>
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${openSections.includes('about') ? 'rotate-180' : ''}`} />
              </button>
              {openSections.includes('about') && (
                  <div className="p-4 text-sm text-zinc-400 space-y-3">
                    <p>
                      This interface visualizes predictions from a ConvLSTM neural network trained on Sea Surface Temperature Anomaly (SSTa) data.
                    </p>
                    <p>
                      Select a target date to predict. The model will ingest the 10 preceding days of netCDF data and output the predicted anomaly map for the target date.
                    </p>
                    <p>
                      <strong className="text-zinc-300">Error (Difference) Map:</strong> This map shows the difference between the prediction and the ground truth in °C. Positive values (red) indicate the model over-predicted the temperature, negative values (blue) indicate under-prediction, and values near zero (white) indicate high accuracy.
                    </p>
                  </div>
              )}
            </div>

          </div>

          {/* AI Summary Modal */}
          {isAiSummaryModalOpen && (
              <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="flex justify-between items-center p-4 border-b border-zinc-800/60 bg-zinc-900/50">
                    <h2 className="text-lg font-medium text-zinc-200 flex items-center gap-2">
                      <Activity className="w-5 h-5 text-indigo-400" />
                      AI Basin Summary
                    </h2>
                    <button
                        onClick={() => setIsAiSummaryModalOpen(false)}
                        className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-6 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-zinc-600">
                    {aiSummaryLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
                          <p className="text-sm">Analyzing basin data and generating summary...</p>
                        </div>
                    ) : aiSummaryError ? (
                        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4 text-rose-400 text-sm flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium mb-1">Failed to generate summary</p>
                            <p className="opacity-80">{aiSummaryError}</p>
                          </div>
                        </div>
                    ) : aiSummaryText ? (
                        <div className="prose prose-invert prose-sm max-w-none">
                          {aiSummaryText.split('\n').map((line, i) => {
                            if (line.startsWith('#')) {
                              const level = line.match(/^#+/)?.[0].length || 1;
                              const text = line.replace(/^#+\s/, '');
                              const Tag = `h${Math.min(level + 2, 6)}` as any;
                              return <Tag key={i} className="text-zinc-200 font-medium mt-4 mb-2">{text}</Tag>;
                            }
                            if (line.startsWith('- ') || line.startsWith('* ')) {
                              return <li key={i} className="text-zinc-300 ml-4 list-disc">{line.substring(2)}</li>;
                            }
                            if (line.trim() === '') return <br key={i} />;
                            return <p key={i} className="text-zinc-300 leading-relaxed">{line}</p>;
                          })}
                        </div>
                    ) : null}
                  </div>
                </div>
              </div>
          )}

          {/* Full Screen Map Modal */}
          {fullScreenMap && fullScreenMapProps && (
              <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex flex-col p-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-mono text-zinc-200">{fullScreenMapProps.title}</h2>
                  <button
                      onClick={() => setFullScreenMap(null)}
                      className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-full transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
                <div className="flex-1 relative flex flex-col justify-center min-h-0 min-w-0 gap-4">
                  <div
                      className="relative overflow-hidden border rounded-lg border-black shadow-2xl bg-black flex shrink min-h-0 w-full h-full"
                      style={{
                        maxHeight: '100%',
                        maxWidth: '100%'
                      }}
                  >
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
                  <div className="flex-shrink-0 z-10 flex flex-col items-center w-full max-w-full overflow-x-auto pb-2 gap-4">
                    {fullScreenMapProps.cmap === 'sst' ? (
                        <SstaLegend minTemp={fullScreenMapProps.minTemp} maxTemp={fullScreenMapProps.maxTemp} horizontal={true} />
                    ) : (
                        <DiffLegend horizontal={true} />
                    )}

                    {fullScreenMapProps.showTimeline && result && (
                        <div className="w-full max-w-4xl border border-zinc-800/60 bg-zinc-950/80 rounded-xl p-3 backdrop-blur-md">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Timeline Navigation</div>
                            <button
                                onClick={() => {
                                  if (!isPlaying && timeStep >= 10) setTimeStep(0);
                                  setIsPlaying(!isPlaying);
                                }}
                                className="flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors bg-zinc-800/50 hover:bg-zinc-800 px-2 py-1 rounded"
                            >
                              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              {isPlaying ? 'Pause' : 'Auto-Play'}
                            </button>
                          </div>
                          <div className="flex items-center gap-4 mt-2 px-2">
                            <input
                                type="range"
                                min={0}
                                max={10}
                                step={1}
                                value={timeStep}
                                onChange={(e) => {
                                  setTimeStep(parseInt(e.target.value));
                                  setIsPlaying(false);
                                }}
                                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                            <div className="text-xs font-mono text-zinc-400 min-w-[80px] text-right">
                              {timeStep === 10 ? (predictionView === 'actual' ? 'Actual' : predictionView === 'difference' ? 'Diff' : 'Prediction') : `Day ${timeStep + 1}`}
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

