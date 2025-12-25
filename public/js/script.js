// --- CLOCK & MONITORING ---
function updateClock() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false });
    document.getElementById('digital-clock').innerHTML = `${timeStr} <br> <span style="font-size:0.8rem">${dateStr}</span>`;
}
setInterval(updateClock, 1000);

function updateStats() {
    fetch('/api/system/stats')
        .then(res => res.json())
        .then(data => {
            if(!data) return;
            const text = `CPU ${data.cpu}% | RAM ${data.ram_used}/${data.ram_total}GB | Disk ${data.disk_percent}% | NET ↑${data.net_tx}KB ↓${data.net_rx}KB`;
            document.getElementById('system-stats').innerText = text;
        });
}
setInterval(updateStats, 2000);

// --- LOAD DATA ---
function loadVideos() {
    fetch('/api/videos')
        .then(res => res.json())
        .then(videos => {
            const list = document.getElementById('video-list');
            const select = document.getElementById('video-select');
            
            list.innerHTML = '';
            select.innerHTML = '<option value="">-- Pilih Video --</option>';

            videos.forEach(v => {
                // Populate Dropdown
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.innerText = v.title;
                select.appendChild(opt);

                // Populate Gallery
                const div = document.createElement('div');
                div.className = 'video-item';
                div.innerHTML = `
                    <video src="${v.file_path.startsWith('http') ? v.file_path : '/'+v.file_path}" controls preload="metadata"></video>
                    <div style="flex:1">
                        <h3>${v.title}</h3>
                        <p>Source: ${v.source_type}</p>
                    </div>
                `;
                list.appendChild(div);
            });
        });
}

function loadStreams() {
    fetch('/api/streams')
        .then(res => res.json())
        .then(streams => {
            const grid = document.getElementById('streams-list');
            grid.innerHTML = '';

            streams.forEach(s => {
                const card = document.createElement('div');
                card.className = 'card';
                
                const nextRun = new Date(s.next_start_time).toLocaleString();
                
                card.innerHTML = `
                    <div style="display:flex;justify-content:space-between">
                        <h3>${s.title}</h3>
                        <span class="status-badge status-${s.status}">${s.status}</span>
                    </div>
                    <p style="font-size:0.9rem; color:#aaa">Video: ${s.video_title}</p>
                    <p>Next: <b>${nextRun}</b></p>
                    <p>Mode: ${s.schedule_type.toUpperCase()}</p>
                    <div style="margin-top:10px; display:flex; gap:5px;">
                        ${s.status !== 'live' ? `<button onclick="manualStart(${s.id})" style="background:#00ff88; color:black">Start</button>` : ''}
                        ${s.status === 'live' ? `<button onclick="manualStop(${s.id})" style="background:orange; color:black">Stop</button>` : ''}
                        <button onclick="deleteStream(${s.id})" style="background:red; color:white">Del</button>
                    </div>
                `;
                grid.appendChild(card);
            });
        });
}

// --- ACTIONS ---
function toggleScheduleInputs(val) {
    document.getElementById('input-once').style.display = val === 'once' ? 'block' : 'none';
    document.getElementById('input-daily').style.display = val === 'daily' ? 'block' : 'none';
}

function createStream(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    fetch('/api/streams', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    }).then(() => {
        closeModal('modal-stream');
        loadStreams();
    });
}

function uploadVideo(input) {
    if(!input.files[0]) return;
    const formData = new FormData();
    formData.append('video', input.files[0]);

    fetch('/api/videos/upload', {
        method: 'POST',
        body: formData
    }).then(() => {
        alert('Upload Success');
        loadVideos();
    });
}

function importVideo(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    fetch('/api/videos/import', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    }).then(() => {
        closeModal('modal-import');
        loadVideos();
    });
}

function manualStart(id) {
    if(!confirm("Start stream now manually?")) return;
    fetch(`/api/streams/${id}/start`, {method: 'POST'}).then(loadStreams);
}

function manualStop(id) {
    if(!confirm("Stop stream immediately?")) return;
    fetch(`/api/streams/${id}/stop`, {method: 'POST'}).then(loadStreams);
}

function deleteStream(id) {
    if(!confirm("Delete this schedule?")) return;
    fetch(`/api/streams/${id}`, {method: 'DELETE'}).then(loadStreams);
}

// --- MODAL UTILS ---
function openModal(id) { document.getElementById(id).style.display = 'block'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// --- INIT ---
loadVideos();
loadStreams();
setInterval(loadStreams, 5000); // Auto refresh status stream