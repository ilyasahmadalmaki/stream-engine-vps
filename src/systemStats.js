const os = require('os');

// Fungsi pembantu untuk menghitung % CPU
// Mengambil snapshot penggunaan CPU sekarang vs 100ms lagi
function getCpuUsage() {
    return new Promise((resolve) => {
        const start = os.cpus().map(cpu => cpu.times);
        
        setTimeout(() => {
            const end = os.cpus().map(cpu => cpu.times);
            
            let idle = 0;
            let total = 0;

            for (let i = 0; i < start.length; i++) {
                const startTimes = start[i];
                const endTimes = end[i];

                // Hitung selisih waktu
                const idleDiff = endTimes.idle - startTimes.idle;
                const totalDiff = (endTimes.user + endTimes.nice + endTimes.sys + endTimes.idle + endTimes.irq) - 
                                  (startTimes.user + startTimes.nice + startTimes.sys + startTimes.idle + startTimes.irq);

                idle += idleDiff;
                total += totalDiff;
            }

            const usage = total === 0 ? 0 : ((1 - idle / total) * 100);
            resolve(usage.toFixed(1)); // Return 1 angka belakang koma (misal: 12.5)
        }, 100); // Sampling selama 100ms
    });
}

// Fungsi Utama yang dipanggil Server
const getSystemStats = async () => {
    // 1. Hitung RAM
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Konversi Byte ke GB (Byte / 1024 / 1024 / 1024)
    const totalGB = (totalMem / (1024 ** 3)).toFixed(2); // 2 angka belakang koma
    const usedGB = (usedMem / (1024 ** 3)).toFixed(2);

    // 2. Hitung CPU
    const cpuUsage = await getCpuUsage();

    // 3. Return Data
    return {
        cpu: cpuUsage,
        ramUsage: `${usedGB}/${totalGB} GB`, // Format string: "0.55/2.00 GB"
        disk: 'N/A' // Disk check butuh library tambahan, kita skip biar ringan
    };
};

module.exports = { getSystemStats };
