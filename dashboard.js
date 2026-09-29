/**
 * โมดูลแดชบอร์ดและการวิเคราะห์ข้อมูล (Analytics Dashboard Module)
 * คำนวณ KPI Cards และเรนเดอร์กราฟสถิติด้วย Chart.js
 * รองรับการปรับโทนสีอัตโนมัติตามโหมดมืด (Dark Mode) และโหมดสว่าง (Light Mode)
 */

class CarDashboard {
  constructor() {
    this.charts = {};
    this.globalData = [];
    this.currentFilterType = 'fy';
  }

  init(globalData) {
    this.globalData = globalData || [];
    this.initFiscalYearOptions();
    this.update();
  }

  setData(globalData) {
    this.globalData = globalData || [];
    this.initFiscalYearOptions();
    this.update();
  }

  getThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      isDark: isDark,
      gridColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#f1f5f9',
      tickColor: isDark ? '#94a3b8' : '#475569',
      tooltipBg: isDark ? '#0f172a' : '#1e293b',
      doughnutBorder: isDark ? '#131c2e' : '#ffffff'
    };
  }

  initFiscalYearOptions() {
    const sel = document.getElementById('dashFY');
    if (!sel) return;

    const currentSelection = sel.value;
    const fys = new Set();

    this.globalData.forEach(r => {
      const dVal = r[15] || r[4];
      if (dVal) {
        const d = new Date(dVal);
        if (!isNaN(d)) {
          const m = d.getMonth() + 1;
          const y = d.getFullYear() + 543;
          fys.add(m >= (window.CONFIG?.FISCAL_START_MONTH || 10) ? y + 1 : y);
        }
      }
    });

    // เพิ่มปีปัจจุบันและปีถัดไปเป็นค่าตั้งต้นหากไม่มีในข้อมูล
    const now = new Date();
    const curM = now.getMonth() + 1;
    const curY = now.getFullYear() + 543;
    const curFY = curM >= 10 ? curY + 1 : curY;
    fys.add(curFY);
    fys.add(curFY - 1);

    sel.innerHTML = '';
    Array.from(fys).sort().reverse().forEach(fy => {
      const opt = document.createElement('option');
      opt.value = fy;
      opt.textContent = `ปีงบประมาณ ${fy}`;
      if (String(fy) === String(currentSelection || curFY)) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    });
  }

  getFilteredData() {
    const type = document.getElementById('dashFilterType')?.value || 'all';
    this.currentFilterType = type;

    let filtered = this.globalData.filter(r => r && r[0] && !(r[12] && String(r[12]).includes('ยกเลิก')));

    if (type === 'date') {
      const sdVal = document.getElementById('dashStartDate')?.value;
      const edVal = document.getElementById('dashEndDate')?.value;
      if (sdVal && edVal) {
        const sd = new Date(sdVal);
        const ed = new Date(edVal);
        ed.setHours(23, 59, 59, 999);
        filtered = filtered.filter(r => {
          const d = new Date(r[15] || r[4]);
          return !isNaN(d) && d >= sd && d <= ed;
        });
      }
    } else if (type === 'month') {
      const val = document.getElementById('dashMonth')?.value;
      if (val) {
        const [yy, mm] = val.split('-');
        filtered = filtered.filter(r => {
          const d = new Date(r[15] || r[4]);
          return !isNaN(d) && d.getFullYear() == yy && (d.getMonth() + 1) == parseInt(mm, 10);
        });
      }
    } else if (type === 'fy') {
      const targetFy = parseInt(document.getElementById('dashFY')?.value, 10);
      if (targetFy) {
        filtered = filtered.filter(r => {
          const d = new Date(r[15] || r[4]);
          if (isNaN(d)) return false;
          const m = d.getMonth() + 1;
          const y = d.getFullYear() + 543;
          const fy = m >= (window.CONFIG?.FISCAL_START_MONTH || 10) ? y + 1 : y;
          return fy === targetFy;
        });
      }
    }

    return filtered;
  }

  update() {
    const data = this.getFilteredData();
    this.calculateKPIs(data);
    this.renderCharts(data);
  }

  calculateKPIs(data) {
    let totalTrips = data.length;
    let totalKm = 0;
    let totalFuelLiters = 0;
    let totalFuelCost = 0;
    let completedTrips = 0;
    let pendingTrips = 0;

    data.forEach(r => {
      const diffKm = parseFloat(r[19]);
      if (!isNaN(diffKm) && diffKm > 0) {
        totalKm += diffKm;
        completedTrips++;
      } else if (!r[12] || r[12] === '') {
        pendingTrips++;
      }

      const fuelLit = parseFloat(r[20]);
      if (!isNaN(fuelLit) && fuelLit > 0) totalFuelLiters += fuelLit;

      const fuelBaht = parseFloat(r[21]);
      if (!isNaN(fuelBaht) && fuelBaht > 0) totalFuelCost += fuelBaht;
    });

    const avgKmPerTrip = completedTrips > 0 ? (totalKm / completedTrips).toFixed(1) : '0';

    const setElem = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setElem('kpiTotalTrips', totalTrips.toLocaleString('th-TH'));
    setElem('kpiTotalKm', totalKm.toLocaleString('th-TH', { maximumFractionDigits: 1 }) + ' กม.');
    setElem('kpiTotalFuelCost', '฿' + totalFuelCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setElem('kpiTotalFuelLiters', totalFuelLiters.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ลิตร');
    setElem('kpiCompletedTrips', completedTrips.toLocaleString('th-TH'));
    setElem('kpiAvgKm', avgKmPerTrip + ' กม./เที่ยว');
  }

  renderCharts(data) {
    const dailyCounts = {};
    const carCounts = {};
    const driverCounts = {};
    const carKMs = {};
    const typeCounts = {};

    data.forEach(r => {
      const dVal = r[15] || r[4];
      if (!dVal) return;

      const st = new Date(dVal);
      if (isNaN(st)) return;
      let en = new Date(r[16] || r[5]);
      if (isNaN(en)) en = st;

      let current = new Date(st);
      current.setHours(0, 0, 0, 0);
      const endDay = new Date(en);
      endDay.setHours(0, 0, 0, 0);

      let daysCount = 0;
      while (current <= endDay) {
        const dd = ('0' + current.getDate()).slice(-2);
        const mm = ('0' + (current.getMonth() + 1)).slice(-2);
        const yy = (current.getFullYear() + 543).toString().slice(-2);
        const dateStr = `${dd}/${mm}/${yy}`;
        dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
        current.setDate(current.getDate() + 1);
        daysCount++;
      }
      if (daysCount === 0) daysCount = 1;

      const plate = r[13];
      if (plate && plate.trim() !== '') {
        carCounts[plate] = (carCounts[plate] || 0) + daysCount;

        const kmSt = parseFloat(r[17]);
        const kmEn = parseFloat(r[18]);
        if (!carKMs[plate]) carKMs[plate] = { min: Infinity, max: -Infinity };
        if (!isNaN(kmSt) && kmSt < carKMs[plate].min) carKMs[plate].min = kmSt;
        if (!isNaN(kmEn) && kmEn > carKMs[plate].max) carKMs[plate].max = kmEn;
      }

      const driver = r[12];
      if (driver && driver.trim() !== '') {
        driverCounts[driver] = (driverCounts[driver] || 0) + daysCount;
      }

      const cType = r[11] || 'ไม่ระบุ';
      typeCounts[cType] = (typeCounts[cType] || 0) + 1;
    });

    const carKmLabels = [];
    const carKmData = [];
    for (let p in carKMs) {
      if (carKMs[p].min !== Infinity && carKMs[p].max !== -Infinity) {
        const diff = carKMs[p].max - carKMs[p].min;
        if (diff > 0) {
          carKmLabels.push(p);
          carKmData.push(diff);
        }
      }
    }

    // 1. กราฟเส้นความถี่รายวัน
    this.createLineChart(
      'chartDaily',
      'จำนวนการใช้รถ (ครั้ง/วัน)',
      Object.keys(dailyCounts),
      Object.values(dailyCounts),
      '#3b82f6'
    );

    // 2. กราฟแท่งจำนวนครั้งแต่ละคัน
    this.createBarChart(
      'chartCarCount',
      'จำนวนครั้งที่ใช้รถแต่ละคัน (วัน)',
      Object.keys(carCounts),
      Object.values(carCounts),
      '#10b981',
      true
    );

    // 3. กราฟแท่งจำนวนครั้ง พขร.
    this.createBarChart(
      'chartDriverCount',
      'จำนวนภารกิจของ พขร. (วัน)',
      Object.keys(driverCounts),
      Object.values(driverCounts),
      '#f59e0b',
      true
    );

    // 4. กราฟแท่งระยะทางสะสม
    this.createBarChart(
      'chartCarKm',
      'ระยะทางที่ขับรวม (กิโลเมตร)',
      carKmLabels,
      carKmData,
      '#e11d48',
      true
    );

    // 5. กราฟโดนัทประเภทการใช้รถ
    this.createDoughnutChart(
      'chartCarType',
      'สัดส่วนประเภทการใช้รถ',
      Object.keys(typeCounts),
      Object.values(typeCounts)
    );
  }

  createLineChart(canvasId, label, labels, data, color) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    if (this.charts[canvasId]) this.charts[canvasId].destroy();

    const tc = this.getThemeColors();
    const ctx = el.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    this.charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: data,
          borderColor: color,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: color
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            titleFont: { family: 'Prompt' },
            bodyFont: { family: 'Sarabun' },
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: tc.tickColor, font: { family: 'Sarabun' } } },
          y: { beginAtZero: true, grid: { color: tc.gridColor }, ticks: { color: tc.tickColor, stepSize: 1, font: { family: 'Prompt' } } }
        }
      }
    });
  }

  createBarChart(canvasId, label, labels, data, color, isHorizontal = false) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    if (this.charts[canvasId]) this.charts[canvasId].destroy();

    const tc = this.getThemeColors();
    const ctx = el.getContext('2d');
    this.charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: data,
          backgroundColor: color,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: isHorizontal ? 'y' : 'x',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            titleFont: { family: 'Prompt' },
            bodyFont: { family: 'Sarabun' },
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: tc.gridColor }, ticks: { color: tc.tickColor, font: { family: 'Sarabun' } } },
          y: { beginAtZero: true, grid: { display: false }, ticks: { color: tc.tickColor, font: { family: 'Sarabun' } } }
        }
      }
    });
  }

  createDoughnutChart(canvasId, label, labels, data) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    if (this.charts[canvasId]) this.charts[canvasId].destroy();

    const tc = this.getThemeColors();
    const palette = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#6366f1', '#eab308', '#ec4899', '#64748b', '#14b8a6'
    ];

    const ctx = el.getContext('2d');
    this.charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          label: label,
          data: data,
          backgroundColor: palette.slice(0, labels.length),
          borderWidth: 2,
          borderColor: tc.doughnutBorder
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: tc.tickColor, font: { family: 'Sarabun', size: 12 }, boxWidth: 12 }
          },
          tooltip: {
            backgroundColor: tc.tooltipBg,
            titleFont: { family: 'Prompt' },
            bodyFont: { family: 'Sarabun' },
            padding: 10,
            cornerRadius: 8
          }
        },
        cutout: '65%'
      }
    });
  }
}

window.CarDashboard = CarDashboard;
