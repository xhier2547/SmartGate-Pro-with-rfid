// js/dashboard.js
let myChart = null; 
let allLogs = [], allStudents = [], globalAIData = null;
let showStillInOnly = false;

function toggleStillInFilter() {
    showStillInOnly = !showStillInOnly;
    const btn = document.getElementById('btnFilterStillIn');
    if (showStillInOnly) {
        btn.innerText = 'SHOW ALL';
        btn.classList.add('text-rose-500');
        btn.classList.remove('text-blue-400');
    } else {
        btn.innerText = 'ดูนักเรียนยังไม่เช็คเอาท์';
        btn.classList.remove('text-rose-500');
        btn.classList.add('text-blue-400');
    }
    updateDashboard();
}
window.toggleStillInFilter = toggleStillInFilter;

async function updateDashboard() {
    try {
        const [logs, stuRes] = await Promise.all([
            API.getLogs(),
            allStudents.length === 0 ? API.getStudents() : Promise.resolve({ success: true, data: allStudents })
        ]);

        allLogs = logs;
        if (stuRes && stuRes.success) allStudents = stuRes.data;
        // Initialize date if empty (don't override user selection if already set)
        const dateInput = document.getElementById('dateFilter');
        if (dateInput && !dateInput.value) {
            const today = new Date();
            const localDateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
            dateInput.value = localDateStr;
        }

        const filter = {
            level: document.getElementById('levelFilter').value,
            grade: document.getElementById('gradeFilter').value,
            room: document.getElementById('roomFilter').value,
            date: document.getElementById('dateFilter').value,
            search: document.getElementById('searchInput').value.trim().toLowerCase()
        };

        const filtered = logs.filter(l => {
            const class_room = l.class_room || "";
            const classArr = class_room.split('/');
            const lvl = (classArr[0] || "").replace(/[0-9/]/g, '') || '';
            const grd = (classArr[0] || "").replace(/[^0-9]/g, '') || '';
            const rm = class_room.includes('/') ? classArr[1] : '';
            
            const itemDate = l.date || "";
            const filterDate = filter.date || "";

            // Boolean conditions with proper precedence
            const levelMatch = filter.level === 'all' || lvl === filter.level || (filter.level === 'all' && lvl === '');
            const gradeMatch = filter.grade === 'all' || grd === filter.grade;
            const roomMatch = filter.room === 'all' || rm === filter.room;
            const dateMatch = !filterDate || itemDate === filterDate;
            const searchMatch = !filter.search || (l.name || "").toLowerCase().includes(filter.search) || (l.student_id || "").toLowerCase().includes(filter.search);
            
            return levelMatch && gradeMatch && roomMatch && dateMatch && searchMatch;
        });

        // Unique Student counts logic for Summary Cards
        const studentDaily = {}; 
        filtered.forEach(l => {
            const id = l.student_id || l.epc_code;
            if (!id) return;
            if (!studentDaily[id]) studentDaily[id] = { firstIn: null, lastLog: l, hasOut: false };
            if (l.type === 'เข้า') {
                if (!studentDaily[id].firstIn || l.time < studentDaily[id].firstIn.time) studentDaily[id].firstIn = l;
            } else if (l.type === 'ออก') studentDaily[id].hasOut = true;
            
            const currentTime = (l.date || "") + ' ' + (l.time || "");
            const lastTime = (studentDaily[id].lastLog.date || "") + ' ' + (studentDaily[id].lastLog.time || "");
            if (currentTime >= lastTime) studentDaily[id].lastLog = l;
        });

        const uniqueStudents = Object.values(studentDaily);
        const entries = uniqueStudents.filter(s => s.firstIn).map(s => s.firstIn);
        const exits = uniqueStudents.filter(s => s.hasOut);
        const stillIn = uniqueStudents.filter(s => s.lastLog.type === 'เข้า');

        // Fix: Only evaluate "เข้า" status for summary cards
        const n = entries.filter(l => l.status === 'ปกติ' || (l.status !== 'สาย' && l.status !== 'Manual' && l.status !== 'Mismatch' && l.status !== 'FaceID' && l.status !== 'รอตรวจสอบ')).length;
        const s = entries.filter(l => l.status === 'สาย').length;

        if (document.getElementById('totalCount')) document.getElementById('totalCount').innerText = entries.length.toLocaleString();
        if (document.getElementById('normalCount')) document.getElementById('normalCount').innerText = n.toLocaleString();
        if (document.getElementById('lateCount')) document.getElementById('lateCount').innerText = s.toLocaleString();
        if (document.getElementById('normalPct')) document.getElementById('normalPct').innerText = entries.length ? Math.round((n / entries.length) * 100) + '%' : '0%';
        if (document.getElementById('latePct')) document.getElementById('latePct').innerText = entries.length ? Math.round((s / entries.length) * 100) + '%' : '0%';
        if (document.getElementById('outCount')) document.getElementById('outCount').innerText = exits.length.toLocaleString();
        if (document.getElementById('outPct')) document.getElementById('outPct').innerText = entries.length ? Math.round((exits.length / entries.length) * 100) + '%' : '0%';
        if (document.getElementById('stillInCount')) document.getElementById('stillInCount').innerText = stillIn.length.toLocaleString();

        let displayLogs = filtered;
        if (showStillInOnly) {
            const stillInIds = stillIn.map(s => s.lastLog.student_id || s.lastLog.epc_code);
            displayLogs = filtered.filter(l => stillInIds.includes(l.student_id || l.epc_code));
        }

        // --- Table Rendering (Premium Enterprise Look) ---
        const renderList = displayLogs.slice(0, 50);
        const logTable = document.getElementById('logTable');
        
        if (logTable) {
            if (renderList.length === 0) {
                logTable.innerHTML = `<tr><td colspan="7" class="text-center py-32">
                    <div class="flex flex-col items-center gap-4 opacity-30">
                        <div class="text-6xl">📥</div>
                        <div class="text-[11px] font-black uppercase tracking-[0.4em] text-cyan-400">No Activity Logs for this period</div>
                    </div>
                </td></tr>`;
            } else {
                logTable.innerHTML = renderList.map(l => {
                    const isLate = l.status === 'สาย';
                    const isWaiting = l.status === 'รอตรวจสอบ';
                    const typeColor = l.type === 'ออก' ? 'bg-orange-600/10 text-orange-500 border-orange-500/20' : 'bg-cyan-600/10 text-cyan-500 border-cyan-500/20';
                    const statusColor = isLate ? 'bg-rose-600/10 text-rose-500 border-rose-500/20' : (l.type === 'ออก' ? 'text-slate-600' : 'bg-emerald-600/10 text-emerald-500 border-emerald-500/20');
                    
                    return `<tr class="hover:bg-white/[0.04] cursor-pointer transition-all border-b border-white/[0.02] ${isWaiting ? 'bg-amber-500/5' : ''}" onclick="openStudentDetail('${l.name}')">
                        <td class="py-6 px-10">
                            <div class="text-cyan-400 font-mono font-bold text-xs tracking-wider">${l.time || '--:--'}</div>
                            <div class="text-[9px] text-slate-500 font-bold uppercase mt-1 tracking-widest">${l.date || '----'}</div>
                        </td>
                        <td class="py-6 px-6 font-black text-slate-300 text-xs tracking-widest">${l.student_id || '-'}</td>
                        <td class="py-6 px-6 text-slate-600 font-mono text-[9px] truncate max-w-[80px]">${l.epc_code || '-'}</td>
                        <td class="py-6 px-6 font-bold text-white">
                            <div class="flex items-center gap-2">
                                ${l.name || 'ไม่ทราบชื่อ'}
                                ${isWaiting ? '<div class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>' : ''}
                            </div>
                        </td>
                        <td class="py-6 px-6 text-center">
                            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${l.class_room || '-'}</span>
                        </td>
                        <td class="py-6 px-6 text-center">
                            <span class="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border ${typeColor}">
                                ${l.type || 'ไม่ทราบ'}
                            </span>
                        </td>
                        <td class="py-6 px-10 text-right">
                            ${l.type === 'ออก' ? '<span class="text-slate-700 text-[10px]">—</span>' : `
                                <span class="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border ${statusColor}">
                                    ${l.status || 'ปกติ'}
                                </span>
                            `}
                        </td>
                    </tr>`;
                }).join('');
            }
        }

        // Peak Time Chart
        const bins = {};
        filtered.forEach(l => {
            if (!l.time) return;
            const tParts = l.time.split(':');
            const h = tParts[0];
            const m = tParts[1] || "00";
            const bin = `${h}:${Math.floor(parseInt(m) / 10) * 10}`.padStart(5, '0');
            if (!bins[bin]) bins[bin] = { In: 0, Out: 0 };
            l.type === 'เข้า' ? bins[bin].In++ : bins[bin].Out++;
        });
        
        const labels = Object.keys(bins).sort();
        const dataIn = labels.map(l => bins[l].In);
        const dataOut = labels.map(l => bins[l].Out);
        
        const chartEl = document.getElementById('peakChart');
        if (chartEl && window.Chart) {
            const ctx = chartEl.getContext('2d');
            if (myChart) myChart.destroy();
            myChart = new Chart(ctx, {
                type: 'bar',
                data: { labels, datasets: [
                    { label: 'เข้า', data: dataIn, backgroundColor: '#60a5fa', borderRadius: 4 },
                    { label: 'ออก', data: dataOut, backgroundColor: '#fb923c', borderRadius: 4 }
                ]},
                options: { 
                    responsive: true, maintainAspectRatio: false, 
                    plugins: { legend: { display: false } },
                    scales: { 
                        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 10 } } },
                        x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 } } }
                    }
                }
            });
        }

        // --- Filter Population (Manual Standard School Structure) ---
        const gSel = document.getElementById('gradeFilter'), rSel = document.getElementById('roomFilter');
        const levelVal = document.getElementById('levelFilter').value;

        if (gSel && rSel) {
            const currentGrade = gSel.value;
            const currentRoom = rSel.value;

            // Update Grades based on Level
            let maxGrade = 6;
            if (levelVal === 'อ.') maxGrade = 3;
            
            // Repopulate if count changed or empty
            const existingGrades = gSel.options.length - 1; // excluding "all"
            if (existingGrades !== maxGrade) {
                gSel.innerHTML = '<option value="all">ทุกชั้นปี</option>';
                for (let i = 1; i <= maxGrade; i++) {
                    gSel.add(new Option(`ชั้นปี ${i}`, i));
                }
                if (parseInt(currentGrade) <= maxGrade) gSel.value = currentGrade;
                else gSel.value = 'all';
            }

            // Always ensure Rooms 1-6 are present
            if (rSel.options.length <= 1) {
                rSel.innerHTML = '<option value="all">ทุกห้อง</option>';
                for (let i = 1; i <= 6; i++) {
                    rSel.add(new Option(`ห้อง ${i}`, i));
                }
                rSel.value = currentRoom || 'all';
            }
        }

    } catch (e) { console.error("Update Dashboard Error:", e); }
}
window.updateDashboard = updateDashboard;

