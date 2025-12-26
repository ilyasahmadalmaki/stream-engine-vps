// ==========================================
// 1. SYSTEM MONITORING & CLOCK (24H FORMAT)
// ==========================================

function updateClock() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const clockEl = document.getElementById('digital-clock');
    if(clockEl) clockEl.innerHTML = `${timeStr} <br> <span style="font-size:0.8rem">${dateStr}</span>`;
}
setInterval(updateClock, 1000);

function updateStats() {
    fetch('/api/system/stats')
        .then(res => res.json())
        .then(data => {
            if(!data) return;
            const text = `CPU ${data.cpu}% | RAM ${data.ram_used}/${data.ram_total}GB | Disk ${data.disk_percent}% | NET ↑${data.net_tx}KB ↓${data.net_rx}KB`;
            const statsEl = document.getElementById('system-stats');
            if(statsEl) statsEl.innerText = text;
        })
        .catch(err => {}); 
}
setInterval(updateStats, 2000);

// ==========================================
// 2. VIDEO GALLERY
// ==========================================

function loadVideos() {
    fetch('/api/videos')
        .then(res => res.json())
        .then(videos => {
            const list = document.getElementById('video-list');
            const select = document.getElementById('video-select');
            
            if(!list || !select) return;

            list.innerHTML = '';
            select.innerHTML = '<option value="">-- Pilih Video --</option>';

            videos.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.innerText = v.title;
                select.appendChild(opt);

                let thumbUrl = v.thumbnail_path ? v.thumbnail_path.replace(/\\/g, '/') : null;
                if(thumbUrl && !thumbUrl.startsWith('/')) thumbUrl = '/' + thumbUrl;

                const imgHtml = thumbUrl 
                    ? `<img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover; opacity:0.8; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.8">` 
                    : `<div style="width:100%; height:100%; background:#2a2a2a; display:flex; align-items:center; justify-content:center; color:#555;">No Preview</div>`;

                let videoUrl = v.file_path.replace(/\\/g, '/');
                if (!videoUrl.startsWith('http')) {
                    if (videoUrl.includes('uploads/')) {
                        videoUrl = '/uploads/' + videoUrl.split('uploads/')[1];
                    } else if (videoUrl.startsWith('/var/www')) {
                        videoUrl = '/uploads/' + videoUrl.split('/').pop();
                    }
                }

                const safeTitle = v.title.replace(/'/g, "\\'");
                const safeUrl = videoUrl.replace(/'/g, "\\'");
                const ext = v.file_path.split('.').pop().toUpperCase();

                const div = document.createElement('div');
                div.className = 'video-item';
                div.innerHTML = `
                    <div class="video-thumb-container" onclick="playVideo('${safeUrl}', '${safeTitle}')" 
                         style="width:160px; height:90px; background:#000; border-radius:4px; overflow:hidden; position:relative; flex-shrink:0; cursor:pointer;">
                        ${imgHtml}
                        <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:35px; height:35px; background:rgba(0,0,0,0.6); border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid white;">
                            <div style="width:0; height:0; border-top:6px solid transparent; border-bottom:6px solid transparent; border-left:10px solid white; margin-left:3px;"></div>
                        </div>
                        <div style="position:absolute; bottom:5px; right:5px; background:rgba(0,0,0,0.7); color:white; font-size:10px; padding:2px 4px; border-radius:2px; font-weight:bold;">${ext}</div>
                    </div>
                    <div style="flex:1; min-width: 0; padding-left: 15px;">
                        <h3 style="margin:0 0 5px 0; font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${v.title}">${v.title}</h3>
                        <p style="font-size:0.8rem; color:#aaa; margin:0;">
                            Size: ${(v.file_size/1024/1024).toFixed(1)} MB <br>
                            Source: <span style="color:var(--accent)">${v.source_type}</span>
                        </p>
                        <div style="margin-top:10px; display:flex; gap:8px;">
                            <button onclick="renameVideo(${v.id}, '${safeTitle}')" style="background:#444; font-size:0.75rem; padding:4px 10px;">Rename</button>
                            <button onclick="convertVideo(${v.id})" style="background:#007bff; font-size:0.75rem; padding:4px 10px;">⚡ Fix/Convert</button>
                            <button onclick="deleteVideo(${v.id})" style="background:#a00; font-size:0.75rem; padding:4px 10px;">Delete</button>
                        </div>
                    </div>
                `;
                list.appendChild(div);
            });
        });
}

// ==========================================
// 3. STREAM MANAGEMENT (SAFE EDIT MODE)
// ==========================================

