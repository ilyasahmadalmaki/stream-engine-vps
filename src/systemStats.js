const os = require('os');
const { exec } = require('child_process');

// Helper untuk menghitung % CPU (Native tanpa library berat)
function getCpuUsage() {
    return new Promise((resolve) => {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;
        
        cpus.forEach((cpu) => {
            for (let type in cpu.times) {
                total += cpu.times[type];
            }
            idle += cpu.times.idle;
        });

        const usage = 100 - Math.round(100 * idle / total);
        resolve(usage); 
    });
}

// Helper untuk cek Disk Space (Linux command: df -h)
function getDiskUsage() {
    return new Promise((resolve) => {
        // Cek partisi root "/"
        exec('df -h /', (err, stdout) => {
            if (err) {
                return resolve({ total: '0G', used: '0G', percent: '0%' });
            }
            
            // Output df -h biasanya:
            // Filesystem      Size  Used Avail Use% Mounted on
            // /dev/root        25G   10G   15G  40% /
            
            const lines = stdout.trim().split('\n');
            const lastLine = lines[lines.length - 1].replace(/\s+/g, ' '); // Hapus spasi ganda
            const parts = lastLine.split(' ');
            
            // parts[1] = Size, parts[2] = Used, parts[4] = Use%
            resolve({
                total: parts[1],
                used: parts[2],
                percent: parts[4]
            });
        });
    });
}

const getSystemStats = async () => {
    // 1. RAM
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = ((usedMem / totalMem) * 100).toFixed(1);
    const totalMemGB = (totalMem / 1024 / 1024 / 1024).toFixed(1);
    const usedMemGB = (usedMem / 1024 / 1024 / 1024).toFixed(1);

    // 2. CPU
    const cpuUsage = await getCpuUsage();

    // 3. Disk
    const disk = await getDiskUsage();

    return {
        cpu: cpuUsage,
        ram: `${usedMemGB}/${totalMemGB} GB`,
        ramUsage: memUsage,
        disk: disk // Object { total, used, percent }
    };
};

module.exports = { getSystemStats };
