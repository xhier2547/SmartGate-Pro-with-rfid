// js/main.js
let currentVerifyEpc = '', currentVerifySid = '', currentAttendanceId = '';

const dashVideo = document.getElementById('dashboardCam');
const dashCanvas = document.getElementById('dashboardCanvas');

// --- 2. SSE Logic ---
const evtSource = new EventSource('/api/events');

evtSource.onmessage = function (event) {
    const data = JSON.parse(event.data);
    console.log("📡 SSE Received:", data);

    if (data.type === 'refresh') {
        if (window.updateDashboard) window.updateDashboard();
        if (document.getElementById('pendingVerifyModal') && !document.getElementById('pendingVerifyModal').classList.contains('hidden')) {
            openPendingVerifyModal(); // Refresh the list if open
        }
    }
    else if (data.type === 'unknown_card') {
        currentUnknownEpc = data.epc_code;
        if (document.getElementById('unknownEpcText')) document.getElementById('unknownEpcText').innerText = currentUnknownEpc;
        if (document.getElementById('unknownCardModal')) document.getElementById('unknownCardModal').classList.remove('hidden');
    }
    else if (data.type === 'verify_face') {
        handleRealTimeVerification(data.student);
    }
};

async function handleRealTimeVerification(student) {
    let scanPhotoBase64 = null;
    // Prefer visible preview for capture as some browsers don't render hidden videos
    const activeVideo = document.getElementById('webcamPreview') || dashVideo;
    
    if (activeVideo && activeVideo.readyState === 4) {
        dashCanvas.width = activeVideo.videoWidth;
        dashCanvas.height = activeVideo.videoHeight;
        const ctx = dashCanvas.getContext('2d');
        ctx.drawImage(activeVideo, 0, 0, dashCanvas.width, dashCanvas.height);
        scanPhotoBase64 = dashCanvas.toDataURL('image/jpeg', 0.8);
    }

    let finalStatus = 'รอตรวจสอบ';
    if (window.verifyFaceFromLive && scanPhotoBase64) {
        finalStatus = await window.verifyFaceFromLive(dashCanvas, student);
    }

    // Auto-confirm if logic allows, otherwise stays 'รอตรวจสอบ'
    fetch('/api/confirm-checkin', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
            student_id: student.student_id,
            epc_code: student.epc_code, 
            attendance_id: student.attendance_id,
            status: finalStatus,
            scan_photo: scanPhotoBase64,
            date: student.scan_date,
            time: student.scan_time
        }) 
    }).then(() => { if (window.updateDashboard) window.updateDashboard(); });
}

async function startDashboardWebcam() {
    const camDot = document.getElementById('camStatusDot');
    const camText = document.getElementById('camStatusText');
    const syncDot = document.getElementById('syncStatusDot');
    const previewVid = document.getElementById('webcamPreview');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (dashVideo) dashVideo.srcObject = stream;
        if (previewVid) previewVid.srcObject = stream;
        
        // Update UI to Green (Active)
        if (camDot) {
            camDot.classList.remove('bg-amber-500', 'bg-rose-500');
            camDot.classList.add('bg-emerald-500');
        }
        if (camText) camText.innerText = 'Camera Live';
        if (syncDot) {
            syncDot.classList.remove('bg-rose-500');
            syncDot.classList.add('bg-emerald-400');
        }
        console.log("🎬 Camera Stream Started Successfully");
    } catch (e) {
        console.warn("Webcam access denied or not available", e);
        // Update UI to Red (Error)
        if (camDot) {
            camDot.classList.remove('bg-amber-500', 'bg-emerald-500');
            camDot.classList.add('bg-rose-500');
        }
        if (camText) camText.innerText = 'Camera Error';
        if (syncDot) {
            syncDot.classList.remove('bg-cyan-400', 'bg-emerald-400');
            syncDot.classList.add('bg-rose-500');
        }
    }
}

// --- 3. Management UI Logic ---

