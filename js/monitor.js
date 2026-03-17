// js/monitor.js
let video = document.getElementById('webcam');
let statusDot = document.getElementById('statusDot');
let statusText = document.getElementById('statusText');
let aiLoader = document.getElementById('aiLoader');

async function startMonitor() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720, facingMode: 'user' } 
        });
        video.srcObject = stream;
        
        // Face AI is initialized via face_ai.js which is deferred/delayed
        // But in monitor mode, we want it ASAP.
        // face_ai.js has a 5s delay by default. Let's override or trigger it.
        console.log("🖥️ Monitor Mode: Prioritizing AI Engine...");
        
        // Wait for faceapi to be available (from CDN script)
        const checkFaceAPI = setInterval(() => {
            if (window.faceapi && window.initFaceAI) {
                clearInterval(checkFaceAPI);
                initFaceAI().then(() => {
                    aiLoader.style.opacity = '0';
                    setTimeout(() => aiLoader.classList.add('hidden'), 1000);
                    updateStatus('Ready', 'bg-emerald-500');
                    startDetectionLoop();
                });
            }
        }, 500);

    } catch (err) {
        console.error("Camera Error:", err);
        updateStatus('Camera Error', 'bg-rose-500');
    }
}

function updateStatus(text, colorClass) {
    statusText.innerText = text;
    statusDot.className = `status-dot ${colorClass} ${text === 'Ready' ? '' : 'animate-pulse'}`;
}

async function startDetectionLoop() {
    // This loop will run recognition
    setInterval(async () => {
        if (video.paused || video.ended) return;
        
        // We only trigger verification if something happens? 
        // Actually, the server handles the CARD scan, and we broadcast the event.
        // So the monitor should LISTEN for card scans.
    }, 1000);
}

// Listen for card scans to trigger AI verification
const eventSource = new EventSource('/api/events');
eventSource.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'verify_face') {
        updateStatus('Verifying...', 'bg-blue-500 text-white');
        
        // Create canvas for recognition
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        
        // Verify via face_ai.js
        const result = await window.verifyFaceFromLive(canvas, data.student);
        
        // Send result back to server
        await fetch('/api/confirm-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                epc_code: data.student.epc_code, // Use the EPC from the student data
                attendance_id: data.student.attendance_id, // CRITICAL: Target the specific record
                status: result,
                captured_image: canvas.toDataURL('image/jpeg', 0.8)
            })
        });

        if (result === 'ปกติ') {
            showScanSuccess(data.student);
        }
        
        updateStatus('Ready', 'bg-emerald-500');
    }
};

function showScanSuccess(student) {
    const overlay = document.getElementById('scanOverlay');
    document.getElementById('scanName').innerText = student.name;
    document.getElementById('scanPhoto').src = student.photo || '';
    
    overlay.classList.remove('translate-x-80');
    setTimeout(() => overlay.classList.add('translate-x-80'), 4000);
}

window.addEventListener('load', startMonitor);
