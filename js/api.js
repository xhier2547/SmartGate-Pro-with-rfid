// js/api.js
const API = {
    getLogs: async () => await (await fetch('/api/logs')).json(),
    getAI: async () => await (await fetch('/api/ai-insights')).json(),
    getWeather: async () => await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=7.0086&longitude=100.4980&current_weather=true')).json(),
    manualIn: async (sid) => await (await fetch('/api/manual-checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id: sid }) })).json(),
    faceIDCheckin: async (epc) => await (await fetch('/api/face-id-checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ epc_code: epc }) })).json(),
    confirmFace: async (epc) => await (await fetch('/api/confirm-checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ epc_code: epc, status: 'Manual', captured_image: '' }) })).json(),
    getStudents: async () => await (await fetch('/api/manage/students')).json()
};