function exportToCSV() {
    if (!allLogs.length) return;
    const csv = "\uFEFFDate,Time,Type,ID,Tag,Name,Class,Status\n" + allLogs.map(l => [l.date, l.time, l.type, l.student_id, l.epc_code, l.name, l.class_room, l.status].join(",")).join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `SmartGate_${new Date().toISOString().split('T')[0]}.csv`; link.click();
}

// AI Modal & Insights Logic
window.openAIModal = function() {
    const modal = document.getElementById('aiModal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
    updateAIInsights();
};

window.closeAIModal = function() {
    const modal = document.getElementById('aiModal');
    if (modal) modal.classList.add('hidden');
};

function updateAIInsights() {
    const summaryEl = document.getElementById('aiModalSummary');
    const anomalyEl = document.getElementById('aiModalAnomaly');
    const clusterEl = document.getElementById('aiModalClusters');
    if (!summaryEl || !anomalyEl || !clusterEl) return;

    if (!allLogs.length) {
        summaryEl.innerHTML = "ระบบยังไม่ได้รับข้อมูลเพียงพอสำหรับการประมวลผลเชิงลึก กรุณารอให้มีการบันทึกการเข้าเรียนเพื่อเริ่มวิเคราะห์รูปแบบพฤติกรรม";
        return;
    }

    let targetDate = new Date().toISOString().split('T')[0];
    if (allLogs.length > 0) {
        const availableDates = [...new Set(allLogs.map(l => l.date))].filter(d => d).sort().reverse();
        if (availableDates.length > 0) targetDate = availableDates[0];
    }

    const allTodayIn = allLogs.filter(l => l.date === targetDate && l.type === 'เข้า');
    
    // Fix: Count UNIQUE students instead of every single scan record
    const uniqueStudentIds = [...new Set(allTodayIn.map(l => l.student_id || l.epc_code))];
    const todayLogsCount = uniqueStudentIds.length;
    
    // Filter for unique "Latest" status per student for accurate statistics
    const latestStatusPerStudent = {};
    allTodayIn.forEach(l => {
        const id = l.student_id || l.epc_code;
        // Use the most recent log of the day to determine their final status for the summary
        if (!latestStatusPerStudent[id] || l.time > latestStatusPerStudent[id].time) {
            latestStatusPerStudent[id] = l;
        }
    });
    
    const uniqueEntriesArray = Object.values(latestStatusPerStudent);
    const totalStudentsInDB = allStudents.length || 1;
    const lates = uniqueEntriesArray.filter(l => l.status === 'สาย').length;
    const onTimes = uniqueEntriesArray.filter(l => l.status === 'ปกติ' || (l.status !== 'สาย' && l.status !== 'รอตรวจสอบ')).length;
    const attendanceRate = Math.round((todayLogsCount / totalStudentsInDB) * 100);
    
    // 1. Daily Summary (Technical/Professional)
    let insightStr = `<div class="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-2">
        <div class="flex justify-between items-center text-xs font-bold">
            <span class="text-slate-400 uppercase tracking-widest">Attendance Metric</span>
            <span class="text-white">${attendanceRate}% Utilization</span>
        </div>
        <div class="text-base font-medium">
            วันนี้มีนักเรียนเช็คอินเข้าสู่ระบบรวม <span class="text-blue-400 font-bold">${todayLogsCount}</span> จาก <span class="text-slate-400">${totalStudentsInDB}</span> ราย 
            พบอัตราการมาสายที่ <span class="text-rose-400 font-bold">${Math.round((lates/todayLogsCount)*100 || 0)}%</span> 
            ซึ่งอยู่ในเกณฑ์ ${lates > (todayLogsCount * 0.3) ? 'ควรเฝ้าระวัง' : 'ปกติ'}
        </div>
    </div>`;
    summaryEl.innerHTML = insightStr;

    // 2. Anomaly Detection (Technical Analysis)
    // Finding students who are much later than their own average
    const studentAverages = {};
    allLogs.filter(l => l.type === 'เข้า' && l.status === 'ปกติ' && l.date !== targetDate).forEach(l => {
        if (!l.time) return;
        if (!studentAverages[l.student_id]) studentAverages[l.student_id] = [];
        const [h, m] = l.time.split(':');
        studentAverages[l.student_id].push(parseInt(h) * 60 + parseInt(m));
    });

    const anomalies = [];
    todayLogs.forEach(l => {
        const history = studentAverages[l.student_id];
        if (history && history.length >= 2) {
            const avg = history.reduce((a, b) => a + b, 0) / history.length;
            const [h, m] = l.time.split(':');
            const current = parseInt(h) * 60 + parseInt(m);
            const deviation = current - avg;
            if (deviation > 20) { // More than 20 mins later than usual
                anomalies.push({ name: l.name, deviation: Math.round(deviation) });
            }
        }
    });

    anomalyEl.innerHTML = anomalies.map(a => `
        <div class="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl mb-2 flex justify-between items-center">
            <span class="text-[11px] font-bold text-slate-200">${a.name}</span>
            <span class="text-[10px] font-black text-rose-500 uppercase">Latency: +${a.deviation}m Deviation</span>
        </div>
    `).join('') || '<div class="text-[10px] text-slate-600 font-bold italic py-4">No significant behavior deviations detected today.</div>';

    // 3. Student Clusters (Class Performance)
    const classMap = {};
    todayLogs.forEach(l => {
        const cls = l.class_room || 'Unknown';
        if (!classMap[cls]) classMap[cls] = { total: 0, late: 0 };
        classMap[cls].total++;
        if (l.status === 'สาย') classMap[cls].late++;
    });

    const clusters = Object.entries(classMap).map(([name, s]) => ({
        name,
        lateRate: Math.round((s.late / s.total) * 100)
    })).sort((a,b) => b.lateRate - a.lateRate);

    clusterEl.innerHTML = clusters.slice(0, 3).map(c => `
        <div class="flex justify-between items-center text-[11px] mb-2 p-1">
            <span class="text-slate-400">${c.name}</span>
            <span class="font-black ${c.lateRate > 50 ? 'text-rose-500' : 'text-emerald-500'}">${c.lateRate}% Tardiness</span>
        </div>
        <div class="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-4">
            <div class="h-full ${c.lateRate > 50 ? 'bg-rose-500' : 'bg-emerald-500'}" style="width: ${c.lateRate}%"></div>
        </div>
    `).join('') || '<div class="text-[10px] text-slate-600 font-bold italic py-4">Insufficient class-level data.</div>';
}