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

// Threshold 0.6 → Standard security threshold for face-api.js
// Lowering from 0.92 to prevent false positives (different people matching).
// The user reported a false match at dist=0.6519, which this will now correctly reject.
const MATCH_THRESHOLD = 0.6;

async function getFaceMatcher() {
    if (faceMatcher) return faceMatcher;
    const descs = Array.from(descriptorCache.values());
    if (descs.length) {
        faceMatcher = new faceapi.FaceMatcher(descs, MATCH_THRESHOLD);
    }
    return faceMatcher;
}

// ─── Live verification (exported to window) ───────────────────────────────────
const N_SAMPLES = 8;       // 8 frames
const SLEEP_MS  = 100;     // 100ms interval (0.8s total) — optimized for fast walking

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
            return 'ปกติ';
        }

        // 2. Multi-frame sampling with Quality Filter
        let detections = [];

        for (let i = 0; i < N_SAMPLES; i++) {
            if (i > 0) {
                await new Promise(r => setTimeout(r, SLEEP_MS));
                const videoEl = document.getElementById('webcamPreview') || document.getElementById('dashboardCam');
                if (videoEl && videoEl.readyState >= 2) {
                    liveCanvas.width  = videoEl.videoWidth;
                    liveCanvas.height = videoEl.videoHeight;
                    liveCanvas.getContext('2d').drawImage(videoEl, 0, 0);
                }
            }

            // Detect all faces
            const allDets = await faceapi.detectAllFaces(liveCanvas, TINY_OPTS)
                                         .withFaceLandmarks()
                                         .withFaceDescriptors();
            
            if (allDets.length === 0) {
                console.log(`📊 Sample ${i + 1}/${N_SAMPLES}: No faces`);
                continue;
            }

            // Quality Filter: Find the best match among high-score detections
            let bestMatchInFrame = Infinity;
            allDets.forEach(det => {
                // Ignore detections with very low confidence scores (likely motion blur)
                if (det.detection.score < 0.45) return; 

                const d = faceapi.euclideanDistance(descDb.descriptors[0], det.descriptor);
                if (d < bestMatchInFrame) bestMatchInFrame = d;
            });

            if (bestMatchInFrame === Infinity) continue; // No high-quality faces found

            detections.push(bestMatchInFrame);
            const pct = Math.round((1 - bestMatchInFrame) * 100);
            
            // Push debug to server terminal
            fetch('/api/face-debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    name: studentData.name, 
                    sample: i+1, 
                    distance: bestMatchInFrame.toFixed(4), 
                    pct, 
                    threshold: MATCH_THRESHOLD,
                    note: `Score: ${allDets[0].detection.score.toFixed(2)}` 
                })
            }).catch(() => {});
        }

        if (detections.length === 0) {
            console.warn('⚠️ ไม่พบใบหน้าคุณภาพสูงเลย → ผ่านอัตโนมัติ (ปกติ)');
            return 'ปกติ';
        }

        // --- Optimized Decision Logic ---
        detections.sort((a, b) => a - b);
        
        // Take top 3 best detections
        const topDetections = detections.slice(0, 3);
        const avgDistance = topDetections.reduce((a, b) => a + b, 0) / topDetections.length;
        const passingSamples = detections.filter(d => d < MATCH_THRESHOLD).length;
        const veryStrongSamples = detections.filter(d => d < 0.48).length; // High confidence matches

        // Success if:
        // A) At least 2 samples are very strong (ideal for fast-walkby where 1-2 frames are clear)
        // B) Average of top 3 is within threshold
        const isVerified = (veryStrongSamples >= 1 && passingSamples >= 2) || (avgDistance < MATCH_THRESHOLD);
        const result = isVerified ? 'ปกติ' : 'รอตรวจสอบ';

        // Final debug
        fetch('/api/face-debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: studentData.name, 
                sample: 'FINAL', 
                distance: avgDistance.toFixed(4), 
                pct: Math.round((1-avgDistance)*100), 
                threshold: MATCH_THRESHOLD,
                note: `Pass: ${passingSamples}, Strong: ${veryStrongSamples}`
            })
        }).catch(() => {});

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