// Pending Verifications
window.openPendingVerifyModal = async function() {
    const logs = await (await fetch('/api/logs')).json();
    const pending = logs.filter(l => l.status === 'รอตรวจสอบ');
    const container = document.getElementById('pendingVerifyList');
    
    if (pending.length === 0) {
        container.innerHTML = '<div class="text-center py-10 text-slate-600 font-bold uppercase text-[10px] tracking-widest">No pending verifications</div>';
    } else {
        container.innerHTML = pending.map(l => `
            <div class="flex justify-between items-center p-5 bg-white/5 hover:bg-white/[0.08] rounded-3xl border border-white/5 transition-all group">
                <div class="flex items-center gap-6 flex-1 cursor-pointer" onclick="openVerifyReview('${l.epc_code}', '${l.id}')">
                    <img class="w-16 h-16 rounded-2xl object-cover bg-slate-800 border border-white/10" src="${l.photo || ''}">
                    <div>
                        <div class="text-white font-black text-lg">${l.name}</div>
                        <div class="text-xs text-slate-500 font-bold uppercase tracking-wider">${l.class_room} • <span class="text-amber-500">${l.time}</span></div>
                        <div class="text-[9px] text-slate-600 font-mono mt-1">${l.epc_code}</div>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <button onclick="handleQuickApprove('${l.id}')" class="px-6 py-3 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-emerald-500/20">
                        Quick Approve
                    </button>
                    <button onclick="openVerifyReview('${l.epc_code}', '${l.id}')" class="px-6 py-3 bg-white/5 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all border border-white/5">
                        Review →
                    </button>
                </div>
            </div>
        `).join('');
    }
    document.getElementById('pendingVerifyModal').classList.remove('hidden');
};

window.handleQuickApprove = async function(id) {
    try {
        const res = await fetch('/api/confirm-checkin', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ attendance_id: id, status: 'ปกติ' }) 
        }).then(r => r.json());
        
        if (res.success) {
            if (window.updateDashboard) window.updateDashboard();
            openPendingVerifyModal(); // Refresh list
        }
    } catch (e) { console.error(e); }
};

window.closePendingVerifyModal = function() {
    document.getElementById('pendingVerifyModal').classList.add('hidden');
};

window.openVerifyReview = async function(epc, attendance_id) {
    currentAttendanceId = attendance_id;
    const logs = await (await fetch('/api/logs')).json();
    const record = logs.find(l => l.id == attendance_id);
    
    if (!record) return;

    document.getElementById('verifyName').innerText = record.name;
    document.getElementById('verifyDbPhoto').src = record.photo || '';
    // Use the saved scan photo if available, or fall back to a placeholder
    document.getElementById('verifyLivePhoto').src = `/photos/scan_${epc}.jpg?t=${Date.now()}`;
    
    document.getElementById('btnConfirmFace').onclick = () => confirmFaceManual(attendance_id);
    
    document.getElementById('verifyFaceModal').classList.remove('hidden');
};

async function confirmFaceManual(id) {
    try {
        const res = await fetch('/api/confirm-checkin', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ attendance_id: id, status: 'ปกติ' }) 
        }).then(r => r.json());
        
        if (res.success) {
            document.getElementById('verifyFaceModal').classList.add('hidden');
            if (window.updateDashboard) window.updateDashboard();
            openPendingVerifyModal(); // Refresh list
        }
    } catch (e) { console.error(e); }
}

window.rejectFace = function() {
    document.getElementById('verifyFaceModal').classList.add('hidden');
};

// ลบ attendance record โดยไม่แจ้ง LINE
window.deleteAttendanceRecord = async function() {
    if (!currentAttendanceId) return;
    if (!confirm('ลบรายการนี้ออกจากระบบ? (ไม่มีการแจ้ง LINE)')) return;
    try {
        const res = await fetch(`/api/delete-attendance/${currentAttendanceId}`, {
            method: 'DELETE'
        }).then(r => r.json());
        if (res.success) {
            document.getElementById('verifyFaceModal').classList.add('hidden');
            if (window.updateDashboard) window.updateDashboard();
        } else {
            alert('เกิดข้อผิดพลาด: ' + res.message);
        }
    } catch (e) { console.error(e); }
};

