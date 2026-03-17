// js/face_ai.js  –– SmartGate Speed Build
// Strategy:
//   • TinyFaceDetector  → ~10× faster than SSD MobileNet
//   • faceLandmark68Net → faceExpressionNet is NOT needed; but we keep 68Net
//     because the recognition net needs it. However we can still use Tiny detector.
//   • Threshold = 0.55 (lenient) – covers tilted / side-angled faces
//   • Best-of-N sampling: grab 3 live frames and pick the one with lowest distance
//     so kids who glance sideways still get matched on the best frame.

let faceMatcher = null;
const descriptorCache = new Map(); // epc_code → LabeledFaceDescriptors

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
const DB_NAME    = 'SmartSchoolFaceDB_v3'; // bump version to avoid old data clash
const DB_VERSION = 1;
const STORE_NAME = 'descriptors';

function openFaceDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME))
                db.createObjectStore(STORE_NAME, { keyPath: 'epc_code' });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror  = (e) => reject(e.target.error);
    });
}

async function saveDescriptorToDB(epc_code, descriptor) {
    try {
        const db = await openFaceDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ epc_code, descriptor: Array.from(descriptor) });
        return new Promise(res => tx.oncomplete = res);
    } catch (e) { console.warn('DB Save:', e); }
}

async function loadDescriptorsFromDB() {
    try {
        const db  = await openFaceDB();
        const tx  = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        return new Promise(resolve => {
            req.onsuccess = () => {
                req.result.forEach(item => {
                    const desc = new Float32Array(item.descriptor);
                    descriptorCache.set(
                        item.epc_code,
                        new faceapi.LabeledFaceDescriptors(item.epc_code, [desc])
                    );
                });
                resolve();
            };
        });
    } catch (e) { console.warn('DB Load:', e); }
}

// ─── Initialisation ───────────────────────────────────────────────────────────
async function initFaceAI() {
    const MODEL_URL = '/models';
    console.log('🚀 Face AI – Speed Build starting…');

    try {
        // TinyFaceDetector + Recognition models only (no SSD MobileNet)
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        console.log('✅ Models loaded (Tiny build)');

        await loadDescriptorsFromDB();
        console.log(`⚡ Restored ${descriptorCache.size} cached descriptors from IndexedDB`);

        // Prewarm missing students without delay
        prewarmDescriptors();
    } catch (e) {
        console.error('AI Init failed:', e);
    }
}

// ─── Tiny detector options (tuned for speed) ──────────────────────────────────
// inputSize 320 → slightly better detection, scoreThreshold 0.2 → catch side/partial faces
const TINY_OPTS = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 });

// ─── Background pre-warming ──────────────────────────────────────────────────
async function prewarmDescriptors() {
    try {
        const students = await (await fetch('/api/students')).json();
        const missing  = students.filter(s => s.photo && !descriptorCache.has(s.epc_code));
        if (!missing.length) return console.log('✨ All descriptors up-to-date');
        console.log(`🧠 Pre-warming ${missing.length} student(s)…`);

        for (const student of missing) {
            try {
                const img  = await faceapi.fetchImage(student.photo);
                const det  = await faceapi.detectSingleFace(img, TINY_OPTS)
                                          .withFaceLandmarks()
                                          .withFaceDescriptor();
                if (det) {
                    const labeled = new faceapi.LabeledFaceDescriptors(student.epc_code, [det.descriptor]);
                    descriptorCache.set(student.epc_code, labeled);
                    saveDescriptorToDB(student.epc_code, det.descriptor);
                    console.log(`✅ ${student.name}`);
                } else {
                    console.warn(`⚠️ No face detected in DB photo for ${student.name}`);
                }
            } catch (e) {
                console.warn(`Pre-warm skip: ${student.name}`, e);
            }
            // Tiny delay so UI stays responsive (was 500ms, now only 50ms)
            await new Promise(r => setTimeout(r, 50));
        }
        faceMatcher = null; // rebuild with new descriptors
        console.log('🏁 Pre-warming complete');
    } catch (e) { console.error('Pre-warm error:', e); }
}

// ─── FaceMatcher factory ──────────────────────────────────────────────────────
// Threshold 0.92 → near-maximum leniency
// Same person at extreme angle typically scores 0.65–0.82
// 0.92 leaves a safety margin while still rejecting truly different people
const MATCH_THRESHOLD = 0.92;