function loadStreams() {
    fetch('/api/streams')
        .then(res => res.json())
        .then(streams => {
            const grid = document.getElementById('streams-list');
            if(!grid) return;
            grid.innerHTML = '';

            if(streams.length === 0) {
                grid.innerHTML = '<p style="color:#555; font-style:italic;">Belum ada jadwal stream aktif.</p>';
                return;
            }

            streams.forEach(s => {
                const card = document.createElement('div');
                card.className = 'card';
                
                const nextRun = new Date(s.next_start_time).toLocaleString('id-ID', {
                    hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit'
                });
                
                const durTotal = s.daily_duration_minutes || 0;
                const durH = Math.floor(durTotal / 60);
                const durM = durTotal % 60;
                const durStr = `${durH}j ${durM}m`;

                // --- LOGIKA PENGAMAN TOMBOL EDIT ---
                const isLive = s.status === 'live';
                
                // Jika Live: Tombol Edit Disabled (Abu-abu)
                const editBtnHtml = isLive 
                    ? `<button disabled style="background:#444; color:#888; width:40px; cursor:not-allowed;" title="Stop stream dulu untuk mengedit">✏️</button>`
                    : `<button onclick="editStream(${s.id})" style="background:#007bff; color:white; width:40px;" title="Edit">✏️</button>`;

                const deleteBtnHtml = isLive
                    ? `<button disabled style="background:#444; color:#888; width:40px; cursor:not-allowed;" title="Stop stream dulu untuk menghapus">🗑</button>`
                    : `<button onclick="deleteStream(${s.id})" style="background:#ff4444; color:white; width:40px;" title="Hapus">🗑</button>`;

                card.innerHTML = `
                    <div style="display:flex;justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                        <h3 style="margin:0; font-size:1.1rem; word-break:break-word;">${s.title}</h3>
                        <span class="status-badge status-${s.status}">${s.status}</span>
                    </div>
                    <div style="font-size:0.9rem; color:#ccc; line-height:1.6;">
                        <div>🎥 <b>Video:</b> ${s.video_title || 'Deleted Video'}</div>
                        <div>📅 <b>Next:</b> ${nextRun}</div>
                        <div>⏳ <b>Durasi:</b> ${durStr}</div>
                    </div>
                    <div style="margin-top:15px; display:flex; gap:5px; border-top:1px solid #333; padding-top:10px;">
                        ${!isLive ? `<button onclick="manualStart(${s.id})" style="background:#00ff88; color:black; flex:1;">Start</button>` : ''}
                        ${isLive ? `<button onclick="manualStop(${s.id})" style="background:orange; color:black; flex:1;">Stop</button>` : ''}
                        
                        ${editBtnHtml}
                        ${deleteBtnHtml}
                    </div>
                `;
                grid.appendChild(card);
            });
        });
}

function openStreamModal() {
    document.getElementById('stream-form').reset();
    document.getElementById('stream-id').value = ''; 
    document.getElementById('modal-stream-title').innerText = 'Konfigurasi Stream Baru';
    document.getElementById('btn-save-stream').innerText = 'Buat Jadwal';
    document.getElementById('duration-hours').value = 1;
    document.getElementById('duration-minutes').value = 0;
    toggleScheduleInputs('daily');
    openModal('modal-stream');
}

function editStream(id) {
    fetch(`/api/streams/${id}`)
        .then(r => r.json())
        .then(data => {
            if(data.status === 'live') {
                alert("Stream sedang berjalan! Stop dulu sebelum edit.");
                return;
            }
            document.getElementById('stream-id').value = data.id; 
            document.getElementById('stream-title').value = data.title;
            document.getElementById('stream-key').value = data.stream_key;
            document.getElementById('video-select').value = data.video_id;
            document.getElementById('schedule-type').value = data.schedule_type;
            
            toggleScheduleInputs(data.schedule_type);

            if(data.schedule_type === 'once') {
                document.getElementById('start-time').value = data.start_time ? data.start_time.slice(0,16) : '';
                document.getElementById('end-time').value = data.end_time ? data.end_time.slice(0,16) : '';
            } else {
                document.getElementById('daily-start-time').value = data.daily_start_time;
                const totalM = data.daily_duration_minutes || 0;
                document.getElementById('duration-hours').value = Math.floor(totalM / 60);
                document.getElementById('duration-minutes').value = totalM % 60;
            }

            document.getElementById('modal-stream-title').innerText = 'Edit Stream';
            document.getElementById('btn-save-stream').innerText = 'Update Jadwal';
            openModal('modal-stream');
        })
        .catch(err => alert("Gagal mengambil data stream: " + err));
}

