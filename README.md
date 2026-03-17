# 🏫 SmartGate Pro

> ระบบบริหารจัดการการเข้า-ออกโรงเรียนอัจฉริยะ  
> ด้วย RFID + AI Face Recognition + IoT + LINE Notification

[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org)
[![ESP32](https://img.shields.io/badge/ESP32-Firmware-blue)](docs/esp32_firmware/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🪪 **RFID Check-in** | ESP32 + ID-20LA 125kHz · สแกนเสร็จใน < 1 วินาที |
| 🤖 **AI Face Recognition** | face-api.js TinyFaceDetector · Best-of-8 Frames · Threshold 0.92 |
| 📲 **LINE Notification** | แจ้งผู้ปกครองทันทีพร้อมชื่อ เวลา สถานะ |
| 💡 **LED + Buzzer Feedback** | 2-Way MQTT · เขียว/เหลือง/แดง ตามผล AI |
| 📊 **Real-time Dashboard** | Server-Sent Events · สถิติย้อนหลัง |
| 🌐 **Remote Access** | รองรับ ngrok / Cloudflare Tunnel |

---

## 🏗️ Architecture

```
[บัตร RFID] → [ESP32 + ID-20LA]
    → MQTT publish → [HiveMQ Cloud Broker]
    → subscribe → [Node.js Server]
    → [SQLite DB] + [Web Dashboard (SSE)] + [LINE API]
    ← MQTT feedback ← [LED 🟢🟡🔴 + Buzzer 🔊]
```

**MQTT Topics:**
- `smartgate/checkin` — ESP32 → Server (UID)
- `smartgate/feedback` — Server → ESP32 (ผล AI)

---

## 🛠️ Tech Stack

- **Backend:** Node.js + Express.js
- **Database:** SQLite3 (WAL mode)
- **AI:** face-api.js (TinyFaceDetector, browser-side)
- **Hardware:** ESP32 + ID-20LA RFID Reader
- **IoT Protocol:** MQTT (HiveMQ public broker)
- **Notification:** LINE Messaging API
- **Real-time:** Server-Sent Events (SSE)
- **Remote Access:** ngrok / Cloudflare Tunnel

---

## 🔧 Hardware Setup

| อุปกรณ์ | สเปค | GPIO |
|---|---|---|
| ESP32 DevKit | 240MHz Dual-core | — |
| ID-20LA RFID | 125kHz UART 9600 | RX=GPIO16 |
| LED เขียว | ผ่าน / เช็คเอาท์ | GPIO 25 |
| LED เหลือง | มาสาย | GPIO 26 |
| LED แดง | ไม่ผ่าน / ไม่รู้จัก | GPIO 32 |
| Buzzer | เสียงแจ้งเตือน | GPIO 13 |

**การต่อขา ID-20LA:**
```
ESP32 GPIO16 (RX) ← TX ของ ID-20LA
ESP32 3.3V        → VCC
ESP32 GND         → GND
```

---

## 🚀 การติดตั้ง (Installation)

### 1. Clone โปรเจกต์
```bash
git clone https://github.com/YOUR_USERNAME/smart-school-api.git
cd smart-school-api
```

### 2. ติดตั้ง Dependencies
```bash
npm install
```

### 3. ตั้งค่า Environment Variables
```bash
cp .env.example .env
# แก้ไขไฟล์ .env ใส่ค่าจริง
```

แก้ไข `.env`:
```env
SECRET_KEY=your_jwt_secret_key_here
LINE_TOKEN=your_line_channel_access_token
LINE_CHANNEL_SECRET=your_line_channel_secret
DEFAULT_LATE_TIME=08:30
PORT=3000
```

### 4. สร้างโฟลเดอร์ที่จำเป็น
```bash
mkdir -p database data public/photos
```

### 5. รันเซิร์ฟเวอร์
```bash
node server.js
```

เปิด browser: `http://localhost:3000`

---

## 📡 ESP32 Firmware

1. เปิดไฟล์ `docs/esp32_firmware/SmartGatePro.ino` ใน Arduino IDE
2. ติดตั้ง Library: **PubSubClient** (ผ่าน Library Manager)
3. แก้ไข WiFi credentials:
```cpp
const char *WIFI_SSID     = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
```
4. Upload → ESP32 พร้อมทำงาน

---

## 📁 Project Structure

```
smart-school-api/
├── server.js              # Main server (Node.js + Express)
├── .env.example           # Template สำหรับ Environment Variables
├── package.json
├── js/
│   ├── face_ai.js         # AI Face Recognition (browser-side)
│   ├── main.js            # Frontend logic
│   └── dashboard.js
├── views/
│   ├── index.html         # หน้า Dashboard หลัก
│   ├── monitor.html       # หน้า Monitor
│   ├── manage.html        # จัดการนักเรียน
│   └── ...
├── docs/
│   ├── esp32_firmware/
│   │   └── SmartGatePro.ino   # ESP32 Arduino Firmware
│   └── presentation/
│       └── index.html         # Reveal.js Presentation
├── models/                # face-api.js AI Models
├── database/              # SQLite (ไม่ถูก commit)
└── public/photos/         # รูปนักเรียน (ไม่ถูก commit)
```

---

## 🔑 LINE Bot Setup

1. สร้าง Channel ที่ [LINE Developers Console](https://developers.line.biz/)
2. ตั้ง Webhook URL: `https://YOUR_NGROK_URL/api/webhook`
3. ผู้ปกครอง Add LINE Bot → พิมพ์ **รหัสนักเรียน 10 หลัก** เพื่อลงทะเบียน

---

## 🌐 Remote Access (ngrok)

```bash
# Windows
.\start_tunnel_ngrok.bat
```

---

## 👤 ผู้พัฒนา

**นายอภิลักษณ์ จันทร์แก้วเดช**  
รหัสนักศึกษา: 6610110688  
ปีการศึกษา 2567

---

## 📝 License

MIT License — ใช้ได้ฟรี แต่กรุณา credit ผู้พัฒนา
