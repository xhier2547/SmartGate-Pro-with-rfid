import sqlite3
import random
from datetime import datetime, timedelta

import os

# เชื่อมต่อฐานข้อมูลโดยตรง
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'database', 'school.db')
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

first_names = ["สมชาย", "สมหญิง", "มาลี", "มานะ", "ปิติ", "ชูใจ", "วิชัย", "ศิริพร", "นพดล", "พรทิพย์"]
last_names = ["ใจดี", "มีสุข", "รักเรียน", "ขยันยิ่ง", "มั่นคง", "บุญมา", "ศรีสุข", "พิทักษ์", "ทองดี", "สว่างวงษ์"]
levels = ["อ.", "ป.", "ม."]

# 1. สร้างและบันทึกข้อมูลนักเรียน
print("กำลังสร้างรายชื่อนักเรียน 200 คน...")
students = []
for i in range(200):
    lvl = random.choice(levels)
    year = random.randint(1, 6 if lvl != "อ." else 3)
    epc = f"E{200000+i}"
    sid = f"S70{1001+i:04d}"
    name = f"{random.choice(first_names)} {random.choice(last_names)}"
    
    # เพิ่ม 0 (forgot_count) และ 100 (score) ให้ตรงกับฐานข้อมูลใหม่
    students.append((epc, sid, name, str(year), str(random.randint(1, 6)), lvl, 0, 100))

cursor.executemany('''
    INSERT OR REPLACE INTO students (epc_code, student_id, name, class_year, room, level, forgot_count, score) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
''', students)

# 2. สร้างข้อมูลการเข้า-ออก (ย้อนหลัง 7 วัน)
print("กำลังสร้างประวัติการเข้า-ออกย้อนหลัง...")
attendance = []
base_date = datetime.now() - timedelta(days=6)

for day in range(7):
    current_date = base_date + timedelta(days=day)
    if current_date.weekday() >= 5: # ข้ามเสาร์-อาทิตย์
        continue

    for s in students:
        epc = s[0]
        
        # จำลองเวลาเข้าเรียน (07:00 - 08:30)
        in_time = current_date.replace(hour=7, minute=0) + timedelta(minutes=random.randint(0, 90))
        in_status = "สาย" if in_time.hour >= 8 and in_time.minute > 0 else "ปกติ"
        attendance.append((epc, in_time.strftime("%Y-%m-%d"), in_time.strftime("%H:%M"), "เข้า", in_status))
        
        # จำลองเวลาออก (15:30 - 16:30)
        out_time = current_date.replace(hour=15, minute=30) + timedelta(minutes=random.randint(0, 60))
        attendance.append((epc, out_time.strftime("%Y-%m-%d"), out_time.strftime("%H:%M"), "ออก", "-"))

cursor.executemany('''
    INSERT INTO attendance (epc_code, date, time, type, status) 
    VALUES (?, ?, ?, ?, ?)
''', attendance)

conn.commit()
conn.close()

print(f"✅ บันทึกข้อมูลนักเรียน 200 คน และประวัติเข้า-ออก {len(attendance)} รายการ ลงฐานข้อมูลเรียบร้อย!")