import { useEffect, useState } from 'react';
import {
  client,
  FLOODBOY016_STORE,
  getStoreInfo,
  getFields,
  getLatestRecord,
  getHistoricalEvents,
  processValue,
  formatFieldName
} from './lib/web3';
import type { StoreInfo } from './lib/web3';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ExternalLink, Database, Activity, MapPin } from 'lucide-react';
import './App.css';

interface FormattedRecord {
  metric: string;
  current: string;
  min: string;
  max: string;
}

interface ChartDataPoint {
  timestamp: number;
  waterDepth: number | null;
  batteryVoltage: number | null;
  blockNumber: number;
}

function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number>(0);
  const [tableData, setTableData] = useState<FormattedRecord[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [activeChart, setActiveChart] = useState<'waterDepth' | 'batteryVoltage'>('waterDepth');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const block = await client.getBlockNumber();
        setCurrentBlock(Number(block));

        const info = await getStoreInfo(FLOODBOY016_STORE);
        setStoreInfo(info);

        const schema = await getFields(FLOODBOY016_STORE);

        const { timestamp, values: latestValues } = await getLatestRecord(FLOODBOY016_STORE);
        setLastUpdated(new Date(timestamp));

        const events = await getHistoricalEvents(FLOODBOY016_STORE);

        if (schema.length > 0 && latestValues.length > 0) {
          // Process Table Data
          const counts = events.length;

          const currentRecords = schema.map((field, idx) => {
            const rawVal = latestValues[idx];
            let name = formatFieldName(field.name);
            const valStr = processValue(rawVal, field.unit);

            // Handle specific min/max tracking from historical data if needed.
            // For simplicity and speed in this version, we will approximate min/max from events 
            // for the displayed current record, matching the format.

            const eventValues = events.map(e => Number((e as any).args?.values?.[idx]));
            const validEventValues = eventValues.filter(v => !isNaN(v));

            let minStr = valStr;
            let maxStr = valStr;

            if (validEventValues.length > 0) {
              const min = Math.min(...validEventValues);
              const max = Math.max(...validEventValues);
              minStr = processValue(min, field.unit);
              maxStr = processValue(max, field.unit);
            }

            if (name.toLowerCase() === 'water depth') {
              name = `Water Depth (${counts} samples)`;
            }

            return {
              metric: name,
              current: valStr,
              min: minStr,
              max: maxStr
            };
          });

          setTableData(currentRecords.sort((a, b) => a.metric.localeCompare(b.metric)));

          // Process chart data
          const waterDepthIndex = schema.findIndex(f => f.name.toLowerCase().includes('water_depth') && !f.name.includes('min') && !f.name.includes('max'));
          const batteryVoltageIndex = schema.findIndex(f => f.name.toLowerCase().includes('battery_voltage') && !f.name.includes('min') && !f.name.includes('max'));

          const chartPoints: ChartDataPoint[] = events.map(event => {
            const args = (event as any).args;
            return {
              timestamp: Number(args.timestamp) * 1000,
              waterDepth: waterDepthIndex >= 0 ? Number(args.values[waterDepthIndex]) / 10000 : null,
              batteryVoltage: batteryVoltageIndex >= 0 ? Number(args.values[batteryVoltageIndex]) / 100 : null,
              blockNumber: Number(event.blockNumber)
            };
          }).sort((a, b) => a.timestamp - b.timestamp);

          setChartData(chartPoints);
        }

      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to fetch sensor data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const formatDate = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const truncateAddress = (addr: string) => {
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-red-50 text-red-600 p-6 rounded-xl border border-red-200 max-w-lg">
          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
            <Activity className="h-5 w-5" /> Error Loading Data
          </h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">

        {/* Header Section */}
        <header className="p-6 md:p-8 border-b border-gray-100 bg-white">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-blue-600 tracking-wider uppercase mb-1 flex items-center gap-2">
                <Database className="h-4 w-4" /> Latest Sensor Data
              </p>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {storeInfo?.nickname || 'Unknown Store'}
              </h1>
              <p className="text-gray-500 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {storeInfo?.description || 'No description available'}
              </p>
            </div>

            <div className="flex flex-col gap-2 md:items-end text-sm text-gray-600">
              <div className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1 rounded-full w-max">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Current Block: {currentBlock}
              </div>
              <p className="font-medium text-gray-900 mt-2">
                Last Updated: {lastUpdated ? formatDate(lastUpdated).split(', ')[1] : 'N/A'}
              </p>
              <a
                href={`https://exp.jibchain.net/address/${FLOODBOY016_STORE}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
                title={FLOODBOY016_STORE}
              >
                {truncateAddress(FLOODBOY016_STORE)} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </header>

        <main className="p-6 md:p-8 space-y-8">

          {/* Chart Section */}
          <section className="bg-gray-50 rounded-xl p-4 md:p-6 border border-gray-100">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
              <h2 className="text-lg font-semibold text-gray-800">
                {activeChart === 'waterDepth' ? 'Water Depth Over Time' : 'Battery Voltage Over Time'}
              </h2>
              <div className="flex bg-white rounded-lg shadow-sm p-1 border border-gray-200">
                <button
                  onClick={() => setActiveChart('waterDepth')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeChart === 'waterDepth'
                    ? 'bg-blue-50 text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  Water Depth
                </button>
                <button
                  onClick={() => setActiveChart('batteryVoltage')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeChart === 'batteryVoltage'
                    ? 'bg-emerald-50 text-emerald-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  Battery Voltage
                </button>
              </div>
            </div>

            <div className="h-[300px] w-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      stroke="#9CA3AF"
                      tick={{ fill: '#6B7280', fontSize: 12 }}
                      minTickGap={30}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      stroke="#9CA3AF"
                      tick={{ fill: '#6B7280', fontSize: 12 }}
                      tickFormatter={(val) => activeChart === 'waterDepth' ? val.toFixed(2) : val.toFixed(1)}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                      labelFormatter={(label) => new Date(label as string | number | Date).toLocaleString()}
                      formatter={(value: number | undefined) => {
                        if (value === undefined) return ["N/A", activeChart === 'waterDepth' ? 'Water Depth' : 'Battery Voltage'];
                        return [
                          activeChart === 'waterDepth' ? `${value.toFixed(4)} m` : `${value.toFixed(3)} V`,
                          activeChart === 'waterDepth' ? 'Water Depth' : 'Battery Voltage'
                        ];
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey={activeChart}
                      stroke={activeChart === 'waterDepth' ? '#3B82F6' : '#10B981'}
                      strokeWidth={3}
                      dot={{ r: 4, fill: activeChart === 'waterDepth' ? '#3B82F6' : '#10B981', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 bg-white rounded-lg border border-dashed border-gray-200">
                  No historical data available.
                </div>
              )}
            </div>
          </section>

          {/* Data Table */}
          <section className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-600">
                  <th className="p-4">Metric</th>
                  <th className="p-4 rounded-tl-lg">Current</th>
                  <th className="p-4 text-gray-500">Min</th>
                  <th className="p-4 text-gray-500 rounded-tr-lg">Max</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {tableData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 font-medium text-gray-900">{row.metric}</td>
                    <td className="p-4 font-semibold text-gray-900">{row.current}</td>
                    <td className="p-4 text-gray-500">{row.min}</td>
                    <td className="p-4 text-gray-500">{row.max}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>

        {/* Footer */}
        <footer className="bg-gray-50 p-6 md:p-8 border-t border-gray-100 text-sm text-gray-500 grid md:grid-cols-2 gap-4">
          <div>
            <p className="mb-1">
              <span className="font-medium">Last Updated:</span> {lastUpdated ? formatDate(lastUpdated) : 'N/A'}
            </p>
            <p>
              <span className="font-medium">Store Owner:</span>{' '}
              <a href={`https://exp.jibchain.net/address/${storeInfo?.owner}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                {storeInfo?.owner ? truncateAddress(storeInfo.owner) : 'N/A'}
              </a>
            </p>
          </div>
          <div className="md:text-right">
            <p className="mb-1">
              <span className="font-medium">Deployed Block:</span>{' '}
              <a href={`https://exp.jibchain.net/block/${storeInfo?.deployedBlock}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                #{storeInfo?.deployedBlock || 'N/A'}
              </a>
            </p>
            <p>
              <span className="font-medium">Sensor Count:</span> {storeInfo?.authorizedSensorCount || 0} authorized sensor(s)
            </p>
          </div>
        </footer>

      </div>
    </div>
  );
}

export default App;