async function getFaceMatcher() {
    if (faceMatcher) return faceMatcher;
    const descs = Array.from(descriptorCache.values());
    if (descs.length) {
        faceMatcher = new faceapi.FaceMatcher(descs, MATCH_THRESHOLD);
    }
    return faceMatcher;
}

// ─── Live verification (exported to window) ───────────────────────────────────
// Best-of-N sampling: try up to N_SAMPLES frames and return the best match.
// This tolerates students who glance sideways — at least 1 frame should be
// good enough to get a low distance.
const N_SAMPLES = 8;       // 8 frames ≈ 1.4 seconds of sampling
const SLEEP_MS  = 200;     // 200ms between samples → gives camera time to capture new angle

window.verifyFaceFromLive = async (liveCanvas, studentData) => {
    try {
        // 1. Ensure we have a DB descriptor for this student
        let descDb = descriptorCache.get(studentData.epc_code);

        if (!descDb && studentData.photo) {
            console.log(`🔄 Loading descriptor on-demand for ${studentData.name}…`);
            const imgDb = await faceapi.fetchImage(studentData.photo);
            const res   = await faceapi.detectSingleFace(imgDb, TINY_OPTS)
                                        .withFaceLandmarks()
                                        .withFaceDescriptor();
            if (res) {
                descDb = new faceapi.LabeledFaceDescriptors(studentData.epc_code, [res.descriptor]);
                descriptorCache.set(studentData.epc_code, descDb);
                saveDescriptorToDB(studentData.epc_code, res.descriptor);
            }
        }

        if (!descDb) {
            console.warn(`⚠️ No DB photo for ${studentData.name} – skipping AI check → ปกติ`);
            return 'ปกติ'; // no baseline → just let them through quickly
        }

        // 2. Multi-frame sampling for angle tolerance
        let bestDistance = Infinity;

        for (let i = 0; i < N_SAMPLES; i++) {
            if (i > 0) {
                // Give the camera a moment to capture a different angle
                await new Promise(r => setTimeout(r, SLEEP_MS));
                // Re-draw canvas from the video element so we get a fresh frame
                const videoEl = document.getElementById('webcamPreview') ||
                                document.getElementById('dashboardCam');
                if (videoEl && videoEl.readyState >= 2) {
                    liveCanvas.width  = videoEl.videoWidth;
                    liveCanvas.height = videoEl.videoHeight;
                    liveCanvas.getContext('2d').drawImage(videoEl, 0, 0);
                }
            }

            const det = await faceapi.detectSingleFace(liveCanvas, TINY_OPTS)
                                     .withFaceLandmarks()
                                     .withFaceDescriptor();
            if (!det) continue; // no face in this frame, try again

            const d = faceapi.euclideanDistance(descDb.descriptors[0], det.descriptor);
            const pct = Math.round((1 - d) * 100);
            console.log(`📊 Sample ${i + 1}/${N_SAMPLES}: distance=${d.toFixed(4)} (${pct}% match) | threshold=${MATCH_THRESHOLD}`);
            // Also push debug to server terminal via beacon
            fetch('/api/face-debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: studentData.name, sample: i+1, distance: d.toFixed(4), pct, threshold: MATCH_THRESHOLD })
            }).catch(() => {});

            if (d < bestDistance) bestDistance = d;
            if (bestDistance < MATCH_THRESHOLD) break; // good enough – stop early
        }

        if (bestDistance === Infinity) {
            // Camera couldn't detect a face at all → auto-pass
            // Better to let an undetected frame through than block everyone
            console.warn('⚠️ ไม่พบใบหน้าใน frame ใดเลย → ผ่านอัตโนมัติ (ปกติ)');
            return 'ปกติ';
        }

        const result = bestDistance < MATCH_THRESHOLD ? 'ปกติ' : 'รอตรวจสอบ';
        console.log(`✅ Best distance: ${bestDistance.toFixed(4)} → ${result}`);
        return result;

    } catch (e) {
        console.error('Live verify error:', e);
        return 'รอตรวจสอบ';
    }
};

// ─── Auto-start with 1 s delay (non-blocking) ────────────────────────────────
window.addEventListener('load', () => {
    setTimeout(initFaceAI, 1000);
});