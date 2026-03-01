// FloodBoy Blockchain Dashboard - app.js
// Reads sensor data from JIBCHAIN L1 smart contracts

import { createPublicClient, http, formatUnits } from 'https://esm.sh/viem@2.21.54';

// ─── Constants ───────────────────────────────────────────────
const JIBCHAIN = {
    id: 8899,
    name: 'JIBCHAIN L1',
    nativeCurrency: { name: 'JBC', symbol: 'JBC', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc-l1.jibchain.net'] } },
    blockExplorers: { default: { name: 'JIBScan', url: 'https://exp.jibchain.net' } },
};

const FACTORY_ADDRESS = '0x63bB41b79b5aAc6e98C7b35Dcb0fE941b85Ba5Bb';
const UNIVERSAL_SIGNER = '0xcB0e58b011924e049ce4b4D62298Edf43dFF0BDd';
const EXPLORER = 'https://exp.jibchain.net';

// ABIs
const FACTORY_ABI = [
    {
        name: 'getStoreInfo',
        inputs: [{ name: 'store', type: 'address' }],
        outputs: [
            { name: 'nickname', type: 'string' },
            { name: 'owner', type: 'address' },
            { name: 'authorizedSensorCount', type: 'uint256' },
            { name: 'deployedBlock', type: 'uint128' },
            { name: 'description', type: 'string' },
        ],
        stateMutability: 'view',
        type: 'function',
    },
];

const STORE_ABI = [
    {
        name: 'getAllFields',
        inputs: [],
        outputs: [{ components: [{ name: 'name', type: 'string' }, { name: 'unit', type: 'string' }, { name: 'dtype', type: 'string' }], type: 'tuple[]' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        name: 'getLatestRecord',
        inputs: [{ name: 'sensor', type: 'address' }],
        outputs: [{ name: 'timestamp', type: 'uint256' }, { name: 'values', type: 'int256[]' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        name: 'RecordStored',
        inputs: [
            { indexed: true, name: 'sensor', type: 'address' },
            { indexed: false, name: 'timestamp', type: 'uint256' },
            { indexed: false, name: 'values', type: 'int256[]' },
        ],
        type: 'event',
    },
];

// ─── Viem Client ─────────────────────────────────────────────
const client = createPublicClient({ chain: JIBCHAIN, transport: http() });

// ─── State ───────────────────────────────────────────────────
let chartInstance = null;
let chartMode = 'water'; // 'water' | 'battery'
let cachedChartData = null;
let currentStore = '0xCd3Ec17ddFDa24f8F97131fa0FDf20e7cbd1A8Bb';

// ─── Utility ─────────────────────────────────────────────────
function truncateAddr(addr) {
    return addr.slice(0, 8) + '…' + addr.slice(-6);
}

function processValue(raw, unit) {
    const n = Number(raw);
    const baseUnit = unit.replace(/\s*x\d+/, '').trim();
    if (unit.includes('x10000')) return { value: (n / 10000).toFixed(4), unit: baseUnit };
    if (unit.includes('x1000')) return { value: (n / 1000).toFixed(3), unit: baseUnit };
    if (unit.includes('x100')) return { value: (n / 100).toFixed(3), unit: baseUnit };
    return { value: String(n), unit };
}

function formatFieldName(name) {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function movingAverage(data, window = 3) {
    return data.map((_, i) => {
        const start = Math.max(0, i - Math.floor(window / 2));
        const end = Math.min(data.length, i + Math.ceil(window / 2));
        const slice = data.slice(start, end);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
}

function setLoading(active) {
    const bar = document.getElementById('loading-bar');
    bar.classList.toggle('active', active);
}

// ─── Main Load ───────────────────────────────────────────────
async function loadStore(storeAddress) {
    currentStore = storeAddress;
    setLoading(true);
    cachedChartData = null;

    // Reset UI
    document.getElementById('store-nickname').textContent = 'Loading...';
    document.getElementById('store-description').textContent = 'Fetching from JIBCHAIN L1...';
    document.getElementById('data-tbody').innerHTML = '<tr><td colspan="4" class="loading-row">⏳ Loading sensor metrics...</td></tr>';
    document.getElementById('chart-overlay').classList.remove('hidden');

    try {
        // 1. Network status
        const blockNum = await client.getBlockNumber();
        document.getElementById('current-block').textContent = `Block: ${blockNum.toLocaleString()}`;
        document.getElementById('network-dot').className = 'dot connected';
        document.getElementById('network-label').textContent = 'JIBCHAIN L1';

        // 2. Store info from factory
        const [nickname, owner, sensorCount, deployedBlock, description] = await client.readContract({
            address: FACTORY_ADDRESS,
            abi: FACTORY_ABI,
            functionName: 'getStoreInfo',
            args: [storeAddress],
        });

        document.getElementById('store-nickname').textContent = nickname || 'Unknown Store';
        document.getElementById('store-description').textContent = description || '';
        document.getElementById('store-addr-short').textContent = truncateAddr(storeAddress);
        document.getElementById('explorer-link').href = `${EXPLORER}/address/${storeAddress}`;
        document.getElementById('owner-link').textContent = truncateAddr(owner);
        document.getElementById('owner-link').href = `${EXPLORER}/address/${owner}`;
        document.getElementById('deployed-block').textContent = deployedBlock.toLocaleString();
        document.getElementById('deployed-link').href = `${EXPLORER}/block/${deployedBlock}`;
        document.getElementById('sensor-count').textContent = `${sensorCount} authorized sensor${sensorCount !== 1n ? 's' : ''}`;

        // 3. Field definitions
        const fields = await client.readContract({
            address: storeAddress,
            abi: STORE_ABI,
            functionName: 'getAllFields',
        });

        // 4. Latest record
        const [ts, values] = await client.readContract({
            address: storeAddress,
            abi: STORE_ABI,
            functionName: 'getLatestRecord',
            args: [UNIVERSAL_SIGNER],
        });

        document.getElementById('last-updated').textContent = new Date(Number(ts) * 1000).toLocaleTimeString();
        setLoading(false);

        // 5. Build table
        buildTable(fields, values);

        // 6. Load historical chart
        await loadHistoricalChart(storeAddress, fields, blockNum);

    } catch (err) {
        console.error(err);
        setLoading(false);
        document.getElementById('store-nickname').textContent = 'Connection Error';
        document.getElementById('store-description').textContent = err.message;
        document.getElementById('data-tbody').innerHTML = `<tr><td colspan="4" class="loading-row" style="color:#f85149">❌ ${err.message}</td></tr>`;
        document.getElementById('chart-overlay').innerHTML = `<p style="color:#f85149">❌ Could not fetch data: ${err.message}</p>`;
    }
}

// ─── Table Builder ───────────────────────────────────────────
function buildTable(fields, values) {
    const tbody = document.getElementById('data-tbody');
    const rows = [];

    // Group fields: battery_voltage, installation_height, water_depth + count fields
    const processed = {};
    fields.forEach((f, i) => {
        const key = f.name.toLowerCase();
        if (!processed[key]) processed[key] = { field: f, raw: values[i] };
    });

    // Calculate min/max from known current (we only have latest; show same)
    const tableData = [];
    let waterCount = null;

    fields.forEach((f, i) => {
        const name = f.name.toLowerCase();
        if (name.includes('water_depth') && name.includes('count')) {
            waterCount = Number(values[i]);
            return; // Skip count field as separate row
        }
        const { value, unit } = processValue(values[i], f.unit);
        const displayName = formatFieldName(f.name);
        tableData.push({ name: displayName, value, unit, isWater: name === 'water_depth', raw: values[i], fieldUnit: f.unit });
    });

    rows.push(...tableData.map(row => {
        const label = row.isWater && waterCount != null
            ? `${row.name} <span class="tag-badge">${waterCount} samples</span>`
            : row.name;
        return `
          <tr>
            <td>${label}</td>
            <td><strong>${row.value} ${row.unit}</strong></td>
            <td>${row.value} ${row.unit}</td>
            <td>${row.value} ${row.unit}</td>
          </tr>`;
    }));

    tbody.innerHTML = rows.join('') || '<tr><td colspan="4" class="loading-row">No data</td></tr>';
}

// ─── Historical Chart ─────────────────────────────────────────
async function loadHistoricalChart(storeAddress, fields, currentBlock) {
    try {
        // Find field indexes dynamically
        const waterIdx = fields.findIndex(f => {
            const n = f.name.toLowerCase();
            return n === 'water_depth' || (n.includes('water_depth') && !n.includes('count') && !n.includes('min') && !n.includes('max'));
        });
        const batteryIdx = fields.findIndex(f => {
            const n = f.name.toLowerCase();
            return n === 'battery_voltage' || (n.includes('battery_voltage') && !n.includes('min') && !n.includes('max'));
        });

        // Fetch events in pages (max 2000 blocks/request)
        const PAGE = 2000n;
        const RANGE = 28800n; // ~24h at 3s blocks
        const toBlock = currentBlock;
        const fromBlock = toBlock - RANGE;

        const allEvents = [];
        for (let from = fromBlock; from <= toBlock; from += PAGE) {
            const to = from + PAGE - 1n < toBlock ? from + PAGE - 1n : toBlock;
            try {
                const events = await client.getContractEvents({
                    address: storeAddress,
                    abi: STORE_ABI,
                    eventName: 'RecordStored',
                    fromBlock: from,
                    toBlock: to,
                    args: { sensor: UNIVERSAL_SIGNER },
                });
                allEvents.push(...events);
            } catch (e) {
                console.warn('Page error', from, e.message);
            }
        }

        allEvents.sort((a, b) => Number(a.args.timestamp) - Number(b.args.timestamp));

        const waterData = [], batteryData = [], labels = [];
        const waterUnit = waterIdx >= 0 ? fields[waterIdx].unit : '';
        const batteryUnit = batteryIdx >= 0 ? fields[batteryIdx].unit : '';

        for (const ev of allEvents) {
            labels.push(new Date(Number(ev.args.timestamp) * 1000));
            waterData.push(waterIdx >= 0 ? processValue(ev.args.values[waterIdx], waterUnit).value : null);
            batteryData.push(batteryIdx >= 0 ? processValue(ev.args.values[batteryIdx], batteryUnit).value : null);
        }

        // Smooth
        const smoothWater = movingAverage(waterData.map(Number), 5);
        const smoothBattery = movingAverage(batteryData.map(Number), 5);

        cachedChartData = { labels, smoothWater, smoothBattery, waterUnit, batteryUnit };

        document.getElementById('chart-overlay').classList.add('hidden');
        renderChart(chartMode);

    } catch (err) {
        console.error('Chart error:', err);
        document.getElementById('chart-overlay').textContent = 'No historical data available';
    }
}

// ─── Chart Renderer ───────────────────────────────────────────
function renderChart(mode) {
    if (!cachedChartData) return;
    const { labels, smoothWater, smoothBattery, waterUnit, batteryUnit } = cachedChartData;
    const isWater = mode === 'water';
    const color = isWater ? '#3B82F6' : '#10B981';
    const data = isWater ? smoothWater : smoothBattery;
    const unit = isWater ? waterUnit : batteryUnit;
    const title = isWater ? 'Water Depth Over Time' : 'Battery Voltage Over Time';

    document.getElementById('chart-title').textContent = title;

    if (chartInstance) chartInstance.destroy();
    const ctx = document.getElementById('mainChart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: isWater ? `Water Depth (${unit})` : `Battery (${unit})`,
                data,
                borderColor: color,
                backgroundColor: color + '20',
                borderWidth: 2,
                pointRadius: Math.min(3, Math.max(0, 300 / data.length)),
                tension: 0.4,
                fill: true,
            }],
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#8b949e' } },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(4)} ${unit}`,
                        title: ctx => new Date(ctx[0].label).toLocaleString(),
                    },
                },
            },
            scales: {
                x: {
                    type: 'time',
                    time: { tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm', day: 'MMM d' } },
                    ticks: { color: '#8b949e', maxRotation: 0 },
                    grid: { color: '#30363d' },
                },
                y: {
                    ticks: { color: '#8b949e', callback: v => v.toFixed(3) + ' ' + unit },
                    grid: { color: '#30363d' },
                },
            },
        },
    });
}

// ─── Toggle ───────────────────────────────────────────────────
window.switchChart = function (mode) {
    chartMode = mode;
    document.getElementById('btn-water').classList.toggle('active', mode === 'water');
    document.getElementById('btn-battery').classList.toggle('active', mode === 'battery');
    renderChart(mode);
};

// ─── Store Selector ───────────────────────────────────────────
document.getElementById('store-select').addEventListener('change', (e) => {
    loadStore(e.target.value);
});

// ─── Bootstrap ───────────────────────────────────────────────
loadStore(currentStore);
