const { exec } = require('child_process');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const mqtt = require('mqtt');
const cron = require('node-cron');
const { SerialPort } = require('serialport');
require('dotenv').config();  // ← โหลด .env

const app = express();
app.use('/js', express.static(path.join(__dirname, 'js'), { maxAge: 0 }));

// --- Update Photo from Scan ---
app.post('/api/manage/update-photo-from-scan', (req, res) => {
    const { student_id, epc_code } = req.body;
    if (!student_id && !epc_code) return res.status(400).json({ success: false, message: "Missing ID or EPC" });
    const epc = epc_code || "";
    const scanPath = path.join(__dirname, 'public', 'photos', `scan_${epc}.jpg`);
    const newProfileName = `profile_${Date.now()}.jpg`;
    const profilePath = path.join(__dirname, 'public', 'photos', newProfileName);
    if (!fs.existsSync(scanPath)) return res.status(404).json({ success: false, message: "ไม่พบรูปภาพจากการสแกนล่าสุด" });
    try {
        fs.copyFileSync(scanPath, profilePath);
        db.run("UPDATE students SET photo = ? WHERE student_id = ? OR epc_code = ?", [newProfileName, student_id, epc], (err) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            console.log(`📸 Updated profile photo for ${student_id || epc} using latest scan.`);
            res.json({ success: true, message: "อัปเดตรูปภาพโปรไฟล์สำเร็จ! ข้อมูล AI จะแม่นยำขึ้นในครั้งถัดไป" });
        });
    } catch (e) { res.status(500).json({ success: false, message: "Error updating photo: " + e.message }); }
});
app.use('/models', express.static(path.join(__dirname, 'models'), { maxAge: '1d' }));
app.use('/css', express.static(path.join(__dirname, 'css'), { maxAge: '1d' }));
app.use('/photos', express.static(path.join(__dirname, 'public', 'photos'), { maxAge: '1d' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const db = new sqlite3.Database('./database/school.db');
const SECRET_KEY = process.env.SECRET_KEY || "SmartGatePro_Secret_Key_2026_fallback";
// --- ค่าตั้งต้น (ถ้า DB ไม่มีข้อมูล) ---
const DEFAULT_LATE_TIME = process.env.DEFAULT_LATE_TIME || "08:30";
const DEFAULT_LINE_TOKEN = process.env.LINE_TOKEN || "";       // ← ใส่ใน .env
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || ""; // ← ใส่ใน .env
const LINE_API_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_API_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';


// Helper: เขียนลงไฟล์ CSV สำรองอัตโนมัติ
const csvLogPath = path.join(__dirname, 'data', 'attendance_log.csv');
function appendToCSV(date, time, type, student_id, epc_code, name, class_room, status) {
    // ลบเครื่องหมายคำพูด (quotes) ในชื่อเผื่อไว้
    const safeName = name ? name.replace(/"/g, '""') : '';
    const safeClass = class_room ? class_room.replace(/"/g, '""') : '';
    const row = `"${date}","${time}","${type}","${student_id}","${epc_code}","${safeName}","${safeClass}","${status}"\n`;
    fs.appendFile(csvLogPath, row, (err) => {
        if (err) console.error("Error writing to CSV:", err);
    });
}

// Auto-create directories if they do not exist
const photosDir = path.join(__dirname, 'public', 'photos');
if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
}

db.serialize(() => {
    db.run(`PRAGMA journal_mode=WAL;`);
    db.run(`CREATE TABLE IF NOT EXISTS students (epc_code TEXT PRIMARY KEY, student_id TEXT, name TEXT, class_year TEXT, room TEXT, level TEXT, forgot_count INTEGER DEFAULT 0, score INTEGER DEFAULT 100, photo TEXT, parent_name TEXT, parent_phone TEXT)`);

    // --- Database Migration: Add parent info columns if they don't exist ---
    const addColumnIfNotExists = (table, col, type) => {
        db.get(`PRAGMA table_info(${table})`, (err, rows) => {
            // PRAGMA table_info returns multiple rows, sqlite3 .get only returns first. Use .all.
        });
        db.all(`PRAGMA table_info(${table})`, (err, rows) => {
            if (rows && !rows.find(r => r.name === col)) {
                db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
                console.log(`Migrated database: Added ${col} to ${table}`);
            }
        });
    };
    addColumnIfNotExists('students', 'parent_name', 'TEXT');
    addColumnIfNotExists('students', 'parent_phone', 'TEXT');

    db.run(`CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, epc_code TEXT, date TEXT, time TEXT, type TEXT, status TEXT, FOREIGN KEY(epc_code) REFERENCES students(epc_code))`);
    db.run(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT, role TEXT)`);
    db.run(`INSERT OR IGNORE INTO users VALUES ('admin', 'password123', 'admin')`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_epc ON attendance(epc_code, date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_students_id ON students(student_id)`);

    // --- โต๊ะย่อยสำหรับการแจ้งเตือนผู้ปกครอง (Individual LINE Tokens) ---
    db.run(`CREATE TABLE IF NOT EXISTS parent_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT,
        line_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, line_token),
        FOREIGN KEY(student_id) REFERENCES students(student_id)
    )`);

    // --- Cleanup: Remove duplicate subscriptions if any exist ---
    db.run(`DELETE FROM parent_subscriptions WHERE id NOT IN (SELECT MIN(id) FROM parent_subscriptions GROUP BY student_id, line_token)`);
});

// --- LINE Webhook สำหรับลงทะเบียนอัตโนมัติ ---
app.post('/api/webhook', (req, res) => {
    console.log("📩 Webhook Hit!");
    const events = req.body.events;
    if (!events || events.length === 0) return res.send("OK");

    events.forEach(async (event) => {
        const userId = event.source.userId;
        const replyToken = event.replyToken;

        if (event.type === 'follow') {
            replyLine(replyToken, "👋 สวัสดีครับ! ยินดีต้อนรับสู่ระบบแจ้งเตือน Smart School Pro\n\n📌 กรุณาพิมพ์ 'รหัสนักเรียน 10 หลัก' เพื่อลงทะเบียนรับแจ้งเตือนอัตโนมัติครับ");
        }
        else if (event.type === 'message' && event.message.type === 'text') {
            const text = event.message.text.trim();
            if (/^\d{10}$/.test(text)) {
                db.get("SELECT name FROM students WHERE student_id = ?", [text], (err, student) => {
                    if (student) {
                        db.run("INSERT OR REPLACE INTO parent_subscriptions (student_id, line_token) VALUES (?, ?)", [text, userId], (err) => {
                            if (err) replyLine(replyToken, "❌ เกิดข้อผิดพลาด กรุณาลองใหม่ครับ");
                            else replyLine(replyToken, `✅ ลงทะเบียนสำเร็จ!\nคุณจะได้รับการแจ้งเตือนของ:\n ${student.name} (${text}) ครับ`);
                        });
                    } else {
                        replyLine(replyToken, `❌ ไม่พบรหัสนักเรียน "${text}" ในระบบครับ`);
                    }
                });
            } else {
                replyLine(replyToken, "📌 กรุณาพิมพ์เฉพาะ 'รหัสนักเรียน 10 หลัก' เพื่อลงทะเบียนครับ");
            }
        }
    });
    res.send("OK");
});

// --- Routes หน้าเว็บ ---
// ส่ง HTML โดยไม่ cache เพื่อให้ script tags อัปเดตทุกครั้ง
const sendNoCache = (file) => (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, 'views', file));
};
app.get('/', sendNoCache('index.html'));
app.get('/monitor', sendNoCache('monitor.html'));
app.get('/login', sendNoCache('login.html'));
app.get('/register', sendNoCache('register.html'));
app.get('/manage', sendNoCache('manage.html'));
app.get('/mismatch', sendNoCache('mismatch.html'));
app.get('/settings', sendNoCache('settings.html'));
app.get('/analytics', sendNoCache('analytics.html'));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'css', 'style.css')));

