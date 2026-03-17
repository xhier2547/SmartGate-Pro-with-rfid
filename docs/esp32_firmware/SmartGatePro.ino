/*
 * SmartGate Pro — ESP32 Firmware
 * RFID Reader: ID-20LA (UART 9600 baud, GPIO16=RX, GPIO17=TX)
 * LED Green  : GPIO 25 — บัตรผ่าน AI / ออก
 * LED Yellow : GPIO 26 — มาสาย
 * LED Red    : GPIO 32 — ไม่ผ่าน AI / บัตรไม่รู้จัก
 * Buzzer     : GPIO 13 — เสียงแจ้งเตือน
 * MQTT Broker: broker.hivemq.com (public, free)
 */

#include <PubSubClient.h>
#include <WiFi.h>

// ── WiFi ────────────────────────────────────────────────────
const char *WIFI_SSID = "YOUR_WIFI_SSID";         // ← เปลี่ยน
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"; // ← เปลี่ยน

// ── MQTT ────────────────────────────────────────────────────
const char *MQTT_SERVER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char *TOPIC_CHECKIN = "smartgate/checkin";   // ESP32 → Server
const char *TOPIC_FEEDBACK = "smartgate/feedback"; // Server → ESP32

// ── Pins ────────────────────────────────────────────────────
#define LED_GREEN 25  // ✅ pass / checkout
#define LED_YELLOW 26 // 🕐 late
#define LED_RED 32    // ❌ fail / unknown
#define BUZZER 13     // 🔊 buzzer

// ── RFID Serial (ID-20LA) ───────────────────────────────────
#define RFID_RX 16
#define RFID_TX 17
HardwareSerial rfidSerial(2); // UART2

// ── WiFi + MQTT clients ──────────────────────────────────────
WiFiClient espClient;
PubSubClient mqtt(espClient);

// ── State ───────────────────────────────────────────────────
String rfidBuffer = "";
unsigned long lastScanMs = 0;
const unsigned long SCAN_COOLDOWN_MS = 3000; // 3 วินาทีระหว่างสแกน

// ════════════════════════════════════════════════════════════
// LED + Buzzer helpers
// ════════════════════════════════════════════════════════════
void ledsOff() {
  digitalWrite(LED_GREEN, LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_RED, LOW);
}

// ✅ ผ่าน (ปกติ / ออก) — เขียว 1 วิ + beep สั้น
void signalPass() {
  ledsOff();
  digitalWrite(LED_GREEN, HIGH);
  tone(BUZZER, 1800, 100); // 1800Hz 100ms
  delay(1000);
  ledsOff();
}

// 🕐 มาสาย — เหลือง 1.5 วิ + 2 beep
void signalLate() {
  ledsOff();
  digitalWrite(LED_YELLOW, HIGH);
  tone(BUZZER, 1200, 100);
  delay(200);
  tone(BUZZER, 1200, 100);
  delay(1300);
  ledsOff();
}

// ❌ ไม่ผ่าน AI — แดง 2 วิ + buzz ยาว
void signalFail() {
  ledsOff();
  digitalWrite(LED_RED, HIGH);
  tone(BUZZER, 500, 1500); // 500Hz 1.5 วิ
  delay(2000);
  ledsOff();
}

// ❓ บัตรไม่รู้จัก — แดงกะพริบ 3 ครั้ง + 3 beep สั้น
void signalUnknown() {
  ledsOff();
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_RED, HIGH);
    tone(BUZZER, 800, 80);
    delay(200);
    digitalWrite(LED_RED, LOW);
    delay(150);
  }
}

// 🚪 checkout — เขียวสั้น (ไม่ต้องยืนยัน AI)
void signalCheckout() {
  ledsOff();
  digitalWrite(LED_GREEN, HIGH);
  tone(BUZZER, 1600, 80);
  delay(600);
  ledsOff();
}

// ════════════════════════════════════════════════════════════
// MQTT Callback — รับ feedback จาก Server
// ════════════════════════════════════════════════════════════
void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++)
    msg += (char)payload[i];
  Serial.printf("[MQTT] feedback: %s\n", msg.c_str());

  if (msg == "pass")
    signalPass();
  else if (msg == "late")
    signalLate();
  else if (msg == "fail")
    signalFail();
  else if (msg == "unknown")
    signalUnknown();
  else if (msg == "checkout")
    signalCheckout();
}

// ════════════════════════════════════════════════════════════
// WiFi + MQTT connect helpers
// ════════════════════════════════════════════════════════════
void connectWiFi() {
  Serial.printf("📶 Connecting to WiFi: %s ", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n✅ WiFi OK — IP: %s\n", WiFi.localIP().toString().c_str());
}

void connectMQTT() {
  String clientId = "SmartGate_" + String(random(0xffff), HEX);
  while (!mqtt.connected()) {
    Serial.print("📡 Connecting MQTT...");
    if (mqtt.connect(clientId.c_str())) {
      Serial.println(" ✅ Connected!");
      mqtt.subscribe(TOPIC_FEEDBACK);
      Serial.printf("✅ Subscribed: %s\n", TOPIC_FEEDBACK);
    } else {
      Serial.printf(" ❌ state=%d, retry in 3s\n", mqtt.state());
      delay(3000);
    }
  }
}

// ════════════════════════════════════════════════════════════
// RFID: อ่านและส่ง UID จาก ID-20LA
// ════════════════════════════════════════════════════════════
void handleRFID() {
  while (rfidSerial.available()) {
    char c = rfidSerial.read();
    if (c == 0x02) { // STX = เริ่มต้นข้อมูล
      rfidBuffer = "";
    } else if (c == 0x03) { // ETX = สิ้นสุดข้อมูล
      // ID-20LA ส่ง: [STX][10 hex chars][2 checksum][ETX]
      if (rfidBuffer.length() >= 10) {
        String uid = rfidBuffer.substring(0, 10); // แค่ UID ตัวจริง
        uid.toUpperCase();

        unsigned long now = millis();
        if (now - lastScanMs > SCAN_COOLDOWN_MS) {
          lastScanMs = now;
          Serial.printf("🪪 สแกนบัตร: %s\n", uid.c_str());
          mqtt.publish(TOPIC_CHECKIN, uid.c_str());
        } else {
          Serial.println("⏳ Cooldown: สแกนเร็วเกินไป");
        }
      }
      rfidBuffer = "";
    } else {
      rfidBuffer += c;
    }
  }
}

// ════════════════════════════════════════════════════════════
// setup() + loop()
// ════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  rfidSerial.begin(9600, SERIAL_8N1, RFID_RX, RFID_TX);

  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  ledsOff();

  // แสดงว่าเริ่มต้นระบบ (ไล่ไฟ 3 สี)
  digitalWrite(LED_RED, HIGH);
  delay(200);
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_YELLOW, HIGH);
  delay(200);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_GREEN, HIGH);
  delay(200);
  digitalWrite(LED_GREEN, LOW);

  connectWiFi();

  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  connectMQTT();

  Serial.println("🚀 SmartGate Pro ready!");
}

void loop() {
  // Keep MQTT alive
  if (!mqtt.connected())
    connectMQTT();
  mqtt.loop();

  // Read RFID card
  handleRFID();
}
