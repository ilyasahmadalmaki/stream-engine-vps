const si = require('systeminformation');

const getSystemStats = async () => {
    try {
        const [cpu, mem, fsSize, network] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.networkStats()
        ]);

        // Ambil disk root "/", fallback ke disk pertama jika tidak ketemu
        const rootDisk = fsSize.find(d => d.mount === '/') || fsSize[0] || { use: 0 };

        // Ambil network interface pertama
        const net = network[0] || { tx_sec: 0, rx_sec: 0 };

        return {
            cpu: Math.round(cpu.currentLoad),
            ram_used: (mem.active / 1024 / 1024 / 1024).toFixed(2),
            ram_total: (mem.total / 1024 / 1024 / 1024).toFixed(2),
            disk_percent: Math.round(rootDisk.use),
            net_tx: (net.tx_sec / 1024).toFixed(1), // KB/s
            net_rx: (net.rx_sec / 1024).toFixed(1)  // KB/s
        };
    } catch (e) {
        console.error("Stats Error:", e);
        // Kembalikan data kosong agar server tidak crash
        return {
            cpu: 0, ram_used: 0, ram_total: 0, disk_percent: 0, net_tx: 0, net_rx: 0
        };
    }
};

module.exports = { getSystemStats };
