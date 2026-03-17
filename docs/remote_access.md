# 🌐 คู่มือการเข้าใช้งานจากนอกสถานที่ (Remote Access)

โปรเจกต์ **SmartGate Pro** รันอยู่บนเครื่องคอมพิวเตอร์ Local ของคุณ แต่คุณสามารถทำให้คุณครูหรือแอดมินเข้าใช้งานจากที่ไหนก็ได้ในโลกผ่านอินเทอร์เน็ตมือถือ (4G/5G) ด้วยวิธีที่ปลอดภัย ดังนี้ครับ:

## วิธีที่แนะนำ: Cloudflare Tunnel (ฟรีและปลอดภัย)

วิธีนี้เปรียบเสมือนการสร้างท่อที่ปลอดภัยเชื่อมจากคอมพิวเตอร์ของคุณไปยังระบบ Cloud ของ Cloudflare โดยที่คุณ **ไม่ต้องตั้งค่า Forward Port** ที่ Router ให้เสี่ยงต่อการถูกแฮ็ก

### ขั้นตอนการตั้งค่า:

1. **สมัครสมาชิก Cloudflare:** ไปที่ [dash.cloudflare.com](https://dash.cloudflare.com/)
2. **ติดตั้ง cloudflared:** 
   - ดาวน์โหลดโปรแกรม `cloudflared` สำหรับ Windows
   - เปิด Terminal (PowerShell) แล้วรันคำสั่งล็อกอิน:
     ```bash
     cloudflared tunnel login
     ```
3. **สร้าง Tunnel:**
     ```bash
     cloudflared tunnel create smart-school
     ```
4. **ตั้งค่าการเชื่อมต่อ (Ingress Rule):**
   เชื่อมต่อ Domain ของคุณเข้ากับ Local Port `3000`:
     ```bash
     cloudflared tunnel route dns smart-school smart-school.yourdomain.com
     ```
5. **รัน Tunnel:**
     ```bash
     cloudflared tunnel run --url http://localhost:3000 smart-school
     ```

ตอนนี้คุณครูสามารถเข้าใช้งานผ่าน `https://smart-school.yourdomain.com` ได้จากทุกที่ทันที!

---

## ทางเลือกอื่น: Localtonet (ตั้งค่าง่ายที่สุด)

หากคุณไม่มี Domain ของตัวเอง สามารถใช้บริการ **Localtonet** ได้:
1. ดาวน์โหลดโปรแกรมจาก [localtonet.com](https://localtonet.com/)
2. รันคำสั่งเชื่อมต่อ HTTP Port 3000
3. คุณจะได้ URL สุ่มมา (เช่น `https://abc-123.localtonet.com`) สำหรับส่งให้คุณครูใช้งานชั่วคราวได้ทันที

> [!IMPORTANT]
> เพื่อความปลอดภัยสูงสุด: อย่าลืมตั้งรหัสผ่านที่หน้า `Login` ของระบบให้คาดเดาได้ยาก ก่อนเปิดระบบให้คนนอกเข้าถึงนะครับ