// API ระบบจัดการนักเรียน
app.get('/api/manage/students', (req, res) => {
    db.all(`SELECT * FROM students ORDER BY level DESC, class_year ASC, room ASC, name ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: rows });
    });
});

app.put('/api/manage/students/:epc_code', (req, res) => {
    const epc_code = req.params.epc_code;
    const { student_id, name, level, class_year, room, parent_name, parent_phone, photo } = req.body;

    let updatePhotoSql = "";
    let params = [student_id, name, level, class_year, room, parent_name || '', parent_phone || ''];

    // Handle Base64 photo if provided
    if (photo && photo.startsWith('data:image')) {
        const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
        const fileName = `${student_id || epc_code}_${Date.now()}.jpg`;
        const filePath = path.join(__dirname, 'public', 'photos', fileName);
        try {
            fs.writeFileSync(filePath, base64Data, 'base64');
            updatePhotoSql = ", photo=?";
            params.push(`/photos/${fileName}`);
        } catch (e) {
            console.error('Error saving updated image:', e);
        }
    }

    params.push(epc_code);
    db.run(
        `UPDATE students SET student_id=?, name=?, level=?, class_year=?, room=?, parent_name=?, parent_phone=? ${updatePhotoSql} WHERE epc_code=?`,
        params,
        function (err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: "อัปเดตข้อมูลสำเร็จ" });
        }
    );
});

app.delete('/api/manage/students/:epc_code', (req, res) => {
    const epc_code = req.params.epc_code;
    db.serialize(() => {
        db.run(`DELETE FROM students WHERE epc_code=?`, [epc_code]);
        db.run(`DELETE FROM attendance WHERE epc_code=?`, [epc_code], function (err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: "ลบข้อมูลนักเรียนและประวัติสำเร็จ" });
        });
    });
});

// API ดึงข้อมูลนักเรียนพร้อมรูปภาพ (สำหรับหน้า Mismatch)
app.get('/api/students', (req, res) => {
    db.all("SELECT epc_code, student_id, name, photo FROM students", [], (err, rows) => {
        if (err) return res.status(500).json([]);
        res.json(rows);
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (user) res.json({ success: true, token: jwt.sign({ username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '12h' }) });
        else res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
    });
});

// --- Bulk Import API ---
app.post('/api/manage/bulk-import', (req, res) => {
    const { students } = req.body;
    if (!students || !Array.isArray(students)) return res.json({ success: false, message: "ข้อมูลไม่ถูกต้อง" });

    db.serialize(() => {
        const stmt = db.prepare(`INSERT OR REPLACE INTO students (epc_code, student_id, name, class_year, room, level, photo) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        students.forEach(s => {
            // เช็คว่ามีรูปใน photos ไหม
            const photoPath = fs.existsSync(path.join(__dirname, 'public', 'photos', `${s.student_id}.jpg`)) ? `/photos/${s.student_id}.jpg` : '';
            stmt.run([s.epc_code, s.student_id, s.name, s.class_year || 1, s.room || 1, s.level || 'ป.', photoPath]);
        });
        stmt.finalize();
    });
    res.json({ success: true, message: `นำเข้าข้อมูลนักเรียน ${students.length} คนเรียบร้อย` });
});

