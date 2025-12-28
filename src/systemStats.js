const os = require('os');
const { exec } = require('child_process');

// Helper: Ambil total tick CPU saat ini
function getCpuInfo() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0, total = 0;

    for (let cpu in cpus) {
        if (!cpus.hasOwnProperty(cpu)) continue;
        user += cpus[cpu].times.user;
        nice += cpus[cpu].times.nice;
        sys += cpus[cpu].times.sys;
        irq += cpus[cpu].times.irq;
        idle += cpus[cpu].times.idle;
    }
    total = user + nice + sys + idle + irq;
    return { idle, total };
}

// Helper: Hitung % CPU dengan delay 1 detik (Real-time sampling)
function getCpuUsage() {
    return new Promise((resolve) => {
        const start = getCpuInfo();
        
        // Kita "tidur" 1 detik untuk mengambil sampel perbedaan
        setTimeout(() => {
            const end = getCpuInfo();
            const idleDiff = end.idle - start.idle;
            const totalDiff = end.total - start.total;
            
            // Hitung persentase
            const percentage = 100 - Math.round(100 * idleDiff / totalDiff);
            resolve(percentage);
        }, 1000); 
    });
}

// Helper Disk (Versi Anti-Crash)
function getDiskUsage() {
    return new Promise((resolve) => {
        exec('df -h /', (err, stdout) => {
            if (err || !stdout) {
                return resolve({ total: '?', used: '?', percent: '0%' });
            }
            try {
                const lines = stdout.trim().split('\n');
                const lastLine = lines[lines.length - 1].replace(/\s+/g, ' '); 
                const parts = lastLine.split(' ');
                // Format df -h: Filesystem Size Used Avail Use% Mounted
                resolve({
                    total: parts[1],
                    used: parts[2],
                    percent: parts[4]
                });
            } catch (e) {
                resolve({ total: '?', used: '?', percent: 'Err' });
            }
        });
    });
}

const getSystemStats = async () => {
    try {
        // 1. CPU (Akan delay 1 detik di sini)
        const cpuUsage = await getCpuUsage();

        // 2. RAM
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        const totalMemGB = (totalMem / 1024 / 1024 / 1024).toFixed(1);
        const usedMemGB = (usedMem / 1024 / 1024 / 1024).toFixed(1);
        const ramPercent = Math.round((usedMem / totalMem) * 100);

        // 3. Disk
        const disk = await getDiskUsage();

        return {
            cpu: cpuUsage || 0,
            ram: `${usedMemGB}/${totalMemGB} GB (${ramPercent}%)`,
            ramUsage: ramPercent,
            disk: disk 
        };
    } catch (e) {
        console.error("[STATS ERROR]", e);
        return { cpu: 0, ram: "Error", disk: { percent: "Error" } };
    }
};

module.exports = { getSystemStats };