// Original Modal Logic
window.openStudentDetail = function(sn) {
    if (typeof allLogs === 'undefined') return;
    const allStudentLogs = allLogs.filter(l => l.name === sn);
    const checkinLogs = allStudentLogs.filter(l => l.type === 'เข้า');
    const norm = checkinLogs.filter(l => l.status === 'ปกติ').length;
    const late = checkinLogs.filter(l => l.status === 'สาย').length;

    document.getElementById('modalName').innerText = sn; 
    document.getElementById('modalClass').innerText = allStudentLogs[0]?.class_room || '-';
    document.getElementById('modalPhoto').src = allStudentLogs[0]?.photo || '';
    document.getElementById('modalNormalCount').innerText = norm; 
    document.getElementById('modalLateCount').innerText = late;
    document.getElementById('modalForgotCount').innerText = allStudentLogs[0]?.forgot_count || 0;
    
    document.getElementById('modalLogList').innerHTML = allStudentLogs.slice(-10).reverse().map(l => `
        <div class="flex justify-between items-center px-5 py-4 bg-slate-800/40 hover:bg-slate-800 rounded-3xl border border-white/5 mb-3 transition-all">
            <div class="flex items-center gap-4">
                <div class="flex flex-col">
                    <span class="text-white font-mono font-black text-sm">${l.time}</span>
                    <span class="text-[9px] text-slate-500 font-bold uppercase">${l.date}</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[9px] font-black tracking-widest uppercase ${l.type === 'ออก' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}">
                    ${l.type === 'ออก' ? 'OUT' : 'IN'}
                </span>
            </div>
            <span class="font-black text-xs uppercase ${l.type === 'ออก' ? 'text-slate-600' : (l.status === 'สาย' ? 'text-rose-400' : 'text-emerald-400')}">
                ${l.type === 'ออก' ? '-' : (l.status || 'ปกติ')}
            </span>
        </div>`).join('');

    const ctx = document.getElementById('studentHistoryChart').getContext('2d');
    if (window.studentHistoryChartInstance) window.studentHistoryChartInstance.destroy();
    window.studentHistoryChartInstance = new Chart(ctx, { type: 'bar', data: { labels: ['มาปกติ', 'มาสาย'], datasets: [{ data: [norm, late], backgroundColor: ['#34d399', '#fb7185'], borderRadius: 10 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } }, x: { grid: { display: false }, ticks: { color: '#94a3b8' } } } } });
    document.getElementById('studentModal').classList.remove('hidden');
};

// Existing Logic
window.updateClock = function() {
    const clockEl = document.getElementById('currentTime');
    const dateEl = document.getElementById('currentDate');
    if (!clockEl || !dateEl) return;
    const now = new Date();
    dateEl.innerText = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'long' });
    clockEl.innerText = now.toLocaleTimeString('th-TH');
};

window.fetchWeather = async function() {
    try {
        const data = await API.getWeather();
        const isRaining = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(data.current_weather.weathercode);
        if (document.getElementById('weatherIcon')) document.getElementById('weatherIcon').innerText = isRaining ? '🌧️' : '☀️';
        if (document.getElementById('weatherText')) document.getElementById('weatherText').innerText = `${isRaining ? 'ฝนตก' : 'แจ่มใส'} ${data.current_weather.temperature}°C (ม.อ.)`;
    } catch (e) { if (document.getElementById('weatherText')) document.getElementById('weatherText').innerText = "OFFLINE"; }
};

window.manualCheckin = async function() {
    const sid = document.getElementById('manualStudentId').value;
    if (!sid) return alert("กรุณากรอกรหัสนักเรียน");
    try {
        const res = await API.manualIn(sid);
        alert(res.message);
        document.getElementById('manualStudentId').value = '';
        if (window.updateDashboard) window.updateDashboard();
    } catch (e) { alert('เชื่อมต่อเซิร์ฟเวอร์ผิดพลาด'); }
};


// Initialization
function initApp() {
    updateClock();
    startDashboardWebcam();
    if (window.updateDashboard) window.updateDashboard();
    
    // Non-blocking deferred tasks
    setTimeout(() => {
        window.fetchWeather();
        setInterval(window.updateClock, 1000);
        setInterval(window.fetchWeather, 600000);
        setInterval(() => { if (window.updateDashboard) window.updateDashboard(); }, 20000);
    }, 2000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Event Listeners for filters
['levelFilter', 'gradeFilter', 'roomFilter', 'dateFilter', 'searchInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { if (window.updateDashboard) window.updateDashboard(); });
});

// Helper for unknown cards
window.closeUnknownCardModal = () => document.getElementById('unknownCardModal').classList.add('hidden');
window.goToRegister = () => window.location.href = `/register?epc=${currentUnknownEpc}`;
window.closeModal = () => document.getElementById('studentModal').classList.add('hidden');
window.closeAIModal = () => document.getElementById('aiModal').classList.add('hidden');