app.post('/api/register', (req, res) => {
    const student = Array.isArray(req.body) ? req.body[0] : req.body;
    db.get(`SELECT name FROM students WHERE student_id = ?`, [student.student_id], (err, row) => {
        if (row) return res.status(400).json({ success: false, message: `รหัสนักเรียนนี้ถูกใช้ไปแล้วโดย: ${row.name}` });
        db.get(`SELECT name FROM students WHERE epc_code = ?`, [student.epc_code], (err, row2) => {
            if (row2) return res.status(400).json({ success: false, message: `บัตรใบนี้ถูกลงทะเบียนไปแล้วโดย: ${row2.name}` });

            let photoPath = '';
            if (student.photo && student.photo.startsWith('data:image')) {
                const base64Data = student.photo.replace(/^data:image\/\w+;base64,/, '');
                const fileName = `${student.student_id}.jpg`;
                const filePath = path.join(__dirname, 'public', 'photos', fileName);
                try {
                    fs.writeFileSync(filePath, base64Data, 'base64');
                    photoPath = `/photos/${fileName}`;
                } catch (e) {
                    console.error('Error saving image:', e);
                }
            }

            db.run(`INSERT INTO students (epc_code, student_id, name, class_year, room, level, photo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [student.epc_code, student.student_id, student.name, student.class_year, student.room, student.level, photoPath || ''],
                function (err) {
                    if (err) return res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดของฐานข้อมูล" });
                    res.json({ success: true, message: "บันทึกสำเร็จ" });
                });
        });
    });
});

// Real-time SSE
let clients = [];
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    clients.push(res);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
});
const broadcast = (data) => clients.forEach(c => c.write(`data: ${JSON.stringify(data)}\n\n`));

// จัดการการสแกนบัตร
const scanCache = new Map();
const pendingScans = new Set(); // ป้องกันการประมวลผลซ้อนกันในเสี้ยววินาที
const DEBOUNCE_TIME_MS = 10000; // 10 seconds

const processScan = (raw_epc) => {
    if (!raw_epc) return;
    const epc_code = raw_epc.trim().toUpperCase(); // ปรับให้เป็นตัวพิมพ์ใหญ่และตัดช่องว่าง
    const nowMs = Date.now();
    const dateStr = new Date().toLocaleDateString('en-CA');

    // 1. ระดับ Cache (กันสัญญาณรัวจาก Reader ในช่วง 10 วินาที)
    if (scanCache.has(epc_code) && (nowMs - scanCache.get(epc_code) < DEBOUNCE_TIME_MS)) {
        console.log(`⚠️ ป้องกันสแกนซ้ำ (Cache): ${epc_code}`);
        return;
    }

    // 1.1 ระดับ Memory Lock (กัน Race Condition ในระดับมิลลิวินาที)
    if (pendingScans.has(epc_code)) {
        console.log(`⏳ กำลังประมวลผลบัตรรอบก่อนหน้า: ${epc_code}`);
        return;
    }

    scanCache.set(epc_code, nowMs); // ล็อคทันที

    // 2. ระดับ Database (กันการเบิ้ลที่อาจหลุดจาก Cache)
    db.get(
        "SELECT time, type FROM attendance WHERE epc_code = ? AND date = ? ORDER BY id DESC LIMIT 1",
        [epc_code, dateStr],
        (err, lastLog) => {
            // NOTE: We moved the 1-minute guard into handleScanLogic for better context (type-aware debounce)
            console.log(`\n${'─'.repeat(50)}`);
            console.log(` สแกนบัตร: ${epc_code}`);
            handleScanLogic(epc_code);
        }
    );
};

const logTime = () => new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const handleScanLogic = (epc_code) => {
    pendingScans.add(epc_code); // เริ่ม Lock

    db.get(`SELECT * FROM students WHERE epc_code = ?`, [epc_code], (err, student) => {
        if (!student) {
            console.log(`⚠️  [${logTime()}] ไม่พบข้อมูลบัตร: ${epc_code} → แจ้งลงทะเบียน`);
            broadcast({ type: 'unknown_card', epc_code: epc_code });
            mqttFeedback('unknown'); // ❓ ไม่รู้จักบัตร → LED แดงกะพริบ
            pendingScans.delete(epc_code); // ปลด Lock
        } else {
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-CA');
            const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

            db.get("SELECT type, time FROM attendance WHERE epc_code = ? AND date = ? ORDER BY id DESC LIMIT 1", [epc_code, dateStr], (err, lastLog) => {
                if (err) {
                    console.error("Error checking last log:", err);
                    pendingScans.delete(epc_code);
                    return;
                }

                // 2.1 ป้องกันการสแกนซ้ำประเภทเดิม (เช่น เข้า แล้วเข้าซ้ำ) ภายใน 1 นาที
                const nextType = (lastLog && lastLog.type === 'เข้า') ? 'ออก' : 'เข้า';

                if (lastLog && lastLog.type === nextType) {
                    const [h, m] = lastLog.time.split(':').map(Number);
                    const lastTime = new Date();
                    lastTime.setHours(h, m, 0, 0);
                    const diffMs = now - lastTime;

                    // ถ้าเป็นประเภทเดียวกัน และสแกนภายใน 1 นาที สั่งข้าม (ยกเว้นข้ามวัน/ข้ามชั่วโมงที่ต่างกัน)
                    if (diffMs >= 0 && diffMs < 60000) {
                        console.log(`⏳ ข้ามการสแกน: ${epc_code} เพิ่งบันทึก "${lastLog.type}" ไปเมื่อไม่กี่วินาทีก่อน`);
                        pendingScans.delete(epc_code);
                        return;
                    }
                }
                const className = `${student.level}${student.class_year}/${student.room}`;
                console.log(`👤 [${logTime()}] ${student.name} (${className}) → ${nextType}`);

                // --- Fast Path for Checkout (ออก): No AI needed, confirm immediately ---
                if (nextType === 'ออก') {
                    db.run(
                        `INSERT INTO attendance (epc_code, date, time, type, status) VALUES (?, ?, ?, ?, ?)`,
                        [epc_code, dateStr, timeStr, 'ออก', 'ออก'],
                        function (err) {
                            pendingScans.delete(epc_code);
                            if (err) return console.error("บันทึกออกล้มเหลว:", err.message);
                            console.log(`✅ [${logTime()}] ${student.name} → บันทึกออกสำเร็จ (ไม่ต้องตรวจสอบใบหน้า)`);
                            mqttFeedback('checkout'); // ✅ ออก → LED เขียวสั้น
                            broadcast({ type: 'refresh' });
                            triggerCheckinNotifications(student, epc_code, timeStr, 'ออก', 'RFID', 'ออก');
                        }
                    );
                    return;
                }

                // --- Normal Path for Check-in (เข้า): Requires AI face verification ---
                console.log(`🔍 [${logTime()}] กำลังส่งให้ AI ตรวจสอบใบหน้า ${student.name}...`);
                db.run(
                    `INSERT INTO attendance (epc_code, date, time, type, status) VALUES (?, ?, ?, ?, ?)`,
                    [epc_code, dateStr, timeStr, nextType, 'รอตรวจสอบ'],
                    function (err) {
                        pendingScans.delete(epc_code);
                        if (err) {
                            console.error("บันทึกรอตรวจสอบล้มเหลว:", err.message);
                            return;
                        }
                        const insertId = this.lastID;
                        broadcast({ type: 'refresh' });
                        broadcast({
                            type: 'verify_face',
                            student: {
                                ...student,
                                attendance_id: insertId,
                                scan_date: dateStr,
                                scan_time: timeStr
                            }
                        });
                    }
                );
            });
        }
    });
};

// Debug: รับ distance log จาก browser AI พิมพ์ใน terminal
app.post('/api/face-debug', (req, res) => {
    const { name, sample, distance, pct, threshold, note } = req.body;

    if (sample === 'FINAL') {
        const pass = parseFloat(distance) < threshold ? '✅ PASS' : '❌ FAIL';
        console.log(`Final Decision: ${name} | AvgDist=${distance} | ${note} | ${pass}`);
        console.log(`${'─'.repeat(50)}`);
        return res.json({ ok: true });
    }

    const filled = Math.max(0, Math.round(pct / 5));
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    const pass = parseFloat(distance) < threshold ? '✅ PASS' : '❌ ยังไม่ผ่าน';
    console.log(`   Sample ${sample}: [${bar}] ${pct}% (dist=${distance}) ${pass}`);
    res.json({ ok: true });
});

// ลบ attendance record โดยไม่แจ้ง LINE (ใช้จาก modal ยืนยันหน้า)
app.delete('/api/delete-attendance/:id', (req, res) => {
    const id = req.params.id;
    db.get('SELECT a.id, s.name FROM attendance a LEFT JOIN students s ON a.epc_code = s.epc_code WHERE a.id = ?', [id], (err, row) => {
        if (err || !row) return res.json({ success: false, message: 'ไม่พบรายการ' });
        db.run('DELETE FROM attendance WHERE id = ?', [id], (err2) => {
            if (err2) return res.json({ success: false, message: err2.message });
            console.log(`🗑️  [${logTime()}] ลบรายการ ID=${id} (${row.name || 'ไม่ทราบ'}) → ไม่แจ้ง LINE`);
            broadcast({ type: 'refresh' });
            res.json({ success: true });
        });
    });
});

app.post('/api/confirm-checkin', (req, res) => {
    const { epc_code, status, scan_photo, captured_image, date, time, attendance_id } = req.body;
    const finalPhoto = scan_photo || captured_image;

    // คอนเฟิร์มโดยใช้ ID (แม่นยำที่สุด)
    if (attendance_id) {
        db.get(`SELECT id, epc_code, time, type FROM attendance WHERE id = ?`, [attendance_id], (err, row) => {
            if (err || !row) return res.json({ success: false, message: "ไม่พบรายการจาก ID ที่ระบุ" });
            processConfirmation(row, status, finalPhoto, res);
        });
    }
    // คอนเฟิร์มโดยใช้ EPC + Date + Time (แบบเดิมสำหรับหน้า Mismatch)
    else if (epc_code) {
        const dateStr = date || new Date().toLocaleDateString('en-CA');
        let query = `SELECT id, time, type FROM attendance WHERE epc_code = ? AND date = ? AND status = 'รอตรวจสอบ'`;
        let params = [epc_code, dateStr];
        if (time) { query += ` AND time = ?`; params.push(time); }
        query += ` ORDER BY id DESC LIMIT 1`;

        db.get(query, params, (err, row) => {
            if (err || !row) {
                // ถ้าไม่มี 'รอตรวจสอบ' ให้ลองหา 'ล่าสุด' (Fallback for monitor.html)
                db.get(`SELECT id, time, type FROM attendance WHERE epc_code = ? AND date = ? ORDER BY id DESC LIMIT 1`, [epc_code, dateStr], (err2, row2) => {
                    if (err2 || !row2) return res.json({ success: false, message: "ไม่พบรายการสแกน" });
                    processConfirmation(row2, status, finalPhoto, res, epc_code);
                });
                return;
            }
            processConfirmation(row, status, finalPhoto, res, epc_code);
        });
    } else {
        res.json({ success: false, message: "ขาดข้อมูลที่จำเป็น" });
    }
});

// แยก Logic การบันทึกออกมาเพื่อลดความซ้ำซ้อน

// Helper: ตอบกลับข้อความ LINE
async function replyLine(replyToken, message) {
    db.get("SELECT setting_value FROM settings WHERE setting_key = 'LINE_TOKEN'", [], async (err, row) => {
        const token = row ? row.setting_value : DEFAULT_LINE_TOKEN;
        if (!token || token === 'YOUR_LINE_TOKEN') return;
        try {
            await axios.post(LINE_API_REPLY_URL, {
                replyToken: replyToken,
                messages: [{ type: 'text', text: message }]
            }, {
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
            });
        } catch (e) {
            console.error("❌ Reply Line Failed:", e.response ? e.response.data : e.message);
        }
    });
}

// Helper: ส่งแจ้งเตือนเบื้องหลัง (ไม่ขวาง UI)
const triggerCheckinNotifications = (student, epc, time, status, method, attendanceType) => {
    setImmediate(() => {
        let prefix = 'เช็คอิน';
        if (attendanceType === 'เข้า') {
            prefix = status === 'สาย' ? 'เข้าเรียนสาย' : 'เข้าเรียน';
        } else if (attendanceType === 'ออก') {
            prefix = 'ออก';
        }

        let displayPrefix = prefix;
        if (method === 'แมนนวล') displayPrefix += ' (ลืมบัตร)';
        else if (method === 'Face ID') displayPrefix += ' (Face ID)';

        const msg = ` [${displayPrefix}] ${student ? student.name : epc}\nเวลา: ${time}\nสถานะ: ${status}`;

        db.get("SELECT setting_value FROM settings WHERE setting_key = 'LINE_TOKEN'", [], (err, tokenRow) => {
            const lineToken = tokenRow ? tokenRow.setting_value : DEFAULT_LINE_TOKEN;

            // 1. ส่งให้ผู้ปกครอง (Individual)
            if (student && student.student_id) {
                db.all("SELECT line_token FROM parent_subscriptions WHERE student_id = ?", [student.student_id], (err, subRows) => {
                    if (subRows) {
                        subRows.forEach(sub => sendLineNotification(lineToken, sub.line_token, msg));
                    }
                });
            }

            // 2. ส่งเข้ากลุ่มโรงเรียน (Global)
            sendLineNotification(lineToken, null, msg);
        });
    });
};

async function sendLineNotification(token, targetId, message) {
    if (!token || token === "YOUR_LINE_TOKEN") return;

    const axiosConfig = {
        timeout: 5000, // ป้องกันการค้างถ้าเน็ตช้า
        headers: { 'Content-Type': 'application/json' }
    };

    if (targetId && targetId.startsWith('U')) {
        try {
            await axios.post(LINE_API_PUSH_URL, {
                to: targetId,
                messages: [{ type: 'text', text: message }]
            }, {
                ...axiosConfig,
                headers: { ...axiosConfig.headers, 'Authorization': `Bearer ${token}` }
            });
            console.log(`✅ Messaging API Success: ${targetId}`);
        } catch (e) {
            console.error(`❌ Messaging API Failed: ${targetId}`, e.message);
        }
    } else {
        // หากไม่มี targetId แสดงว่าเป็นการส่งแจ้งเตือนกลุ่ม (Global) ผ่าน LINE Notify
        // ตรวจสอบเบื้องต้น: Message API Token (ยาว) จะใช้กับ Notify API ไม่ได้
        if (token.length > 100) {
            // console.log("ℹ️ Skipping Global LINE Notify (Token is for Messaging API)");
            return;
        }

        axios.post('https://notify-api.line.me/api/notify', `message=${encodeURIComponent(message)}`, {
            timeout: 5000,
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(e => {
            // console.error("❌ LINE Notify Error:", e.response ? e.response.data : e.message);
        });
    }
}

function processConfirmation(row, status, scan_photo, res, epcFromOldMethod) {
    const epc = row.epc_code || epcFromOldMethod;
    const { id, time, type } = row;

    if (scan_photo && scan_photo.startsWith('data:image')) {
        try {
            const base64Data = scan_photo.replace(/^data:image\/\w+;base64,/, '');
            const filePath = path.join(__dirname, 'public', 'photos', `scan_${epc}.jpg`);
            fs.writeFileSync(filePath, base64Data, 'base64');
        } catch (e) {
            console.error('Error saving scan image:', e);
        }
    }

    db.get("SELECT * FROM students WHERE epc_code = ?", [epc], (err, student) => {
        db.get("SELECT setting_value FROM settings WHERE setting_key = 'LATE_TIME'", [], (err, settingRow) => {
            const lateTimeStr = settingRow ? settingRow.setting_value : DEFAULT_LATE_TIME;
            let finalStatus = status;

            if (finalStatus === 'ปกติ' && type === 'เข้า') {
                const [hour, minute] = time.split(':').map(Number);
                const [lateHour, lateMinute] = lateTimeStr.split(':').map(Number);
                if (hour > lateHour || (hour === lateHour && minute > lateMinute)) {
                    finalStatus = 'สาย';
                }
            }

            db.run(`UPDATE attendance SET status = ? WHERE id = ?`, [finalStatus, id], (err) => {
                if (err) return res.json({ success: false, message: err.message });

                // Terminal log – AI result
                const icon = finalStatus === 'ปกติ' ? '✅' : finalStatus === 'สาย' ? '🕐' : finalStatus === 'รอตรวจสอบ' ? '⏳' : '🚨';
                const name = student ? student.name : epc;
                console.log(`${icon} [${logTime()}] AI ยืนยัน: ${name} → ${finalStatus}`);

                // ส่ง feedback กลับ ESP32 → LED + Buzzer
                if (finalStatus === 'ปกติ') mqttFeedback('pass');
                else if (finalStatus === 'สาย') mqttFeedback('late');
                else if (finalStatus === 'รอตรวจสอบ') mqttFeedback('fail');
                else mqttFeedback('fail');

                // ตอบกลับหน้าเว็บทันที
                res.json({ success: true, status: finalStatus });
                broadcast({ type: 'refresh' });

                // ทำงานที่เหลือ (LINE, MQTT) ในเบื้องหลัง
                triggerCheckinNotifications(student, epc, time, finalStatus, 'เช็คอิน', type);
            });
        });
    });
}

// --- Manual Check-in API (For Forgotten Cards) ---
app.post('/api/manual-checkin', (req, res) => {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสนักเรียน" });

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

    db.get("SELECT * FROM students WHERE student_id = ?", [student_id], (err, student) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (!student) return res.status(404).json({ success: false, message: "ไม่พบนักเรียนรหัสนี้" });

        db.get("SELECT type FROM attendance WHERE epc_code = ? AND date = ? ORDER BY id DESC LIMIT 1", [student.epc_code, dateStr], (err, lastLog) => {
            const nextType = (lastLog && lastLog.type === 'เข้า') ? 'ออก' : 'เข้า';

            db.get("SELECT setting_value FROM settings WHERE setting_key = 'LATE_TIME'", [], (err, settingRow) => {
                const lateTimeStr = settingRow ? settingRow.setting_value : DEFAULT_LATE_TIME;
                let status = 'Manual';

                if (nextType === 'เข้า') {
                    const [hour, minute] = timeStr.split(':').map(Number);
                    const [lateHour, lateMinute] = lateTimeStr.split(':').map(Number);
                    if (hour > lateHour || (hour === lateHour && minute > lateMinute)) {
                        status = 'สาย';
                    }
                }

                db.serialize(() => {
                    db.run(
                        `INSERT INTO attendance (epc_code, date, time, type, status) VALUES (?, ?, ?, ?, ?)`,
                        [student.epc_code, dateStr, timeStr, nextType, status]
                    );
                    db.run(`UPDATE students SET forgot_count = forgot_count + 1 WHERE student_id = ?`, [student_id]);
                });

                // ตอบกลับทันที
                res.json({ success: true, message: `บันทึก${nextType}เรียบร้อย (ลืมบัตรครั้งที่ ${student.forgot_count + 1})` });
                broadcast({ type: 'refresh' });

                // ทำงานที่เหลือในเบื้องหลัง
                const class_room = `${student.level}${student.class_year}/${student.room}`;
                appendToCSV(dateStr, timeStr, nextType, student.student_id, student.epc_code, student.name, class_room, status);
                triggerCheckinNotifications(student, student.epc_code, timeStr, status, 'แมนนวล', nextType);
            });
        });
    });
});

// --- Face ID Only Check-in API ---
app.post('/api/face-id-checkin', (req, res) => {
    const { epc_code } = req.body;
    if (!epc_code) return res.status(400).json({ success: false, message: "ไม่พบรหัสประจำตัวจากการสแกน" });

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

    db.get("SELECT * FROM students WHERE epc_code = ?", [epc_code], (err, student) => {
        if (err || !student) return res.status(404).json({ success: false, message: "ไม่สามารถระบุตัวตนได้" });

        db.get("SELECT type FROM attendance WHERE epc_code = ? AND date = ? ORDER BY id DESC LIMIT 1", [epc_code, dateStr], (err, lastLog) => {
            const nextType = (lastLog && lastLog.type === 'เข้า') ? 'ออก' : 'เข้า';

            db.get("SELECT setting_value FROM settings WHERE setting_key = 'LATE_TIME'", [], (err, settingRow) => {
                const lateTimeStr = settingRow ? settingRow.setting_value : DEFAULT_LATE_TIME;
                let status = 'FaceID';

                if (nextType === 'เข้า') {
                    const [hour, minute] = timeStr.split(':').map(Number);
                    const [lateHour, lateMinute] = lateTimeStr.split(':').map(Number);
                    if (hour > lateHour || (hour === lateHour && minute > lateMinute)) {
                        status = 'สาย';
                    }
                }

                db.serialize(() => {
                    db.run(
                        `INSERT INTO attendance (epc_code, date, time, type, status) VALUES (?, ?, ?, ?, ?)`,
                        [epc_code, dateStr, timeStr, nextType, status]
                    );
                    db.run(`UPDATE students SET forgot_count = forgot_count + 1 WHERE epc_code = ?`, [epc_code]);
                });

                // ตอบกลับทันที
                res.json({ success: true, message: `ยืนยันตัวตนสำเร็จ! บันทึก${nextType} (ลืมบัตรครั้งที่ ${student.forgot_count + 1})` });
                broadcast({ type: 'refresh' });

                // ทำงานที่เหลือในเบื้องหลัง
                const class_room = `${student.level}${student.class_year}/${student.room}`;
                appendToCSV(dateStr, timeStr, nextType, student.student_id, student.epc_code, student.name, class_room, status);
                triggerCheckinNotifications(student, epc_code, timeStr, status, 'Face ID', nextType);
            });
        });
    });
});

// --- Settings API ---
app.get('/api/settings', (req, res) => {
    db.all("SELECT * FROM settings", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        const settingsObj = {};
        rows.forEach(r => settingsObj[r.setting_key] = r.setting_value);
        res.json({ success: true, data: settingsObj });
    });
});

app.put('/api/settings', (req, res) => {
    const { line_token, late_time } = req.body;
    db.serialize(() => {
        db.run("UPDATE settings SET setting_value = ? WHERE setting_key = 'LINE_TOKEN'", [line_token || DEFAULT_LINE_TOKEN]);
        db.run("UPDATE settings SET setting_value = ? WHERE setting_key = 'LATE_TIME'", [late_time || DEFAULT_LATE_TIME]);
    });
    res.json({ success: true, message: "บันทึกการตั้งค่าแล้ว" });
});

// --- API Subscription Management ---
app.get('/api/subscriptions/:student_id', (req, res) => {
    const student_id = req.params.student_id;
    db.all("SELECT * FROM parent_subscriptions WHERE student_id = ?", [student_id], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: rows });
    });
});

app.post('/api/subscriptions', (req, res) => {
    const { student_id, line_token } = req.body;
    if (!student_id || !line_token) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสนักเรียนและ Line Token" });

    db.run("INSERT INTO parent_subscriptions (student_id, line_token) VALUES (?, ?)", [student_id, line_token], function (err) {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "เพิ่มการแจ้งเตือนสำเร็จ", id: this.lastID });
    });
});

app.delete('/api/subscriptions/:id', (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM parent_subscriptions WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "ลบการแจ้งเตือนสำเร็จ" });
    });
});

// --- Analytics API ---
app.get('/api/analytics/summary', (req, res) => {
    const days = parseInt(req.query.days) || 7;
    // Calculate date logic in sqlite
    db.all(`
        SELECT date, 
               SUM(CASE WHEN status = 'ปกติ' THEN 1 ELSE 0 END) as normal_count,
               SUM(CASE WHEN status = 'สาย' THEN 1 ELSE 0 END) as late_count
        FROM attendance 
        WHERE type = 'เข้า' 
          AND date >= date('now', 'localtime', '-' || ? || ' days')
        GROUP BY date
        ORDER BY date ASC
    `, [days - 1], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: rows });
    });
});

// Hardware & Serial
/*
const COM_PORT = 'COM3';
try {
    const port = new SerialPort({ path: COM_PORT, baudRate: 9600 }, (err) => {
        if (err) console.log(`⚠️ ไม่พบ USB ที่ ${COM_PORT}`);
    });
    let buffer = "";
    port.on('data', (data) => {
        const chunk = data.toString('utf8');
        for (let char of chunk) {
            if (/[a-zA-Z0-9]/.test(char)) buffer += char;
            else { if (buffer.length > 5) processScan(buffer); buffer = ""; }
        }
    });
} catch (err) { }
*/

const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');
mqttClient.on('connect', () => {
    mqttClient.subscribe('smartgate/checkin');
    console.log('📡 MQTT connected → listening on smartgate/checkin');
});
mqttClient.on('message', (topic, message) => {
    if (topic === 'smartgate/checkin') processScan(message.toString().replace(/[^a-zA-Z0-9]/g, ''));
});

// ส่งผลกลับ ESP32 เพื่อควบคุม LED/Buzzer
function mqttFeedback(result) {
    // result: 'pass' | 'late' | 'fail' | 'unknown'
    mqttClient.publish('smartgate/feedback', result);
    console.log(`📤 MQTT feedback → smartgate/feedback: "${result}"`);
}


// API Logs
app.get('/api/logs', (req, res) => {
    db.all(`SELECT a.id, a.date, a.time, a.epc_code, a.type, s.student_id, COALESCE(s.name, 'ไม่ทราบชื่อ') as name, COALESCE(s.level || s.class_year || '/' || s.room, '-') as class_room, a.status, COALESCE(s.forgot_count, 0) as forgot_count, s.photo FROM attendance a LEFT JOIN students s ON a.epc_code = s.epc_code ORDER BY a.date DESC, a.time DESC LIMIT 100`, [], (err, rows) => {
        res.json(err ? [] : rows);
    });
});

// AI Insights Endpoint (Serves cached JSON)
app.get('/api/ai-insights', (req, res) => {
    try {
        const insightsPath = path.join(__dirname, 'data', 'ai_insights.json');
        if (fs.existsSync(insightsPath)) {
            res.json(JSON.parse(fs.readFileSync(insightsPath, 'utf8')));
        } else {
            res.json({ auto_summary: "กำลังวิเคราะห์ข้อมูล... กรุณารอสักครู่ (AI Engine runs periodically)" });
        }
    } catch (e) {
        res.json({ auto_summary: "Error loading insights data. Please try again later." });
    }
});

// Periodic AI Engine Execution
cron.schedule('30 16 * * *', () => { // Runs every day at 16:30
    console.log('🤖 Running background AI task...');
    exec('python scripts/ai_engine.py', (error, stdout, stderr) => {
        if (error) {
            console.error(`AI execution error: ${error}`);
            return;
        }
        console.log(`AI task completed. Output: ${stdout}`);
    });
});

app.listen(3000, '0.0.0.0', () => console.log('✅ Server running on http://localhost:3000'));