function saveStream(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    const id = document.getElementById('stream-id').value;

    const url = id ? `/api/streams/${id}` : '/api/streams';
    const method = id ? 'PUT' : 'POST';

    fetch(url, {
        method: method,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    }).then(res => res.json()).then(result => {
        if(result.error) alert(result.error);
        else {
            closeModal('modal-stream');
            loadStreams();
        }
    });
}

function manualStart(id) {
    if(!confirm("Mulai stream sekarang?")) return;
    fetch(`/api/streams/${id}/start`, {method: 'POST'}).then(() => loadStreams());
}

function manualStop(id) {
    if(!confirm("Matikan stream paksa?")) return;
    fetch(`/api/streams/${id}/stop`, {method: 'POST'}).then(() => loadStreams());
}

function deleteStream(id) {
    if(!confirm("Hapus jadwal ini?")) return;
    fetch(`/api/streams/${id}`, {method: 'DELETE'}).then(() => loadStreams());
}

function toggleScheduleInputs(val) {
    document.getElementById('input-once').style.display = val === 'once' ? 'block' : 'none';
    document.getElementById('input-daily').style.display = val === 'daily' ? 'block' : 'none';
}

// ==========================================
// 4. PREVIEW PLAYER
// ==========================================

function playVideo(url, title) {
    const modal = document.getElementById('modal-player');
    const video = document.getElementById('main-player');
    const titleEl = document.getElementById('player-title');

    modal.style.display = 'block';
    titleEl.innerText = "Playing: " + title;
    
    video.onerror = null; 
    video.src = url;
    video.load();
    video.play().catch(e => { console.warn("Autoplay blocked:", e); });

    video.onerror = function() {
        if (!video.src || video.src === window.location.href) return;
        alert("Browser tidak dapat memutar video ini. Klik '⚡ Fix/Convert'.");
    };
}

function closePlayer() {
    const modal = document.getElementById('modal-player');
    const video = document.getElementById('main-player');
    video.onerror = null;
    video.pause();
    video.removeAttribute('src'); 
    video.load();
    modal.style.display = 'none';
}

// ==========================================
// 5. ACTIONS
// ==========================================

function convertVideo(id) {
    if(!confirm("Convert video agar support browser & YouTube?\n(Menggunakan CPU VPS)")) return;
    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "Converting...";
    btn.disabled = true;

    fetch(`/api/videos/${id}/convert`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if(data.error) {
                alert("Gagal: " + data.error);
                btn.innerText = originalText;
                btn.disabled = false;
            } else {
                alert("Berhasil! Video telah diperbaiki.");
                loadVideos(); 
            }
        })
        .catch(err => {
            alert("Error koneksi");
            btn.innerText = originalText;
            btn.disabled = false;
        });
}

function uploadVideo(input) {
    if(!input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('video', file);

    const container = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    container.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.innerText = '0%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos/upload', true);

    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            const percent = (e.loaded / e.total) * 100;
            progressBar.style.width = percent + '%';
            progressText.innerText = Math.round(percent) + '%';
        }
    };

    xhr.onload = function() {
        if (xhr.status == 200) {
            alert('Upload Berhasil!');
            container.style.display = 'none';
            input.value = ''; 
            loadVideos();
        } else {
            alert('Upload Gagal');
            container.style.display = 'none';
        }
    };
    xhr.send(formData);
}

function importVideo(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-import');
    const loading = document.getElementById('import-loading');
    btn.disabled = true;
    loading.style.display = 'block';

    const data = Object.fromEntries(new FormData(e.target).entries());
    fetch('/api/videos/import', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(result => {
        btn.disabled = false;
        loading.style.display = 'none';
        if(result.error) alert("Gagal: " + result.error);
        else {
            alert("Import Berhasil!");
            closeModal('modal-import');
            e.target.reset(); 
            loadVideos();
        }
    });
}

function deleteVideo(id) { if(confirm("Hapus video?")) fetch(`/api/videos/${id}`, {method:'DELETE'}).then(()=>loadVideos()); }
function renameVideo(id, t) { const n=prompt("Judul baru:",t); if(n) fetch(`/api/videos/${id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:n})}).then(()=>loadVideos()); }

function openModal(id) { document.getElementById(id).style.display = 'block'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
window.onclick = function(event) { if (event.target.classList.contains('modal') && event.target.id !== 'modal-player') event.target.style.display = "none"; }

document.addEventListener('DOMContentLoaded', () => {
    loadVideos();
    loadStreams();
    setInterval(loadStreams, 5000);
});
