import serial
import requests
import re  # 1. เพิ่มบรรทัดนี้ด้านบนสุด

SERVER_URL = "http://127.0.0.1:3000/api/register"
COM_PORT = "COM3"  
BAUD_RATE = 9600

try:
    ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
    print("✅ เชื่อมต่อเครื่องอ่านบัตรสำเร็จ!")
except Exception as e:
    print(f"❌ เชื่อมต่อเครื่องอ่านไม่ได้: {e}")
    exit()

print("\n=== ระบบลงทะเบียนบัตรนักเรียนใหม่ (SmartGate Pro) ===")

while True:
    print("-" * 40)
    student_id = input("1. พิมพ์ รหัสนักเรียน (เช่น S701001) หรือกด Enter เพื่อออก: ")
    if not student_id: break
    
    name = input("2. พิมพ์ ชื่อ-นามสกุล: ")
    level = input("3. พิมพ์ ระดับชั้น (อ./ป./ม.): ")
    class_year = input("4. พิมพ์ ชั้นปี (เช่น 1, 2, 3): ")
    room = input("5. พิมพ์ ห้อง (เช่น 1, 2): ")

    print("\n👉 ** กรุณานำบัตรมาแตะที่เครื่องอ่าน ID-20LA... **")
    
    epc_code = ""
    ser.reset_input_buffer() 
    while not epc_code:
        if ser.in_waiting > 0:
            raw_data = ser.readline()
            raw_text = raw_data.decode('utf-8', errors='ignore')
            
            # 2. แก้ไขบรรทัดนี้: กรองเอาเฉพาะ A-Z, a-z และ 0-9 เท่านั้น
            epc_code = re.sub(r'[^a-zA-Z0-9]', '', raw_text)

    print(f"🟢 อ่านรหัสบัตรได้: [{epc_code}]")

    student_data = {
        "epc_code": epc_code,
        "student_id": student_id,
        "name": name,
        "level": level,
        "class_year": class_year,
        "room": room
    }
    
    try:
        res = requests.post(SERVER_URL, json=[student_data])
        if res.status_code == 200:
            print("✅ บันทึกข้อมูลลงฐานข้อมูลสำเร็จ!\n")
        else:
            print(f"❌ บันทึกไม่สำเร็จ: {res.text}\n")
    except Exception as e:
        print(f"❌ ไม่สามารถเชื่อมต่อ Server ได้: {e}\n")