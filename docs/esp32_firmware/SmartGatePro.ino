#include <WiFi.h>
#include <PubSubClient.h>

// ── WiFi ──────────────────────────────────────────────────────
const char* ssid     = "Xhier_2.4G";
const char* password = "00000001R_";

// ── MQTT ──────────────────────────────────────────────────────
const char* mqtt_server = "broker.hivemq.com";
const char* TOPIC_CHECKIN  = "smartgate/checkin";   // ส่ง UID ไป Server
const char* TOPIC_FEEDBACK = "smartgate/feedback";  // รับผล AI กลับ

// ── Pins ──────────────────────────────────────────────────────
#define LED_GREEN   25   // ✅ กำลังดี / checkout
#define LED_YELLOW  26   // 🕐 สาย
#define LED_RED     32   // ❌ ไม่ผ่าน / ไม่รู้จัก
#define BUZZER      13   // 🔊 เสียง

WiFiClient   espClient;
PubSubClient client(espClient);

// ── LED/Buzzer helpers ────────────────────────────────────────
void ledsOff() {
  digitalWrite(LED_GREEN,  LOW);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_RED,    LOW);
}

// ✅ ผ่าน AI (ปกติ) — เขียว 1 วิ + Beep สั้น
void signalPass() {
  ledsOff();
  digitalWrite(LED_GREEN, HIGH);
  tone(BUZZER, 1800, 100);
  delay(1000);
  ledsOff();
}

// 🕐 มาสาย — เหลือง 1.5 วิ + Beep 2 ครั้ง
void signalLate() {
  ledsOff();
  digitalWrite(LED_YELLOW, HIGH);
  tone(BUZZER, 1200, 100); delay(200);
  tone(BUZZER, 1200, 100); delay(1300);
  ledsOff();
}

// ❌ AI ไม่ผ่าน — แดง 2 วิ + Buzz ยาว
void signalFail() {
  ledsOff();
  digitalWrite(LED_RED, HIGH);
  tone(BUZZER, 500, 1500);
  delay(2000);
  ledsOff();
}

// ❓ บัตรไม่รู้จัก — แดงกะพริบ 3 ครั้ง
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

// 🚪 ออก — เขียวสั้น 0.6 วิ
void signalCheckout() {
  ledsOff();
  digitalWrite(LED_GREEN, HIGH);
  tone(BUZZER, 1600, 80);
  delay(600);
  ledsOff();
}

// ── MQTT Callback — รับ feedback จาก Server ──────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  
  Serial.print("[MQTT] Feedback received: ");
  Serial.println(msg);

  if      (msg == "pass")     signalPass();
  else if (msg == "late")     signalLate();
  else if (msg == "fail")     signalFail();
  else if (msg == "unknown")  signalUnknown();
  else if (msg == "checkout") signalCheckout();
}

// ── WiFi Setup ────────────────────────────────────────────────
void setup_wifi() {
  delay(10);
  Serial.print("Connecting to: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// ── MQTT Reconnect ────────────────────────────────────────────
void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("ESP32_SmartGate_Client")) {
      Serial.println("Connected to Broker");
      client.subscribe(TOPIC_FEEDBACK);  // ← subscribe รับผล AI
      Serial.println("Subscribed: smartgate/feedback");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

// ── Setup ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);  // ID-20LA: RX2=16, TX2=17

  // ตั้ง Pin Mode
  pinMode(LED_GREEN,  OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_RED,    OUTPUT);
  pinMode(BUZZER,     OUTPUT);
  ledsOff();

  // ทดสอบไฟ 3 สีตอนเริ่มต้น
  Serial.println("\n--- SmartGate Pro System Starting ---");
  digitalWrite(LED_RED,    HIGH); delay(200); digitalWrite(LED_RED,    LOW);
  digitalWrite(LED_YELLOW, HIGH); delay(200); digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_GREEN,  HIGH); delay(200); digitalWrite(LED_GREEN,  LOW);

  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(mqttCallback);  // ← ตั้ง callback รับ feedback
}

// ── Loop ──────────────────────────────────────────────────────
void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  // ตรวจสอบว่ามีข้อมูลจาก ID-20LA เข้ามาไหม
  if (Serial2.available()) {
    String rfidData = "";
    delay(100);  // รอให้ข้อมูลมาครบชุด

    while (Serial2.available()) {
      char c = Serial2.read();
      // กรองเอาเฉพาะตัวอักษรและตัวเลข
      if (isAlphaNumeric(c)) {
        rfidData += c;
      }
    }

    if (rfidData.length() > 5) {
      Serial.print("\n[DETECTED] Tag ID: ");
      Serial.println(rfidData);

      // ส่งเข้า MQTT ไปยัง server.js
      bool published = client.publish(TOPIC_CHECKIN, rfidData.c_str());

      if (published) {
        Serial.println("Status: Sent to MQTT successfully");
        Serial.println("Waiting for AI feedback...");
      } else {
        Serial.println("Status: Failed to send to MQTT");
        signalFail();  // แสดงไฟแดงถ้าส่งไม่ได้
      }

      delay(2000);  // ป้องกันการสแกนซ้ำรัวๆ
    }
  }
}
