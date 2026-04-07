export interface BasinMetric {
  basinName: string;
  meanAnomaly: number;
  maxAnomaly: number;
  minAnomaly: number;
  medianAnomaly: number;
  stdDev: number;
  percentAbove1: number;
  percentAbove2: number;
  percentBelowMinus1: number;
  hotspot: { lat: string; lon: string } | null;
  coldspot: { lat: string; lon: string } | null;
}

export function calculateBasinMetrics(data: Float32Array, width: number, height: number, offset: number = 0): BasinMetric[] {
  const basins = [
    { name: 'Pacific', check: (lat: number, lon: number) => lat >= -60 && lat <= 66.5 && (lon > 120 || lon < -70) },
    { name: 'Atlantic', check: (lat: number, lon: number) => lat >= -60 && lat <= 66.5 && lon >= -70 && lon <= 20 },
    { name: 'Indian', check: (lat: number, lon: number) => lat >= -60 && lat <= 30 && lon > 20 && lon <= 120 },
    { name: 'Southern', check: (lat: number, lon: number) => lat < -60 },
    { name: 'Arctic', check: (lat: number, lon: number) => lat > 66.5 },
  ];

  const basinData: Record<string, { values: number[], max: number, min: number, hotspot: { lat: string, lon: string } | null, coldspot: { lat: string, lon: string } | null }> = {};
  
  for (const basin of basins) {
    basinData[basin.name] = { values: [], max: -Infinity, min: Infinity, hotspot: null, coldspot: null };
  }

  for (let y = 0; y < height; y++) {
    // flipY is true, so dataY = height - 1 - y
    const dataY = height - 1 - y;
    const lat = (dataY / height) * 180 - 90;
    
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * 360 - 180;
      const val = data[offset + y * width + x];
      
      if (val > -999 && !isNaN(val)) {
        for (const basin of basins) {
          if (basin.check(lat, lon)) {
            const bd = basinData[basin.name];
            bd.values.push(val);
            if (val > bd.max) {
              bd.max = val;
              bd.hotspot = { lat: lat.toFixed(2), lon: lon.toFixed(2) };
            }
            if (val < bd.min) {
              bd.min = val;
              bd.coldspot = { lat: lat.toFixed(2), lon: lon.toFixed(2) };
            }
            break; // A point belongs to only one basin
          }
        }
      }
    }
  }

  const results: BasinMetric[] = [];

  for (const basin of basins) {
    const bd = basinData[basin.name];
    if (bd.values.length === 0) continue;

    const values = bd.values;
    values.sort((a, b) => a - b);
    
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    
    const median = values.length % 2 === 0 
      ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
      : values[Math.floor(values.length / 2)];
      
    const squareDiffs = values.map(v => Math.pow(v - mean, 2));
    const stdDev = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
    
    const above1 = values.filter(v => v > 1).length;
    const above2 = values.filter(v => v > 2).length;
    const belowMinus1 = values.filter(v => v < -1).length;

    results.push({
      basinName: basin.name,
      meanAnomaly: mean,
      maxAnomaly: bd.max,
      minAnomaly: bd.min,
      medianAnomaly: median,
      stdDev: stdDev,
      percentAbove1: (above1 / values.length) * 100,
      percentAbove2: (above2 / values.length) * 100,
      percentBelowMinus1: (belowMinus1 / values.length) * 100,
      hotspot: bd.hotspot,
      coldspot: bd.coldspot
    });
  }

  return results;
}
