/**
 * ระบบบริหารจัดการยานพาหนะและรถพยาบาล - โรงพยาบาลไทรโยค (Car 2)
 * Main Application Logic & Controller
 */

// Global State
let globalData = [];
let carList = [];
let userList = [];
let driverList = [];

let unlockedAssign = false;
let unlockedDriver = false;
let unlockedOil = false;
let unlockedAdmin = false;

let isFetchingData = false;
let isFetchingOil = false;

let oilPendingList = [];
let oilHistoryList = [];

// Modules Instances
let carCalendar = null;
let carDashboard = null;
let sigPad1 = null;
let sigPad2 = null;

// Modals Instances
let modalAssign = null;
let modalDriver = null;
let modalView = null;
let modalAdminEdit = null;
let modalOilReq = null;
let modalOilPen = null;
let modalOilApp = null;
let modalOilRep = null;

/* ==========================================================================
   1. API Communication
   ========================================================================== */

async function fetchAPI(action, payload = null, timeoutMs = 40000) {
  const url = window.CONFIG?.WEB_APP_URL || '';
  const bodyObj = payload !== null ? { action, payload } : { action };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(bodyObj),
      signal: controller ? controller.signal : undefined
    });
    if (timeoutId) clearTimeout(timeoutId);

    const text = await res.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('ไม่พบเพจ') || text.includes('ขออภัย')) {
        throw new Error('Google Apps Script ตอบกลับเป็นหน้าเว็บข้อผิดพลาด (HTML)\nสาเหตุ: ยังไม่ได้ตั้งค่าสิทธิ์การเข้าถึงเป็น "ทุกคน (Anyone)" หรือยังไม่ได้ตั้ง "ดำเนินการในฐานะ (Execute as)" เป็น "ฉัน (Me)"');
      }
      throw new Error('ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: ' + parseErr.message);
    }

    return data;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn(`API call [${action}] timed out after ${timeoutMs}ms`);
      throw new Error(`การเชื่อมต่อใช้เวลานานเกินไป (${Math.round(timeoutMs/1000)}s) กรุณาลองใหม่อีกครั้ง`);
    }
    console.warn(`API call [${action}] failed:`, err);
    throw err;
  }
}

async function callAPI(action, payload) {
  Swal.fire({
    title: 'กำลังประมวลผล...',
    html: '<div class="text-muted small">โปรดรอสักครู่ ระบบกำลังเชื่อมต่อฐานข้อมูล</div>',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const data = await fetchAPI(action, payload);
    if (data.status !== 'success') {
      throw new Error(data.message || 'การทำงานไม่สำเร็จ');
    }
    return data;
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'ข้อผิดพลาดระบบ',
      text: err.message,
      confirmButtonText: 'ตกลง'
    });
    throw err;
  }
}

/* ==========================================================================
   2. Options & Master Data (Smart Cache & Resilience)
   ========================================================================== */

const CACHE_KEY_OPTIONS = 'car3_master_options';
const CACHE_KEY_DATA = 'car3_global_data_cache';

/**
 * ฟังก์ชันช่วยแปลง Date ที่ปลอดภัย รองรับทั้ง ISO String, วันที่ไทย dd/mm/yyyy พ.ศ./ค.ศ.
 */
function parseSafeDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();

  // 1. ดักจับรูปแบบ dd/mm/yyyy หรือ dd/mm/yyyy hh:mm:ss (เช่นใน Google Sheet)
  const thaiMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
  if (thaiMatch) {
    const d = parseInt(thaiMatch[1], 10);
    const m = parseInt(thaiMatch[2], 10) - 1;
    let y = parseInt(thaiMatch[3], 10);
    if (y > 2500) y -= 543;
    const timeParts = (thaiMatch[4] || '').trim().split(':');
    const hh = parseInt(timeParts[0], 10) || 0;
    const mm = parseInt(timeParts[1], 10) || 0;
    const ss = parseInt(timeParts[2], 10) || 0;
    return new Date(y, m, d, hh, mm, ss);
  }

  // 2. ดักจับรูปแบบ yyyy-mm-dd ที่ปีเป็น พ.ศ. (> 2500)
  const beMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (beMatch && parseInt(beMatch[1], 10) > 2500) {
    const y = parseInt(beMatch[1], 10) - 543;
    const m = parseInt(beMatch[2], 10) - 1;
    const d = parseInt(beMatch[3], 10);
    const timeParts = (beMatch[4] || '').trim().replace(/^T/, '').split(':');
    const hh = parseInt(timeParts[0], 10) || 0;
    const mm = parseInt(timeParts[1], 10) || 0;
    const ss = parseInt(timeParts[2], 10) || 0;
    return new Date(y, m, d, hh, mm, ss);
  }

  // 3. รูปแบบ ISO มาตรฐาน เช่น 2026-09-29T04:00:00.000Z หรือ 2026-09-29T11:00
  // ใช้ Date parser มาตรฐานของเบราว์เซอร์ ซึ่งจะคำนวณ Timezone ท้องถิ่น (UTC+7 สำหรับไทย) ให้อัตโนมัติและถูกต้อง
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * ดึงข้อมูลตารางและคิวรถจาก localStorage ทันทีที่เปิดหน้าเว็บ (0ms)
 * ทำให้หน้าเว็บพร้อมใช้งานทันที ไม่ต้องรอดาวน์โหลด 650KB จาก Google Apps Script
 */
function initCachedData() {
  try {
    const raw = localStorage.getItem(CACHE_KEY_DATA);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        globalData = parsed;
        renderTables();
        updateBadgeCounters();
        if (typeof renderCalendar === 'function' && document.getElementById('page-calendar')?.classList.contains('active')) {
          renderCalendar();
        }
        if (carDashboard) {
          carDashboard.setData(globalData);
        }
        updateSyncBadge('online', 'ออนไลน์ (พร้อมใช้จากแคช)');
        console.log(`[Cache] โหลดประวัติการใช้รถจากเครื่องทันที: ${globalData.length} รายการ (0ms)`);
        return true;
      }
    }
  } catch (e) {
    console.warn('[Cache] initCachedData error:', e);
  }
  return false;
}

/**
 * บันทึกข้อมูลคิวรถลง localStorage เพื่อความรวดเร็วและพร้อมใช้งานแบบออฟไลน์
 */
function saveLocalDataCache(data) {
  try {
    if (Array.isArray(data) && data.length > 0) {
      localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(data));
    }
  } catch (e) {
    console.warn('[Cache] saveLocalDataCache error:', e);
  }
}

/**
 * ดึงข้อมูล Master Data จาก localStorage ทันทีที่เปิดหน้าเว็บ (0ms)
 * ช่วยให้ Dropdown มีข้อมูลแสดงทันทีโดยไม่ต้องรอโหลดเสร็จจาก Google Apps Script
 */
function initCachedOptions() {
  try {
    const raw = localStorage.getItem(CACHE_KEY_OPTIONS);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && (cached.users?.length || cached.drivers?.length || cached.cars?.length)) {
        userList = cached.users || [];
        driverList = cached.drivers || [];
        carList = cached.cars || [];
      }
    }
  } catch (err) {
    console.warn('[Cache] ไม่สามารถอ่านแคชตัวเลือกได้:', err);
  }

  // หากในเครื่องยังไม่มีแคช หรือข้อมูลยังไม่ครบ ให้ใช้ Master Data เริ่มต้นจาก config.js ทันที (0ms)
  if (window.CONFIG?.MASTER_DATA) {
    if (!userList.length && window.CONFIG.MASTER_DATA.users) {
      userList = [...window.CONFIG.MASTER_DATA.users];
    }
    if (!driverList.length && window.CONFIG.MASTER_DATA.drivers) {
      driverList = [...window.CONFIG.MASTER_DATA.drivers];
    }
    if (!carList.length && window.CONFIG.MASTER_DATA.cars) {
      carList = [...window.CONFIG.MASTER_DATA.cars];
    }
  }

  if (userList.length > 0 || driverList.length > 0 || carList.length > 0) {
    populateUserSelect();
    populateDriverSelects();
    populateCarSelects();
    console.log(`[MasterData] ตัวเลือกพร้อมใช้งานทันที (0ms): ผู้ขอ ${userList.length} คน, พขร. ${driverList.length} คน, รถ ${carList.length} คัน`);
    return true;
  }
  return false;
}

/**
 * ดึงข้อมูล Master Data ล่าสุดจาก Google Apps Script พร้อมระบบ Auto-Retry
 * และเก็บลง localStorage เพื่อให้ใช้งานได้ออฟไลน์/รวดเร็วในครั้งถัดไป
 */
async function loadOptions(forceRefresh = false, retries = 1) {
  // หากยังไม่มีข้อมูลในแรม ให้ลองดึงจาก Cache ทันทีเป็นอันดับแรก
  if (!userList.length || !driverList.length || !carList.length) {
    initCachedOptions();
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const payload = forceRefresh ? { forceRefresh: true } : null;
      const json = await fetchAPI('getOptions', payload, 10000);
      if (json && json.status === 'success' && json.data) {
        const d = json.data;
        const newUsers = d.users || [];
        const newDrivers = d.drivers || [];
        const newCars = d.cars || [];

        if (newUsers.length > 0) userList = newUsers;
        if (newDrivers.length > 0) driverList = newDrivers;
        if (newCars.length > 0) carList = newCars;

        // บันทึกลง localStorage ทันที
        try {
          localStorage.setItem(CACHE_KEY_OPTIONS, JSON.stringify({
            users: userList,
            drivers: driverList,
            cars: carList,
            updatedAt: new Date().toISOString()
          }));
        } catch (storageErr) {
          console.warn('[Cache] บันทึกแคชลงเครื่องไม่สำเร็จ:', storageErr);
        }

        populateUserSelect();
        populateDriverSelects();
        populateCarSelects();
        console.log(`[Options] ซิงค์ตัวเลือกล่าสุดสำเร็จ (รอบที่ ${attempt}): ผู้ขอ ${userList.length}, พขร. ${driverList.length}, รถ ${carList.length}`);
        return true;
      }
    } catch (err) {
      console.warn(`[Options] ซิงค์ตัวเลือกรอบที่ ${attempt} ไม่สำเร็จ:`, err.message || err);
      if (attempt <= retries) {
        // หน่วงเวลาก่อนลองใหม่: 1.2s, 2.4s...
        await new Promise(r => setTimeout(r, attempt * 1200));
      }
    }
  }

  // หากดึงจากเซิร์ฟเวอร์ไม่ได้และยังไม่มีข้อมูลเลย ให้เตรียมโครงสร้างเริ่มต้น
  if (!userList.length || !driverList.length || !carList.length) {
    populateUserSelect();
    populateDriverSelects();
    populateCarSelects();
  }
  return false;
}

/**
 * ปุ่มกดรีเฟรชรายชื่อ Master Data ด้วยตนเอง (Manual Refresh)
 */
async function refreshOptionsManual(btnEl) {
  const icon = btnEl ? btnEl.querySelector('i') : null;
  if (icon) icon.classList.add('spin-animation');
  if (btnEl) btnEl.disabled = true;

  try {
    const success = await loadOptions(true, 1);
    if (window.Swal) {
      const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true
      });
      Toast.fire({
        icon: success ? 'success' : 'info',
        title: success ? 'อัปเดตรายชื่อและข้อมูลรถเรียบร้อย' : 'ใช้ข้อมูลสำรองล่าสุดในระบบ'
      });
    }
  } catch (e) {
    console.error('Manual refresh error:', e);
  } finally {
    if (icon) icon.classList.remove('spin-animation');
    if (btnEl) btnEl.disabled = false;
  }
}

/**
 * ตาข่ายสำรอง (Safety Net): ดึงรายชื่อผู้ขอ, พขร., และรถ จากประวัติการขอใช้รถ (globalData)
 * ในกรณีที่เครื่องใหม่ยังไม่มีแคช และ getOptions เกิดความขัดข้องทางเน็ตเวิร์ก
 */
function fallbackHarvestFromData() {
  if (!globalData || !globalData.length) return;

  let needUpdate = false;

  // 1. เก็บตกรายชื่อผู้ขอและกลุ่มงาน (คอลัมน์ 3 และ 4)
  if (!userList || userList.length === 0) {
    const userMap = new Map();
    globalData.forEach(row => {
      const name = String(row[2] || '').trim();
      const group = String(row[3] || '').trim();
      if (name && !userMap.has(name)) {
        userMap.set(name, group);
      }
    });
    if (userMap.size > 0) {
      userList = Array.from(userMap.entries()).map(([name, group]) => ({ name, group }));
      needUpdate = true;
      console.log(`[Safety Net] ดึงรายชื่อผู้ขอ ${userList.length} คน จากประวัติสำเร็จ`);
    }
  }

  // 2. เก็บตกรายชื่อพนักงานขับรถ (คอลัมน์ 13)
  if (!driverList || driverList.length === 0) {
    const driverSet = new Set();
    globalData.forEach(row => {
      const d = String(row[12] || '').trim();
      if (d) driverSet.add(d);
    });
    if (driverSet.size > 0) {
      driverList = Array.from(driverSet).sort();
      needUpdate = true;
      console.log(`[Safety Net] ดึงรายชื่อ พขร. ${driverList.length} คน จากประวัติสำเร็จ`);
    }
  }

  // 3. เก็บตกข้อมูลรถและรุ่น (คอลัมน์ 14 และ 15)
  if (!carList || carList.length === 0) {
    const carMap = new Map();
    globalData.forEach(row => {
      const plate = String(row[13] || '').trim();
      const model = String(row[14] || '').trim();
      if (plate && !carMap.has(plate)) {
        carMap.set(plate, model);
      }
    });
    if (carMap.size > 0) {
      carList = Array.from(carMap.entries()).map(([plate, model]) => ({ plate, model }));
      needUpdate = true;
      console.log(`[Safety Net] ดึงข้อมูลรถ ${carList.length} คัน จากประวัติสำเร็จ`);
    }
  }

  if (needUpdate) {
    populateUserSelect();
    populateDriverSelects();
    populateCarSelects();
    try {
      localStorage.setItem(CACHE_KEY_OPTIONS, JSON.stringify({
        users: userList,
        drivers: driverList,
        cars: carList,
        updatedAt: new Date().toISOString(),
        source: 'harvested_from_history'
      }));
    } catch (e) {}
  }
}

function populateUserSelect() {
  const el = document.getElementById('req_c');
  if (!el) return;

  const curVal = $(el).val() || el.value || '';

  if (userList.length === 0) {
    el.innerHTML = '<option value="" disabled selected>กำลังโหลดรายชื่อผู้ขอ...</option>';
    return;
  }

  let html = '<option value="" disabled selected>เลือกหรือค้นหาชื่อผู้ขอ...</option>';
  userList.forEach(u => {
    html += `<option value="${u.name}">${u.name}</option>`;
  });
  el.innerHTML = html;

  if (curVal) {
    el.value = curVal;
  }

  if (window.jQuery && $.fn.select2) {
    if ($(el).data('select2') || $(el).hasClass('select2-hidden-accessible')) {
      try { $(el).select2('destroy'); } catch (e) {}
    }
    $(el).select2({
      theme: 'bootstrap-5',
      placeholder: 'พิมพ์ค้นหาชื่อผู้ขอ...',
      width: '100%'
    });
    if (curVal) {
      $(el).val(curVal).trigger('change.select2');
    }
  }
}

function populateDriverSelects() {
  const driverSel = document.getElementById('assign_m');
  const filterSel = document.getElementById('filterDriver');

  if (driverSel) {
    const curVal = driverSel.value || '';
    if (driverList.length === 0) {
      driverSel.innerHTML = '<option value="" disabled selected>กำลังโหลดพนักงานขับรถ...</option>';
    } else {
      let html = '<option value="" disabled selected>เลือกพนักงานขับรถ...</option>';
      driverList.forEach(d => {
        html += `<option value="${d}">${d}</option>`;
      });
      driverSel.innerHTML = html;
      if (curVal) driverSel.value = curVal;
    }
  }

  if (filterSel) {
    const curFilter = filterSel.value || '';
    let html = '<option value="">-- กรองผู้ขับรถทั้งหมด --</option>';
    driverList.forEach(d => {
      html += `<option value="${d}">${d}</option>`;
    });
    filterSel.innerHTML = html;
    if (curFilter) filterSel.value = curFilter;
  }
}

function populateCarSelects() {
  const plateSelect = document.getElementById('assign_n');
  const oilCarSelect = document.getElementById('oilCar');

  if (plateSelect) {
    const curVal = $(plateSelect).val() || plateSelect.value || '';
    if (carList.length === 0) {
      plateSelect.innerHTML = '<option value="" disabled selected>กำลังโหลดข้อมูลรถ...</option>';
    } else {
      let html = '<option value="" disabled selected>เลือกทะเบียนรถ</option>';
      carList.forEach(c => {
        html += `<option value="${c.plate}">${c.plate} - ${c.model || ''}</option>`;
      });
      plateSelect.innerHTML = html;
      if (curVal) plateSelect.value = curVal;
    }

    if (window.jQuery && $.fn.select2) {
      if ($(plateSelect).data('select2') || $(plateSelect).hasClass('select2-hidden-accessible')) {
        try { $(plateSelect).select2('destroy'); } catch (e) {}
      }
      $(plateSelect).select2({
        theme: 'bootstrap-5',
        dropdownParent: $('#modalAssign'),
        placeholder: 'เลือกทะเบียนรถ...',
        width: '100%'
      });
      if (curVal) {
        $(plateSelect).val(curVal).trigger('change.select2');
      }
    }
  }

  if (oilCarSelect) {
    const curOilVal = oilCarSelect.value || '';
    let html = '<option value="">-- เลือกทะเบียนรถ (ถ้ามี) --</option>';
    carList.forEach(c => {
      html += `<option value="${c.plate}">${c.plate} - ${c.model || ''}</option>`;
    });
    oilCarSelect.innerHTML = html;
    if (curOilVal) oilCarSelect.value = curOilVal;
  }
}

/* ==========================================================================
   3. Main Data Loading & Syncing
   ========================================================================== */

let hasPendingDataRefresh = false;

async function loadData(silent = true, forceRefresh = false) {
  if (isFetchingData) {
    hasPendingDataRefresh = true;
    return;
  }
  isFetchingData = true;

  updateSyncBadge('syncing', forceRefresh ? 'กำลังรีเฟรชฐานข้อมูล...' : 'กำลังอัปเดตข้อมูล...');
  if (!silent) {
    Swal.fire({
      title: forceRefresh ? 'กำลังรีเฟรชข้อมูลจากฐานข้อมูล...' : 'กำลังดึงข้อมูลล่าสุด...',
      html: '<div class="text-muted small">เชื่อมต่อ Google Apps Script (กำลังตรวจสอบข้อมูลล่าสุด)</div>',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });
  }

  try {
    let json = null;
    let lastErr = null;

    // ลองดึงข้อมูลหลัก (Timeout 40s)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        json = await fetchAPI('getData', forceRefresh ? { forceRefresh: true } : null, 40000);
        if (json && json.status === 'success') break;
        throw new Error(json?.message || 'สถานะไม่สำเร็จ');
      } catch (e) {
        lastErr = e;
        if (attempt < 2) {
          console.warn(`[LoadData] รอบที่ ${attempt} ไม่สำเร็จ กำลังลองใหม่ใน 1.2 วินาที...`, e);
          await new Promise(r => setTimeout(r, 1200));
        }
      }
    }

    if (!json || json.status !== 'success') {
      throw lastErr || new Error('ไม่สามารถดึงข้อมูลจากเซิร์ฟเวอร์ได้');
    }

    if (Array.isArray(json.data) && json.data.length > 0) {
      globalData = json.data;
      saveLocalDataCache(globalData);
    } else if (Array.isArray(json.data) && json.data.length === 0 && globalData.length === 0) {
      globalData = [];
    } else {
      console.warn('[LoadData] ข้อมูลจากเซิร์ฟเวอร์ว่างเปล่าหรือไม่ถูกต้อง จะคงข้อมูลเดิมไว้ในระบบ:', json?.data);
    }

    // ตาข่ายสำรอง (Safety Net): หากรายชื่อหรือรถยังว่างเปล่า ให้ดึงจากประวัติการขอใช้รถทันที
    if (!userList.length || !driverList.length || !carList.length) {
      fallbackHarvestFromData();
    }

    renderTables();

    // อัปเดตปฏิทิน
    if (typeof renderCalendar === 'function' && document.getElementById('page-calendar')?.classList.contains('active')) {
      setTimeout(() => renderCalendar(), 50);
    }

    // อัปเดตแดชบอร์ด
    if (carDashboard) {
      carDashboard.setData(globalData);
    }

    updateBadgeCounters();
    updateSyncBadge('online', 'ออนไลน์ (ซิงค์แล้ว)');

    if (!silent) {
      Swal.fire({
        icon: 'success',
        title: 'ซิงค์ข้อมูลสำเร็จ',
        text: `อัปเดตข้อมูลล่าสุด ${globalData.length.toLocaleString()} รายการแล้ว`,
        timer: 1500,
        showConfirmButton: false
      });
    }

    // หลังจากโหลดข้อมูลหลักสำเร็จและระบบออนไลน์แล้ว ให้ลองซิงค์ Options ใน Background อย่างเงียบๆ
    setTimeout(() => {
      loadOptions(false, 1).catch(err => console.warn('[Background Options] Sync notice:', err));
    }, 800);
  } catch (err) {
    console.error('Load Data Error:', err);
    updateSyncBadge('offline', 'ออฟไลน์ / มีข้อผิดพลาด');
    if (!silent) {
      Swal.fire('ข้อผิดพลาด', 'โหลดข้อมูลไม่สำเร็จ: ' + err.message, 'error');
    }
  } finally {
    isFetchingData = false;
    if (hasPendingDataRefresh) {
      hasPendingDataRefresh = false;
      setTimeout(() => loadData(true), 250);
    }
  }
}

function updateSyncBadge(status, text) {
  const badge = document.getElementById('syncStatusBadge');
  if (!badge) return;

  badge.title = 'คลิกเพื่อรีเฟรชและซิงค์ข้อมูลล่าสุดกับ Google Sheets';
  badge.style.cursor = 'pointer';

  if (!badge._hasClickListener) {
    badge._hasClickListener = true;
    badge.addEventListener('click', () => {
      loadData(false, true);
    });
  }

  if (status === 'online') {
    badge.className = 'sync-status-badge';
    badge.style.borderColor = '#10b981';
    badge.style.background = '#ecfdf5';
    badge.style.color = '#065f46';
    badge.innerHTML = '<span class="dot" style="background-color:#10b981;"></span> ' + text + ' <i class="bi bi-arrow-repeat ms-1" style="font-size:0.8rem;opacity:0.75" title="กดเพื่อซิงค์"></i>';
  } else if (status === 'syncing') {
    badge.className = 'sync-status-badge';
    badge.style.borderColor = '#93c5fd';
    badge.style.background = '#eff6ff';
    badge.style.color = '#1e40af';
    badge.innerHTML = '<span class="dot" style="background-color:#3b82f6;"></span> ' + text + ' <span class="spinner-border spinner-border-sm ms-1" style="width:0.7rem;height:0.7rem;border-width:1.5px;"></span>';
  } else {
    badge.className = 'sync-status-badge';
    badge.style.borderColor = '#fca5a5';
    badge.style.background = '#fef2f2';
    badge.style.color = '#991b1b';
    badge.innerHTML = '<span class="dot" style="background-color:#ef4444;"></span> ' + text + ' <i class="bi bi-arrow-clockwise ms-1" style="font-size:0.8rem" title="กดเพื่อลองใหม่"></i>';
  }
}

function updateBadgeCounters() {
  let pendingAssign = 0;
  let pendingDriver = 0;

  globalData.forEach(row => {
    if (!row || !row[0]) return;
    const driver = row[12];
    const diffKm = row[19];

    if (driver && String(driver).includes('ยกเลิก')) return;

    if (!driver || String(driver).trim() === '') {
      pendingAssign++;
    } else if (diffKm === '' || diffKm === null || diffKm === undefined) {
      pendingDriver++;
    }
  });

  const bAssign = document.getElementById('badgeCountAssign');
  const bDriver = document.getElementById('badgeCountDriver');

  if (bAssign) {
    bAssign.textContent = pendingAssign;
    bAssign.style.display = pendingAssign > 0 ? 'inline-block' : 'none';
  }

  if (bDriver) {
    bDriver.textContent = pendingDriver;
    bDriver.style.display = pendingDriver > 0 ? 'inline-block' : 'none';
  }
}

/* ==========================================================================
   4. Table Rendering & DataTables
   ========================================================================== */

const DATATABLES_THAI_LANG = {
  emptyTable: "ไม่มีข้อมูลในตาราง",
  info: "แสดง _START_ ถึง _END_ จากทั้งหมด _TOTAL_ รายการ",
  infoEmpty: "แสดง 0 ถึง 0 จาก 0 รายการ",
  infoFiltered: "(กรองจากทั้งหมด _MAX_ รายการ)",
  lengthMenu: "แสดง _MENU_ รายการ",
  loadingRecords: "กำลังโหลด...",
  processing: "กำลังประมวลผล...",
  search: "ค้นหา:",
  zeroRecords: "ไม่พบข้อมูลที่ค้นหา",
  paginate: {
    first: "หน้าแรก",
    last: "หน้าสุดท้าย",
    next: "ถัดไป",
    previous: "ก่อนหน้า"
  }
};

function formatDateUI(dStr) {
  if (!dStr) return '-';
  const d = parseSafeDate(dStr);
  if (!d) return dStr;

  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  // แสดงผลแบบใน Google Sheet: dd/mm/yyyy hh:mm:ss เช่น 29/09/2026 11:00:00
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

/* ==========================================================================
   4. Table Rendering & Mobile Cards Management
   ========================================================================== */

const tableViewModes = {
  assign: window.innerWidth < 768 ? 'cards' : 'table',
  driver: window.innerWidth < 768 ? 'cards' : 'table',
  report: window.innerWidth < 768 ? 'cards' : 'table'
};

let currentDriverCardsData = [];
let currentReportCardsData = [];
let reportCardsLimit = 15;

function switchTableViewMode(pageKey, mode) {
  tableViewModes[pageKey] = mode;
  const cardsCont = document.getElementById(`containerCards_${pageKey}`);
  const tableCont = document.getElementById(`containerTable_${pageKey}`);
  const btnCards = document.getElementById(`btnViewCards_${pageKey}`);
  const btnTable = document.getElementById(`btnViewTable_${pageKey}`);
  const searchBox = document.getElementById(`cardSearch_${pageKey}`);

  if (mode === 'cards') {
    if (cardsCont) cardsCont.style.display = 'block';
    if (tableCont) tableCont.style.display = 'none';
    if (searchBox) searchBox.style.display = 'block';
    if (btnCards) {
      btnCards.className = 'btn btn-sm btn-primary rounded-pill px-3';
    }
    if (btnTable) {
      btnTable.className = 'btn btn-sm btn-outline-secondary border-0 rounded-pill px-3';
    }
  } else {
    if (cardsCont) cardsCont.style.display = 'none';
    if (tableCont) tableCont.style.display = 'block';
    if (searchBox) searchBox.style.display = 'none';
    if (btnCards) {
      btnCards.className = 'btn btn-sm btn-outline-secondary border-0 rounded-pill px-3';
    }
    if (btnTable) {
      btnTable.className = 'btn btn-sm btn-primary rounded-pill px-3';
    }

    setTimeout(() => {
      if ($.fn.DataTable) {
        $.fn.dataTable.tables({ visible: true, api: true }).columns.adjust().responsive.recalc();
      }
    }, 60);
  }
}

function initTableViewModes() {
  const isMobile = window.innerWidth < 768;
  const defaultMode = isMobile ? 'cards' : 'table';
  switchTableViewMode('assign', tableViewModes.assign || defaultMode);
  switchTableViewMode('driver', tableViewModes.driver || defaultMode);
  switchTableViewMode('report', tableViewModes.report || defaultMode);
}

function filterCards(containerId, query) {
  const q = (query || '').toLowerCase().trim();
  const cards = document.querySelectorAll(`#${containerId} .mobile-record-card`);
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? 'block' : 'none';
  });
}

function sortCardsLatestFirst(items) {
  if (!items || !Array.isArray(items)) return [];
  return items.slice().sort((a, b) => {
    // 1. เปรียบเทียบ ID แบบตัวเลขธรรมชาติเรียงจากมากไปน้อย (คำขอล่าสุดอยู่บนสุด)
    if (a.id && b.id && a.id !== b.id) {
      const idCmp = String(b.id).localeCompare(String(a.id), undefined, { numeric: true, sensitivity: 'base' });
      if (idCmp !== 0) return idCmp;
    }
    // 2. ถ้ามี Timestamp วันที่ส่งคำขอ ให้เปรียบเทียบเวลาเรียงจากใหม่ไปเก่า
    if (a.rawTimestamp && b.rawTimestamp) {
      const tA = new Date(a.rawTimestamp).getTime();
      const tB = new Date(b.rawTimestamp).getTime();
      if (!isNaN(tA) && !isNaN(tB) && tA !== tB) {
        return tB - tA;
      }
    }
    // 3. สำรอง: เรียงตามลำดับแถวในสเปรดชีตจากล่างขึ้นบน (แถวที่บันทึกล่าสุดจะอยู่ล่างสุด)
    return (b.rowIndex !== undefined ? b.rowIndex : 0) - (a.rowIndex !== undefined ? a.rowIndex : 0);
  });
}

function renderMobileAssignCards(items) {
  const container = document.getElementById('cardsAssign');
  if (!container) return;

  const sortedItems = sortCardsLatestFirst(items);

  if (!sortedItems || sortedItems.length === 0) {
    container.innerHTML = `
      <div class="empty-records-card">
        <i class="bi bi-inbox"></i>
        <div class="fw-medium">ไม่มีรายการรอจัดรถในขณะนี้</div>
        <small class="text-muted">รายการคำขอที่รอการจัดรถจะแสดงที่นี่</small>
      </div>`;
    return;
  }

  container.innerHTML = sortedItems.map(item => `
    <div class="mobile-record-card">
      <div class="card-top">
        <div class="d-flex align-items-center gap-2">
          <span class="badge bg-primary-subtle text-primary border border-primary-subtle fw-bold font-heading">#${item.id}</span>
          <span class="badge bg-light text-dark border">${item.cType}</span>
        </div>
        <span class="badge-status ${item.badgeClass}">${item.status}</span>
      </div>
      
      <div class="card-details">
        <div class="detail-item">
          <i class="bi bi-clock-history text-primary"></i>
          <div>
            <span class="detail-label">เวลาเดินทาง:</span>
            <span class="detail-val fw-medium">${item.start} <span class="text-danger">ถึง ${item.end}</span></span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-person text-primary"></i>
          <div>
            <span class="detail-label">ผู้ขอใช้รถ:</span>
            <span class="detail-val fw-semibold">${item.req}</span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-geo-alt text-danger"></i>
          <div>
            <span class="detail-label">สถานที่:</span>
            <span class="detail-val">${item.place}</span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-card-text text-muted"></i>
          <div>
            <span class="detail-label">เรื่อง:</span>
            <span class="detail-val text-muted">${item.subj}</span>
          </div>
        </div>
        ${item.isAssigned ? `
        <div class="detail-item bg-light p-2 rounded-3 mt-1">
          <i class="bi bi-check-circle-fill text-success"></i>
          <div>
            <span class="detail-label">รถ/พขร.:</span>
            <span class="detail-val fw-bold text-success">${item.plate || '-'} / ${item.driver}</span>
          </div>
        </div>` : ''}
      </div>

      <div class="card-action">
        ${!item.isAssigned 
          ? `<button class="btn btn-primary w-100 rounded-pill py-2 font-heading shadow-sm" onclick="openAssign('${item.id}')">
               <i class="bi bi-key me-1"></i> จัดรถ / มอบหมายงาน
             </button>`
          : `<button class="btn btn-outline-success w-100 rounded-pill py-2 font-heading" onclick="openAssign('${item.id}')">
               <i class="bi bi-pencil me-1"></i> แก้ไขจัดรถ (${item.plate || item.driver})
             </button>`
        }
      </div>
    </div>
  `).join('');
}

function renderMobileDriverCards(items) {
  currentDriverCardsData = sortCardsLatestFirst(items);
  applyDriverCardsFilter();
}

function applyDriverCardsFilter() {
  const container = document.getElementById('cardsDriver');
  if (!container) return;

  const selectedDriver = ($('#filterDriver').val() || '').trim();
  const searchEl = document.getElementById('cardSearchInput_driver');
  const searchQuery = (searchEl?.value || '').toLowerCase().trim();

  let filtered = currentDriverCardsData;
  if (selectedDriver) {
    filtered = filtered.filter(item => item.driver && item.driver.includes(selectedDriver));
  }
  if (searchQuery) {
    filtered = filtered.filter(item => {
      const text = (item.id + ' ' + item.req + ' ' + item.place + ' ' + item.driver + ' ' + (item.plate || '')).toLowerCase();
      return text.includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-records-card">
        <i class="bi bi-person-x"></i>
        <div class="fw-medium">ไม่พบรายการภารกิจตามเงื่อนไขที่เลือก</div>
        <small class="text-muted">ลองเปลี่ยนตัวกรองผู้ขับรถ หรือล้างคำค้นหา</small>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(item => `
    <div class="mobile-record-card">
      <div class="card-top">
        <div class="d-flex align-items-center gap-2">
          <span class="badge bg-primary-subtle text-primary border border-primary-subtle fw-bold font-heading">#${item.id}</span>
          <span class="badge bg-light text-dark border"><i class="bi bi-truck me-1"></i>${item.plate || '-'}</span>
        </div>
        <span class="badge-status ${item.hasReported ? 'badge-status-completed' : 'badge-status-assigned'}">
          ${item.hasReported ? 'บันทึกแล้ว' : 'รอลงไมล์'}
        </span>
      </div>

      <div class="card-details">
        <div class="detail-item">
          <i class="bi bi-person-badge text-primary"></i>
          <div>
            <span class="detail-label">พขร.:</span>
            <span class="detail-val fw-bold text-primary">${item.driver}</span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-clock-history text-primary"></i>
          <div>
            <span class="detail-label">วันเวลา:</span>
            <span class="detail-val">${item.start} <span class="text-danger">ถึง ${item.end}</span></span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-geo-alt text-danger"></i>
          <div>
            <span class="detail-label">สถานที่:</span>
            <span class="detail-val fw-medium">${item.place}</span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-person text-muted"></i>
          <div>
            <span class="detail-label">ผู้ขอ:</span>
            <span class="detail-val text-muted">${item.req}</span>
          </div>
        </div>
        ${item.hasReported ? `
        <div class="detail-item bg-light p-2 rounded-3 mt-1">
          <i class="bi bi-speedometer2 text-info"></i>
          <div>
            <span class="detail-label">ระยะทาง:</span>
            <span class="detail-val fw-bold text-success">${item.diffKm} กิโลเมตร</span>
          </div>
        </div>` : ''}
      </div>

      <div class="card-action">
        ${!item.hasReported
          ? `<button class="btn btn-warning w-100 rounded-pill py-2 font-heading fw-bold text-dark shadow-sm" onclick="openDriver('${item.id}')">
               <i class="bi bi-speedometer2 me-1"></i> บันทึกเวลา & เลขไมล์
             </button>`
          : `<button class="btn btn-outline-primary w-100 rounded-pill py-2 font-heading" onclick="openDriver('${item.id}')">
               <i class="bi bi-pencil me-1"></i> แก้ไขรายงานไมล์ (${item.diffKm} กม.)
             </button>`
        }
      </div>
    </div>
  `).join('');
}

function renderMobileReportCards(items) {
  currentReportCardsData = sortCardsLatestFirst(items);
  reportCardsLimit = 15;
  applyReportCardsFilter();
}

function applyReportCardsFilter() {
  const container = document.getElementById('cardsReport');
  const paginBtn = document.getElementById('cardsReportPagination');
  if (!container) return;

  const searchEl = document.getElementById('cardSearchInput_report');
  const searchQuery = (searchEl?.value || '').toLowerCase().trim();

  let filtered = currentReportCardsData;
  if (searchQuery) {
    filtered = filtered.filter(item => {
      const text = (item.id + ' ' + item.req + ' ' + item.place + ' ' + (item.driver || '') + ' ' + (item.plate || '') + ' ' + item.status).toLowerCase();
      return text.includes(searchQuery);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-records-card">
        <i class="bi bi-search"></i>
        <div class="fw-medium">ไม่พบประวัติการใช้รถตามที่ค้นหา</div>
      </div>`;
    if (paginBtn) paginBtn.style.display = 'none';
    return;
  }

  const visibleItems = filtered.slice(0, reportCardsLimit);

  container.innerHTML = visibleItems.map(item => `
    <div class="mobile-record-card">
      <div class="card-top">
        <div class="d-flex align-items-center gap-2">
          <span class="badge bg-primary-subtle text-primary border border-primary-subtle fw-bold font-heading">#${item.id}</span>
          ${item.printCount > 0 ? `<span class="badge bg-info-subtle text-info-emphasis border border-info-subtle">พิมพ์ ${item.printCount}</span>` : ''}
        </div>
        <span class="badge-status ${item.badgeClass}">${item.status}</span>
      </div>

      <div class="card-details">
        <div class="detail-item">
          <i class="bi bi-calendar3 text-primary"></i>
          <div>
            <span class="detail-label">วันเวลา:</span>
            <span class="detail-val">${item.start} <span class="text-danger">ถึง ${item.end}</span></span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-person text-primary"></i>
          <div>
            <span class="detail-label">ผู้ขอ:</span>
            <span class="detail-val fw-medium">${item.req}</span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-geo-alt text-danger"></i>
          <div>
            <span class="detail-label">สถานที่:</span>
            <span class="detail-val">${item.place}</span>
          </div>
        </div>
        <div class="detail-item">
          <i class="bi bi-truck text-muted"></i>
          <div>
            <span class="detail-label">รถ / พขร.:</span>
            <span class="detail-val">${item.plate || '-'} / ${item.driver || '-'}</span>
          </div>
        </div>
        ${item.diffKm !== '' && item.diffKm !== null && item.diffKm !== undefined ? `
        <div class="detail-item">
          <i class="bi bi-speedometer2 text-info"></i>
          <div>
            <span class="detail-label">ระยะทาง:</span>
            <span class="detail-val fw-bold text-success">${item.diffKm} กม.</span>
          </div>
        </div>` : ''}
      </div>

      <div class="card-action d-flex gap-2">
        <button class="btn btn-outline-primary flex-fill rounded-pill py-2 font-heading" onclick="openView('${item.id}', false)">
          <i class="bi bi-search me-1"></i> ดูรายละเอียด
        </button>
        <button class="btn btn-primary rounded-pill px-3 py-2 font-heading" onclick="openView('${item.id}', true)" title="สั่งพิมพ์เอกสาร A4">
          <i class="bi bi-printer"></i>
        </button>
      </div>
    </div>
  `).join('');

  if (paginBtn) {
    paginBtn.style.display = filtered.length > reportCardsLimit ? 'block' : 'none';
  }
}

function loadMoreReportCards() {
  reportCardsLimit += 15;
  applyReportCardsFilter();
}

function renderTables() {
  let assignData = [];
  let driverData = [];
  let reportData = [];

  let assignCardsList = [];
  let driverCardsList = [];
  let reportCardsList = [];

  globalData.forEach((row, rowIndex) => {
    if (!row || !row[0]) return;
    const id = row[0];
    const rawTimestamp = row[1];
    const start = formatDateUI(row[4]);
    const end = formatDateUI(row[5]);
    const req = row[2] || '-';
    const subj = row[6] || '-';
    const place = row[7] || '-';
    const cType = row[11] || '-';
    const driver = row[12];
    const plate = row[13];
    const diffKm = row[19];
    const printCount = parseInt(row[23], 10) || 0;

    let status = 'รอจัดรถ';
    let badgeClass = 'badge-status-pending';

    if (driver) {
      if (String(driver).includes('ยกเลิก')) {
        status = 'ยกเลิก';
        badgeClass = 'badge-status-cancelled';
      } else if (diffKm !== '' && diffKm !== null && diffKm !== undefined) {
        status = 'เสร็จสิ้น';
        badgeClass = 'badge-status-completed';
      } else {
        status = 'รอขับรถ';
        badgeClass = 'badge-status-assigned';
      }
    }

    // 1. ตารางจัดรถ (Assign Table & Cards)
    if (id && (!driver || !String(driver).includes('ยกเลิก'))) {
      const isAssigned = driver && driver.trim() !== '';
      const assignBtn = !isAssigned
        ? `<button class="btn btn-sm btn-primary rounded-pill px-3" onclick="openAssign('${id}')"><i class="bi bi-key me-1"></i>จัดรถ</button>`
        : `<button class="btn btn-sm btn-outline-success rounded-pill px-3" onclick="openAssign('${id}')"><i class="bi bi-pencil me-1"></i>แก้ไข (${plate || driver})</button>`;

      assignData.push([
        assignBtn,
        `<span class="fw-bold font-heading text-primary">${id}</span>`,
        start,
        `<span class="text-danger">${end}</span>`,
        req,
        subj,
        place,
        `<span class="badge bg-light text-dark border">${cType}</span>`
      ]);

      assignCardsList.push({
        id, start, end, req, subj, place, cType,
        driver: driver || '',
        plate: plate || '',
        status, badgeClass, isAssigned,
        rowIndex,
        rawTimestamp
      });
    }

    // 2. ตารางรายงาน พขร. (Driver Table & Cards)
    if (driver && id && !String(driver).includes('ยกเลิก')) {
      const hasReported = diffKm !== '' && diffKm !== null && diffKm !== undefined;
      const driverBtn = !hasReported
        ? `<button class="btn btn-sm btn-warning rounded-pill px-3 text-dark fw-bold" onclick="openDriver('${id}')"><i class="bi bi-speedometer2 me-1"></i>ลงไมล์</button>`
        : `<button class="btn btn-sm btn-outline-primary rounded-pill px-3" onclick="openDriver('${id}')"><i class="bi bi-pencil me-1"></i>แก้ไข (${diffKm} กม.)</button>`;

      driverData.push([
        driverBtn,
        `<span class="fw-bold font-heading text-primary">${id}</span>`,
        start,
        `<span class="text-danger">${end}</span>`,
        req,
        place,
        `<span class="fw-medium">${driver}</span>`,
        `<span class="badge bg-light text-dark border">${plate || '-'}</span>`
      ]);

      driverCardsList.push({
        id, start, end, req, place, driver,
        plate: plate || '',
        diffKm: diffKm !== '' && diffKm !== null && diffKm !== undefined ? diffKm : '',
        hasReported,
        rowIndex,
        rawTimestamp
      });
    }

    // 3. ตารางประวัติและพิมพ์ (Report Table & Cards)
    if (id) {
      const printBadge = printCount > 0
        ? ` <span class="badge bg-info-subtle text-info-emphasis border border-info-subtle">พิมพ์ ${printCount}</span>`
        : '';

      reportData.push([
        `<button class="btn btn-sm btn-outline-secondary rounded-pill px-2" onclick="openView('${id}', false)"><i class="bi bi-search me-1"></i>ดู</button>`,
        `<span class="fw-bold font-heading text-primary">${id}</span>`,
        `<span class="badge-status ${badgeClass}">${status}</span>${printBadge}`,
        start,
        `<span class="text-danger">${end}</span>`,
        req,
        place,
        driver || '-',
        plate || '-',
        diffKm !== '' && diffKm !== null && diffKm !== undefined ? `${diffKm} กม.` : '-'
      ]);

      reportCardsList.push({
        id, start, end, req, place,
        driver: driver || '',
        plate: plate || '',
        diffKm: diffKm !== '' && diffKm !== null && diffKm !== undefined ? diffKm : '',
        printCount, status, badgeClass,
        rowIndex,
        rawTimestamp
      });
    }
  });

  // อัปเดตตาราง DataTables (เรียง ID จากมากไปน้อยเช่นกัน)
  updateDataTable('#tableAssign', assignData, [[1, 'desc']]);

  if (!$.fn.DataTable.isDataTable('#tableDriver')) {
    const tableDr = $('#tableDriver').DataTable({
      data: driverData,
      responsive: true,
      autoWidth: false,
      language: DATATABLES_THAI_LANG,
      order: [[1, 'desc']],
      stateSave: true
    });
    $('#filterDriver').off('change').on('change', function () {
      const selected = this.value;
      tableDr.column(6).search(selected).draw();
      applyDriverCardsFilter();
    });
  } else {
    $('#tableDriver').DataTable().clear().rows.add(driverData).draw(false);
  }

  updateDataTable('#tableReport', reportData, [[1, 'desc']]);

  // จัดเรียงการ์ดคำขอล่าสุดให้อยู่บนสุดเสมอ (Latest First)
  assignCardsList = sortCardsLatestFirst(assignCardsList);
  driverCardsList = sortCardsLatestFirst(driverCardsList);
  reportCardsList = sortCardsLatestFirst(reportCardsList);

  // อัปเดตการ์ดมุมมองมือถือ (Mobile Cards)
  renderMobileAssignCards(assignCardsList);
  renderMobileDriverCards(driverCardsList);
  renderMobileReportCards(reportCardsList);

  // อัปเดตตารางและสถิติของผู้ดูแลระบบ (Admin)
  renderAdminTable();
  updateAdminCounters();

  initTableViewModes();
}

function updateDataTable(selector, dataset, order) {
  if ($.fn.DataTable.isDataTable(selector)) {
    $(selector).DataTable().clear().rows.add(dataset).draw(false);
  } else {
    $(selector).DataTable({
      data: dataset,
      responsive: true,
      autoWidth: false,
      language: DATATABLES_THAI_LANG,
      order: order,
      stateSave: true
    });
  }
}

/* ==========================================================================
   5. Form Request (เขียนขอใช้รถ)
   ========================================================================== */

function setupRequestForm() {
  const form = document.getElementById('formRequest');
  if (!form) return;

  // เมื่อเลือกผู้ขอ ให้ใส่กลุ่มงานอัตโนมัติ
  $('#req_c').on('change', function () {
    const val = $(this).val();
    const selectedUser = userList.find(u => u.name === val);
    $('#req_d').val(selectedUser ? selectedUser.group : '');
  });

  // คำนวณระยะเวลาเดินทางแบบเรียลไทม์
  $('#req_e, #req_f').on('change input', updateTripDurationPreview);

  // ปุ่มเลือกประเภทรถแบบการ์ด/ชิป
  document.querySelectorAll('.usage-chip-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.usage-chip-btn').forEach(b => b.classList.remove('selected'));
      this.classList.add('selected');
      const val = this.getAttribute('data-value');
      $('#req_l').val(val);
    });
  });

  $('#req_l').on('change', function () {
    const val = $(this).val();
    document.querySelectorAll('.usage-chip-btn').forEach(b => {
      b.classList.toggle('selected', b.getAttribute('data-value') === val);
    });
  });

  // ส่งข้อมูลขอใช้รถ
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const stVal = document.getElementById('req_e').value;
    const enVal = document.getElementById('req_f').value;
    if (!stVal || !enVal) {
      return Swal.fire('คำเตือน', 'กรุณาระบุวันและเวลาเดินทางให้ครบถ้วน', 'warning');
    }

    const st = new Date(stVal);
    const en = new Date(enVal);
    if (en - st < 1800000) {
      return Swal.fire({
        icon: 'error',
        title: 'เวลาไม่ถูกต้อง',
        text: 'วันเวลาสิ้นสุด ต้องมากกว่า วันเวลาเริ่มต้น อย่างน้อย 30 นาที'
      });
    }

    const parseThaiDate = (val) => {
      if (!val) return val;
      let [d, t] = val.split('T');
      let [y, m, day] = d.split('-');
      let yInt = parseInt(y, 10);
      if (yInt > 2500) yInt -= 543;
      return `${yInt}-${m}-${day}T${t}`;
    };

    const payload = {
      requester: $('#req_c').val(),
      group: $('#req_d').val(),
      start: parseThaiDate(stVal),
      end: parseThaiDate(enVal),
      subject: $('#req_g').val(),
      place: $('#req_h').val(),
      qty: $('#req_i').val(),
      include: $('#req_j').val(),
      detail: $('#req_k').val(),
      carType: $('#req_l').val()
    };

    try {
      const res = await callAPI('requestCar', payload);
      if (res && res.data) {
        const newId = res.data.id;
        const newRow = res.data.rowData || [
          newId, new Date().toISOString(), payload.requester, payload.group,
          payload.start, payload.end, payload.subject, payload.place,
          payload.qty, payload.include, payload.detail, payload.carType,
          '', '', '', '', '', '', '', '', '', '', res.data.eventId || '', 0
        ];
        globalData.push(newRow);
        saveLocalDataCache(globalData);
        renderTables();
        updateBadgeCounters();
        if (carDashboard) carDashboard.setData(globalData);
      }

      Swal.fire({
        icon: 'success',
        title: 'บันทึกคำขอใช้รถเรียบร้อย',
        html: `<div class="py-2">เลขที่คำขอของคุณคือ: <h3 class="text-primary font-heading my-2">${res.data?.id || '-'}</h3><p class="text-muted small">ระบบได้บันทึกลงปฏิทินและแจ้งเตือนเข้ากลุ่มงานเรียบร้อยแล้ว</p></div>`,
        confirmButtonText: 'ดูในปฏิทิน'
      }).then(() => {
        form.reset();
        $('#req_c').val('').trigger('change');
        document.querySelectorAll('.usage-chip-btn').forEach(b => b.classList.remove('selected'));
        updateTripDurationPreview();
        loadData(true);
        switchPage('page-calendar');
      });
    } catch (err) {
      // callAPI handles alert
    }
  });
}

function updateTripDurationPreview() {
  const stVal = document.getElementById('req_e').value;
  const enVal = document.getElementById('req_f').value;
  const badge = document.getElementById('tripDurationBadge');
  if (!badge) return;

  if (!stVal || !enVal) {
    badge.style.display = 'none';
    return;
  }

  const st = new Date(stVal);
  const en = new Date(enVal);
  const diffMs = en - st;

  if (isNaN(diffMs) || diffMs <= 0) {
    badge.className = 'trip-duration-badge bg-danger-subtle text-danger border-danger-subtle';
    badge.innerHTML = '<i class="bi bi-exclamation-circle me-1"></i> เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น';
    badge.style.display = 'inline-flex';
    return;
  }

  const totalMin = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;

  let durationText = '';
  if (days > 0) {
    durationText = `${days} วัน ${remHours} ชั่วโมง ${mins > 0 ? mins + ' นาที' : ''}`;
  } else if (hours > 0) {
    durationText = `${hours} ชั่วโมง ${mins > 0 ? mins + ' นาที' : ''}`;
  } else {
    durationText = `${mins} นาที`;
  }

  badge.className = 'trip-duration-badge';
  badge.innerHTML = `<i class="bi bi-clock me-1"></i> ระยะเวลาการใช้รถ: <b>${durationText}</b>`;
  badge.style.display = 'inline-flex';
}

/* ==========================================================================
   6. Dispatching Modal (จัดรถ)
   ========================================================================== */

function openAssign(id) {
  // หากยังไม่มีข้อมูลรถหรือ พขร. ให้ลองดึงจากแคชหรือเก็บตกทันที
  if (!carList.length || !driverList.length) {
    if (!initCachedOptions()) {
      fallbackHarvestFromData();
    }
  }

  $('#assign_id').val(id);
  $('#assign_id_lbl').text(id);
  $('#formAssign')[0].reset();
  $('#assign_n').val('').trigger('change');

  const row = globalData.find(r => r[0] == id);
  if (row) {
    $('#assign_summary_req').text(row[2] || '-');
    $('#assign_summary_group').text(row[3] || '-');
    $('#assign_summary_subj').text(row[6] || '-');
    $('#assign_summary_place').text(row[7] || '-');
    $('#assign_summary_time').text(`${formatDateUI(row[4])} ถึง ${formatDateUI(row[5])}`);
    $('#assign_summary_passengers').text(`${row[8] || '0'} คน (${row[9] || '-'})`);

    if (row[12]) $('#assign_m').val(row[12]);
    if (row[13]) {
      $('#assign_n').val(row[13]).trigger('change');
      $('#assign_o').val(row[14] || '');
    }
  }

  modalAssign.show();
}

function setupAssignForm() {
  $('#assign_n').on('change', function () {
    const val = $(this).val();
    const selectedCar = carList.find(c => String(c.plate).trim() === String(val).trim());
    $('#assign_o').val(selectedCar ? selectedCar.model : '');
  });

  const form = document.getElementById('formAssign');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = ($('#assign_id').val() || '').trim();
    const driver = ($('#assign_m').val() || '').trim();
    const plate = ($('#assign_n').val() || '').trim();
    const model = ($('#assign_o').val() || '').trim();

    if (!driver) {
      return Swal.fire('แจ้งเตือน', 'กรุณาเลือกพนักงานขับรถ (พขร.)', 'warning');
    }
    if (!plate) {
      return Swal.fire('แจ้งเตือน', 'กรุณาเลือกรถยนต์ที่จะจัดให้', 'warning');
    }

    // 1. Optimistic Update ทันทีใน Client (0ms) - ผู้ใช้เห็นสถานะเปลี่ยนทันที ไม่ต้องรอเน็ต
    const targetIdx = globalData.findIndex(r => String(r[0]).trim() === id);
    let previousRow = null;
    if (targetIdx !== -1) {
      previousRow = [...globalData[targetIdx]];
      globalData[targetIdx][12] = driver;
      globalData[targetIdx][13] = plate;
      globalData[targetIdx][14] = model;
      saveLocalDataCache(globalData);
      renderTables();
      updateBadgeCounters();
      if (carDashboard) carDashboard.setData(globalData);
    }

    modalAssign.hide();
    updateSyncBadge('syncing', 'กำลังบันทึกการจัดรถ...');

    try {
      // ส่ง skipCalendar: true เพื่อให้บันทึกเสร็จทันทีใน 1-1.5 วินาที (รวดเร็วเทียบเท่าบันทึกเลขไมล์)
      const res = await callAPI('assignCar', { id, driver, plate, model, skipCalendar: true });
      // หากเซิร์ฟเวอร์ส่งคืนข้อมูลแถวที่อัปเดตแล้ว ให้ใช้ข้อมูลยืนยันจากเซิร์ฟเวอร์
      if (res && res.data && res.data.updatedRow && targetIdx !== -1) {
        globalData[targetIdx] = res.data.updatedRow;
        saveLocalDataCache(globalData);
        renderTables();
        updateBadgeCounters();
      }
      updateSyncBadge('online', 'ออนไลน์ (ซิงค์แล้ว)');
      Swal.fire({
        icon: 'success',
        title: 'จัดรถสำเร็จ',
        html: `มอบหมายให้ <b>${driver}</b> เรียบร้อยแล้ว`,
        timer: 1800,
        showConfirmButton: false
      });

      // ซิงค์ Google Calendar ในเบื้องหลังแบบเงียบๆ ไม่ต้องหน่วงหน้าจอผู้ใช้ (ใช้ fetchAPI โดยไม่เปิดป๊อปอัป SweetAlert)
      if (res && res.data && res.data.eventId) {
        fetchAPI('syncCalendar', { id }).catch(e => console.warn('Background calendar sync error:', e));
      }
    } catch (err) {
      // Rollback หากผิดพลาด
      if (previousRow && targetIdx !== -1) {
        globalData[targetIdx] = previousRow;
        saveLocalDataCache(globalData);
        renderTables();
        updateBadgeCounters();
      }
      updateSyncBadge('offline', 'เกิดข้อผิดพลาดในการบันทึก');
    }
  });
}

/* ==========================================================================
   7. Driver Mileage Report (รายงาน พขร.)
   ========================================================================== */

function toDateTimeLocal(isoStr) {
  if (!isoStr) return '';
  const d = parseSafeDate(isoStr);
  if (!d) return '';
  const tzoffset = d.getTimezoneOffset() * 60000;
  return (new Date(d.getTime() - tzoffset)).toISOString().slice(0, 16);
}

function openDriver(id) {
  $('#driver_id').val(id);
  $('#driver_id_lbl').text(id);
  $('#formDriver')[0].reset();

  const row = globalData.find(r => r[0] == id);
  if (row) {
    $('#driver_summary_place').text(row[7] || '-');
    $('#driver_summary_plate').text(`${row[13] || '-'} (${row[14] || '-'})`);
    $('#driver_summary_reqtime').text(`${formatDateUI(row[4])} ถึง ${formatDateUI(row[5])}`);

    // กำหนดเวลาจริง เริ่มต้นใช้วันที่ขอ
    const pVal = row[15] ? toDateTimeLocal(row[15]) : toDateTimeLocal(row[4]);
    const qVal = row[16] ? toDateTimeLocal(row[16]) : toDateTimeLocal(row[5]);
    $('#driver_p').val(pVal);
    $('#driver_q').val(qVal);

    if (row[17] !== '') $('#driver_r').val(row[17]);
    if (row[18] !== '') $('#driver_s').val(row[18]);
    if (row[19] !== '') $('#driver_t').val(row[19]);
    if (row[20] !== '') $('#driver_u').val(row[20]);
    if (row[21] !== '') $('#driver_v').val(row[21]);

    calcKM();
  }

  modalDriver.show();
}

function calcKM() {
  const start = parseFloat($('#driver_r').val()) || 0;
  const end = parseFloat($('#driver_s').val()) || 0;
  const diff = end - start;

  $('#driver_t').val(diff > 0 ? diff : 0);
  $('#odometerDiffDisplay').text(diff > 0 ? diff.toLocaleString('th-TH') + ' กม.' : '0 กม.');

  if (diff <= 0 && $('#driver_s').val() !== '') {
    $('#driver_t').addClass('is-invalid');
    $('#odometerDiffDisplay').addClass('text-danger').removeClass('text-info');
  } else {
    $('#driver_t').removeClass('is-invalid');
    $('#odometerDiffDisplay').removeClass('text-danger').addClass('text-info');
  }

  // คำนวณความประหยัดน้ำมันถ้ามีการกรอก
  const fuel = parseFloat($('#driver_u').val()) || 0;
  const cost = parseFloat($('#driver_v').val()) || 0;
  if (diff > 0 && fuel > 0) {
    const kmPerL = (diff / fuel).toFixed(2);
    $('#fuelEfficiencyText').text(`อัตราสิ้นเปลือง: ${kmPerL} กม./ลิตร`);
  } else {
    $('#fuelEfficiencyText').text('');
  }
}

function setupDriverForm() {
  $('#driver_r, #driver_s, #driver_u, #driver_v').on('input', calcKM);

  // ปุ่มลัดใช้วันเวลาตามใบขอ
  $('#btnUseReqTime').on('click', () => {
    const id = $('#driver_id').val();
    const row = globalData.find(r => r[0] == id);
    if (row) {
      if (row[4]) $('#driver_p').val(toDateTimeLocal(row[4]));
      if (row[5]) $('#driver_q').val(toDateTimeLocal(row[5]));
      calcKM();
    }
  });

  const form = document.getElementById('formDriver');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = ($('#driver_id').val() || '').trim();
    const pVal = $('#driver_p').val();
    const qVal = $('#driver_q').val();
    const actSt = new Date(pVal);
    const actEn = new Date(qVal);
    const diffKm = parseFloat($('#driver_t').val()) || 0;

    if (!pVal || !qVal || isNaN(actSt.getTime()) || isNaN(actEn.getTime())) {
      return Swal.fire('ข้อผิดพลาด', 'กรุณาระบุเวลา "ขับจริง" และ "ขับถึงจริง"', 'warning');
    }

    if (actEn - actSt < 1800000) {
      return Swal.fire('ข้อผิดพลาด', 'เวลา "ขับถึงจริง" ต้องมากกว่า "ขับจริง" อย่างน้อย 30 นาที', 'error');
    }

    if (diffKm <= 0) {
      return Swal.fire('ข้อผิดพลาด', 'เลขกิโลเมตรถึง ต้องมากกว่า กิโลเมตรเริ่มต้น', 'error');
    }

    const payload = {
      id: id,
      actStart: pVal,
      actEnd: qVal,
      startKm: $('#driver_r').val(),
      endKm: $('#driver_s').val(),
      diffKm: diffKm,
      fuel: $('#driver_u').val(),
      cost: $('#driver_v').val()
    };

    // 1. Optimistic Update ทันทีใน Client (0ms) - เห็นผลต่างเลขไมล์และการจบงานทันที
    const targetIdx = globalData.findIndex(r => String(r[0]).trim() === id);
    let previousRow = null;
    if (targetIdx !== -1) {
      previousRow = [...globalData[targetIdx]];
      globalData[targetIdx][15] = payload.actStart;
      globalData[targetIdx][16] = payload.actEnd;
      globalData[targetIdx][17] = payload.startKm;
      globalData[targetIdx][18] = payload.endKm;
      globalData[targetIdx][19] = payload.diffKm;
      globalData[targetIdx][20] = payload.fuel;
      globalData[targetIdx][21] = payload.cost;
      saveLocalDataCache(globalData);
      renderTables();
      updateBadgeCounters();
      if (carDashboard) carDashboard.setData(globalData);
    }

    modalDriver.hide();
    updateSyncBadge('syncing', 'กำลังบันทึกรายงานไมล์...');

    try {
      const res = await callAPI('driverReport', payload);
      if (res && res.data && res.data.updatedRow && targetIdx !== -1) {
        globalData[targetIdx] = res.data.updatedRow;
        saveLocalDataCache(globalData);
        renderTables();
        updateBadgeCounters();
      }
      updateSyncBadge('online', 'ออนไลน์ (ซิงค์แล้ว)');
      Swal.fire({
        icon: 'success',
        title: 'บันทึกเรียบร้อย',
        html: `บันทึกระยะทาง <b>${diffKm.toLocaleString()} กม.</b> เรียบร้อยแล้ว`,
        timer: 1800,
        showConfirmButton: false
      });
    } catch (err) {
      if (previousRow && targetIdx !== -1) {
        globalData[targetIdx] = previousRow;
        saveLocalDataCache(globalData);
        renderTables();
        updateBadgeCounters();
      }
      updateSyncBadge('offline', 'เกิดข้อผิดพลาดในการบันทึก');
    }
  });
}

/* ==========================================================================
   8. Detail View & Printing (ประวัติและพิมพ์เอกสาร)
   ========================================================================== */

function openView(id, fromCalendar = false) {
  $('#view_id_lbl').text(id);
  const row = globalData.find(r => r[0] == id);
  if (!row) return;

  const diffKm = row[19];
  const driver = row[12];
  let statusBadge = '<span class="badge-status badge-status-pending">รอจัดรถ</span>';
  if (driver) {
    if (String(driver).includes('ยกเลิก')) {
      statusBadge = '<span class="badge-status badge-status-cancelled">ยกเลิก</span>';
    } else if (diffKm !== '' && diffKm !== null && diffKm !== undefined) {
      statusBadge = '<span class="badge-status badge-status-completed">เดินทางเสร็จสิ้น</span>';
    } else {
      statusBadge = '<span class="badge-status badge-status-assigned">รอขับรถ</span>';
    }
  }

  $('#viewBody').html(`
    <div class="col-12 mb-3">
      <div class="p-3 bg-light rounded-3 d-flex justify-content-between align-items-center">
        <div>
          <span class="text-muted small">รหัสคำขอ:</span>
          <h4 class="m-0 font-heading text-primary">${row[0]}</h4>
        </div>
        <div>${statusBadge}</div>
      </div>
    </div>
    <div class="col-md-6 mb-2"><b>ผู้ขอ:</b> ${row[2] || '-'}</div>
    <div class="col-md-6 mb-2"><b>กลุ่มงาน:</b> ${row[3] || '-'}</div>
    <div class="col-md-6 mb-2"><b>ขอวันที่:</b> ${formatDateUI(row[4])}</div>
    <div class="col-md-6 mb-2"><b>ถึงวันที่:</b> <span class="text-danger">${formatDateUI(row[5])}</span></div>
    <div class="col-12 mb-2"><b>เรื่อง:</b> ${row[6] || '-'}</div>
    <div class="col-12 mb-2"><b>สถานที่:</b> ${row[7] || '-'}</div>
    <div class="col-12 mb-2"><b>จำนวนผู้เดินทาง:</b> ${row[8] || '0'} คน (${row[9] || '-'})</div>
    <div class="col-12 mb-3"><b>ประเภทการใช้รถ:</b> <span class="badge bg-secondary">${row[11] || '-'}</span></div>
    
    <div class="col-12"><hr class="my-2"></div>

    <div class="col-md-6 mb-2"><b>พนักงานขับรถ:</b> ${row[12] || '-'}</div>
    <div class="col-md-6 mb-2"><b>รถยนต์:</b> ${row[13] || '-'} (${row[14] || '-'})</div>
    <div class="col-md-6 mb-2"><b>ออกเดินทางจริง:</b> ${formatDateUI(row[15])}</div>
    <div class="col-md-6 mb-2"><b>กลับถึงจริง:</b> ${formatDateUI(row[16])}</div>
    <div class="col-md-6 mb-2"><b>เลขไมล์:</b> ${row[17] || '-'} ถึง ${row[18] || '-'}</div>
    <div class="col-md-6 mb-2"><b>ระยะทางรวม:</b> <span class="text-success fw-bold">${row[19] !== '' ? row[19] + ' กม.' : '-'}</span></div>
    <div class="col-md-6 mb-2"><b>เติมน้ำมัน:</b> ${row[20] || '-'} ลิตร</div>
    <div class="col-md-6 mb-2"><b>เป็นเงิน:</b> ${row[21] || '-'} บาท</div>
  `);

  modalView.show();
}

function pDate(dStr) {
  if (!dStr) return '';
  const d = new Date(dStr);
  if (isNaN(d)) return '';
  const m = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function pTime(dStr) {
  if (!dStr) return '';
  const d = new Date(dStr);
  if (isNaN(d)) return '';
  return `${('0' + d.getHours()).slice(-2)}:${('0' + d.getMinutes()).slice(-2)} น.`;
}

async function printDoc() {
  const id = $('#view_id_lbl').text();
  const row = globalData.find(r => r[0] == id);
  if (!row) return;

  // กรอกข้อมูลลงแบบฟอร์มมาตรฐาน
  $('#prt_id').text(row[0] || '');
  $('#prt_date').text(pDate(row[1]));
  $('#prt_req').text(row[2] || '');
  $('#prt_req_name').text(row[2] || '');
  $('#prt_req_sign').text(row[2] || '');
  $('#prt_group').text(row[3] || '');
  $('#prt_subj').text(row[6] || '');
  $('#prt_place').text(row[7] || '');
  $('#prt_aplace').text(row[7] || '');
  $('#prt_qty').text(row[8] || '');
  $('#prt_include').text(row[9] || '');

  $('#prt_sd').text(pDate(row[4]));
  $('#prt_st').text(pTime(row[4]));
  $('#prt_ed').text(pDate(row[5]));
  $('#prt_et').text(pTime(row[5]));

  $('#prt_model').text(row[14] || '');
  $('#prt_amodel').text(row[14] || '');
  $('#prt_plate').text(row[13] || '');
  $('#prt_aplate').text(row[13] || '');
  $('#prt_driver').text(row[12] || '');
  $('#prt_d_name').text(row[12] || '');
  $('#prt_d_sign').text(row[12] || '');
  $('#prt_fuel').text(row[20] || '');
  $('#prt_cost').text(row[21] || '');

  $('#prt_asd').text(pDate(row[15]));
  $('#prt_ast').text(pTime(row[15]));
  $('#prt_aed').text(pDate(row[16]));
  $('#prt_aet').text(pTime(row[16]));
  $('#prt_skm').text(row[17] || '');
  $('#prt_ekm').text(row[18] || '');
  $('#prt_dkm').text(row[19] || '');

  modalView.hide();

  setTimeout(() => {
    window.print();
    // บันทึกสถิติการพิมพ์ไปยังเซิร์ฟเวอร์
    fetchAPI('printDoc', { id })
      .then(() => loadData(true))
      .catch(e => console.warn(e));
  }, 400);
}

/* ==========================================================================
   9. Fuel Inventory System (ระบบน้ำมันคลัง พขร.)
   ========================================================================== */

async function loadOilData(silent = true) {
  if (isFetchingOil) return;
  isFetchingOil = true;

  if (!silent) {
    Swal.fire({
      title: 'โหลดข้อมูลน้ำมัน...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });
  }

  try {
    const json = await fetchAPI('getOilData');
    if (json.status !== 'success') throw new Error(json.message);

    const d = json.data;
    const bal = parseFloat(d.balance || 0);
    $('#oilBalanceDisplay').text(bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    oilPendingList = d.pending || [];
    oilHistoryList = d.history || [];

    $('#oilPendingBadge').text(oilPendingList.length);
    $('#oilPendingBadge').toggle(oilPendingList.length > 0);
  } catch (err) {
    console.error('Load Oil Data Error:', err);
    if (!silent) Swal.fire('ผิดพลาดระบบน้ำมัน', err.message, 'error');
  } finally {
    isFetchingOil = false;
    if (!silent) Swal.close();
  }
}

function toggleOilType() {
  const type = $('#oilType').val();
  if (type === 'out') {
    $('#oilCarDiv').show();
    $('#oilCar').prop('required', true);
  } else {
    $('#oilCarDiv').hide();
    $('#oilCar').prop('required', false).val('');
  }
}

function openOilRequest() {
  $('#formOilRequest')[0].reset();
  toggleOilType();
  if (sigPad1) sigPad1.clear();
  modalOilReq.show();
}

function setupOilModule() {
  // ฟอร์มส่งคำขอน้ำมัน
  const formOil = document.getElementById('formOilRequest');
  if (formOil) {
    formOil.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sigPad1 || sigPad1.isEmpty()) {
        return Swal.fire('คำเตือน', 'กรุณาเซ็นชื่อก่อนบันทึกรายการ', 'warning');
      }

      const type = $('#oilType').val();
      const qty = parseFloat($('#oilQty').val());
      const payload = {
        inQty: type === 'in' ? qty : '',
        outQty: type === 'out' ? qty : '',
        car: $('#oilCar').val() || '',
        detail: $('#oilDetail').val(),
        sig1: sigPad1.toDataURL()
      };

      await callAPI('requestOil', payload);
      Swal.fire('สำเร็จ', 'ส่งรายการรอนุมัติเรียบร้อย', 'success');
      modalOilReq.hide();
      loadOilData(true);
    });
  }

  // ฟอร์มอนุมัติน้ำมัน
  const formApp = document.getElementById('formOilApprove');
  if (formApp) {
    formApp.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sigPad2 || sigPad2.isEmpty()) {
        return Swal.fire('คำเตือน', 'กรุณาเซ็นชื่อผู้อนุมัติ', 'warning');
      }

      const payload = {
        row: $('#oilApproveRow').val(),
        note: $('#oilNote').val(),
        sig2: sigPad2.toDataURL()
      };

      await callAPI('approveOil', payload);
      Swal.fire('สำเร็จ', 'อนุมัติเรียบร้อย ยอดคงเหลือถูกอัปเดตแล้ว', 'success');
      modalOilApp.hide();
      loadOilData(true);
    });
  }
}

async function checkLoginOilApprove() {
  if (!unlockedOil) {
    const { value: pass } = await Swal.fire({
      title: '🔐 รหัสผ่านผู้อนุมัติน้ำมัน',
      input: 'password',
      inputPlaceholder: 'กรอกรหัสผ่าน',
      showCancelButton: true,
      confirmButtonText: 'เข้าสู่ระบบ'
    });

    if (!pass) return;

    try {
      const res = await callAPI('checkAuth', { type: 'oil', pass: pass });
      Swal.close();
      if (res.data === true) {
        unlockedOil = true;
      } else {
        return Swal.fire('ผิดพลาด', 'รหัสผ่านไม่ถูกต้อง', 'error');
      }
    } catch (e) {
      Swal.close();
      if (pass === window.CONFIG?.DEFAULT_PASSWORDS?.oil) {
        unlockedOil = true;
      } else {
        return Swal.fire('ผิดพลาด', 'รหัสผ่านไม่ถูกต้อง', 'error');
      }
    }
  }
  Swal.close();
  openOilPending();
}

function openOilPending() {
  let pendingData = [];
  oilPendingList.forEach(item => {
    const r = item.data;
    const typeStr = r[1]
      ? '<span class="badge bg-success-subtle text-success border border-success-subtle">นำเข้า</span>'
      : '<span class="badge bg-danger-subtle text-danger border border-danger-subtle">เบิกออก</span>';
    const qty = r[1] ? r[1] : r[2];
    const img = r[6] ? `<img src="${r[6]}" style="height:32px; border:1px solid #e2e8f0; border-radius:4px;">` : '';

    pendingData.push([
      `<button class="btn btn-sm btn-primary rounded-pill px-3" onclick="openOilApprove(${item.row})"><i class="bi bi-pen me-1"></i>พิจารณา</button>`,
      formatDateUI(r[0]),
      typeStr,
      `<span class="fw-bold font-heading text-primary">${qty} ลิตร</span>`,
      r[4] || '-',
      r[5] || '-',
      img
    ]);
  });

  updateDataTable('#tableOilPending', pendingData, []);
  modalOilPen.show();
}

function openOilApprove(rowNum) {
  const item = oilPendingList.find(x => x.row === rowNum);
  if (!item) return;
  const r = item.data;
  const typeTxt = r[1] ? `นำเข้า ${r[1]} ลิตร` : `เบิกออก ${r[2]} ลิตร`;

  $('#oilApproveSummary').html(`
    กำลังอนุมัติรายการ: <b>${typeTxt}</b><br>
    วัตถุประสงค์/รายละเอียด: ${r[5] || '-'}<br>
    ใช้ที่รถ: ${r[4] || '-'}
  `);

  $('#oilApproveRow').val(rowNum);
  $('#oilNote').val('');
  if (sigPad2) sigPad2.clear();

  modalOilPen.hide();
  modalOilApp.show();
}

function openOilReport() {
  let repData = [];
  oilHistoryList.forEach(item => {
    const r = item.data;
    const status = item.approved
      ? '<span class="badge bg-success-subtle text-success border border-success-subtle">อนุมัติแล้ว</span>'
      : '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">รออนุมัติ</span>';
    const sig1 = r[6] ? `<img src="${r[6]}" height="26">` : '';
    const sig2 = r[7] ? `<img src="${r[7]}" height="26">` : '-';

    repData.push([
      status,
      formatDateUI(r[0]),
      `<span class="text-success fw-medium">${r[1] || '-'}</span>`,
      `<span class="text-danger fw-medium">${r[2] || '-'}</span>`,
      `<span class="fw-bold font-heading text-primary">${r[3] || '-'}</span>`,
      r[4] || '-',
      `${r[5]}<br><small class="text-muted">${r[8] || ''}</small>`,
      sig1,
      sig2
    ]);
  });

  updateDataTable('#tableOilReport', repData, [[1, 'desc']]);
  modalOilRep.show();
}

/* ==========================================================================
   10. Navigation & Authentication Router
   ========================================================================== */

function switchPage(pageId, linkElement = null) {
  // สลับการแสดงผล section
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  const targetPage = document.getElementById(pageId);
  if (targetPage) targetPage.classList.add('active');

  // สลับสถานะ active บน sidebar
  document.querySelectorAll('.app-sidebar .nav-link').forEach(el => el.classList.remove('active'));
  const sidebarMatch = document.querySelector(`.app-sidebar .nav-link[onclick*="${pageId}"]`);
  if (sidebarMatch) sidebarMatch.classList.add('active');

  // สลับสถานะ active บน bottom nav
  document.querySelectorAll('.bottom-nav-link').forEach(el => el.classList.remove('active'));
  const bottomMatch = document.querySelector(`.bottom-nav-link[onclick*="${pageId}"]`);
  if (bottomMatch) bottomMatch.classList.add('active');

  // ปิด sidebar บนมือถือเมื่อกดเปลี่ยนหน้า
  closeMobileSidebar();

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // จัดการการโหลดและเรนเดอร์เฉพาะหน้า
  if (pageId === 'page-calendar') {
    setTimeout(() => {
      if (typeof renderCalendar === 'function') {
        renderCalendar();
      }
    }, 50);
  } else if (pageId === 'page-dashboard') {
    if (!carDashboard) {
      initDashboard();
    } else {
      carDashboard.update();
    }
  } else if (pageId === 'page-oil') {
    if (oilHistoryList.length === 0) loadOilData(false);
  } else if (pageId === 'page-admin') {
    if (!globalData || globalData.length === 0) {
      loadData(true);
    } else {
      renderAdminTable();
      updateAdminCounters();
    }
    setTimeout(() => {
      if ($.fn.DataTable && $.fn.DataTable.isDataTable('#tableAdmin')) {
        $('#tableAdmin').DataTable().columns.adjust().responsive.recalc();
      }
    }, 50);
  }

  // ปรับขนาดและคำนวณ Responsive DataTables เมื่อสลับหน้า
  setTimeout(() => {
    if ($.fn.DataTable) {
      $.fn.dataTable.tables({ visible: true, api: true }).columns.adjust().responsive.recalc();
    }
  }, 60);
}

async function checkLoginAndSwitch(pageId, linkElement = null) {
  if (pageId === 'page-assign' && !unlockedAssign) {
    const { value: pass } = await Swal.fire({
      title: '🔑 จัดการระบบจัดรถ',
      input: 'password',
      inputPlaceholder: 'กรอกรหัสผ่าน',
      showCancelButton: true,
      confirmButtonText: 'ปลดล็อก'
    });
    if (!pass) return;

    try {
      const res = await callAPI('checkAuth', { type: 'assign', pass: pass });
      Swal.close();
      if (res.data === true) {
        unlockedAssign = true;
      } else {
        return Swal.fire('ผิดพลาด', 'รหัสผ่านไม่ถูกต้อง', 'error');
      }
    } catch (e) {
      Swal.close();
      if (pass === window.CONFIG?.DEFAULT_PASSWORDS?.assign) {
        unlockedAssign = true;
      } else {
        return Swal.fire('ผิดพลาด', 'รหัสผ่านไม่ถูกต้อง', 'error');
      }
    }
  }

  if (pageId === 'page-driver' && !unlockedDriver) {
    const { value: pass } = await Swal.fire({
      title: '👨‍✈️ รายงานสำหรับ พขร.',
      input: 'password',
      inputPlaceholder: 'กรอกรหัสผ่าน',
      showCancelButton: true,
      confirmButtonText: 'เข้าสู่ระบบ'
    });
    if (!pass) return;

    try {
      const res = await callAPI('checkAuth', { type: 'driver', pass: pass });
      Swal.close();
      if (res.data === true) {
        unlockedDriver = true;
      } else {
        return Swal.fire('ผิดพลาด', 'รหัสผ่านไม่ถูกต้อง', 'error');
      }
    } catch (e) {
      Swal.close();
      if (pass === window.CONFIG?.DEFAULT_PASSWORDS?.driver) {
        unlockedDriver = true;
      } else {
        return Swal.fire('ผิดพลาด', 'รหัสผ่านไม่ถูกต้อง', 'error');
      }
    }
  }

  if (pageId === 'page-admin' && !unlockedAdmin) {
    const { value: pass } = await Swal.fire({
      title: '🛡️ จัดการข้อมูล (Admin Mode)',
      text: 'กรุณากรอกรหัสผ่านผู้ดูแลระบบส่วนกลาง',
      input: 'password',
      inputPlaceholder: 'กรอกรหัสผ่าน Admin',
      showCancelButton: true,
      confirmButtonText: 'เข้าสู่ระบบ',
      confirmButtonColor: '#dc3545'
    });
    if (!pass) return;

    try {
      const res = await callAPI('checkAuth', { type: 'admin', pass: pass });
      Swal.close();
      if (res.data === true) {
        unlockedAdmin = true;
      } else {
        return Swal.fire('ผิดพลาด', 'รหัสผ่าน Admin ไม่ถูกต้อง', 'error');
      }
    } catch (e) {
      Swal.close();
      if (pass === window.CONFIG?.DEFAULT_PASSWORDS?.admin || pass === '11278') {
        unlockedAdmin = true;
      } else {
        return Swal.fire('ผิดพลาด', 'รหัสผ่านไม่ถูกต้อง', 'error');
      }
    }
  }

  Swal.close();
  switchPage(pageId, linkElement);
}

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.app-sidebar');
  const backdrop = document.querySelector('.sidebar-backdrop');
  if (sidebar && backdrop) {
    sidebar.classList.toggle('show');
    backdrop.classList.toggle('show');
  }
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.app-sidebar');
  const backdrop = document.querySelector('.sidebar-backdrop');
  if (sidebar && backdrop) {
    sidebar.classList.remove('show');
    backdrop.classList.remove('show');
  }
}

/* ==========================================================================
   11. Real-time Clock Widget
   ========================================================================== */

function startRealtimeClock() {
  const clockEl = document.getElementById('topbarClock');
  if (!clockEl) return;

  const update = () => {
    const now = new Date();
    const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const d = now.getDate();
    const m = thaiMonths[now.getMonth()];
    const y = now.getFullYear() + 543;
    const hh = ('0' + now.getHours()).slice(-2);
    const mm = ('0' + now.getMinutes()).slice(-2);
    const ss = ('0' + now.getSeconds()).slice(-2);
    clockEl.textContent = `${d} ${m} ${y} • ${hh}:${mm}:${ss} น.`;
  };

  update();
  setInterval(update, 1000);
}

/* ==========================================================================
   12. Initialization on Window Load
   ========================================================================== */

function initCalendar() {
  if (typeof renderCalendar === 'function') {
    renderCalendar();
  }
}

function initDashboard() {
  carDashboard = new CarDashboard();
  carDashboard.init(globalData);
}

window.addEventListener('DOMContentLoaded', () => {
  // Init Modals
  modalAssign = new bootstrap.Modal(document.getElementById('modalAssign'));
  modalDriver = new bootstrap.Modal(document.getElementById('modalDriver'));
  modalView = new bootstrap.Modal(document.getElementById('modalView'));
  modalOilReq = new bootstrap.Modal(document.getElementById('modalOilRequest'));
  modalOilPen = new bootstrap.Modal(document.getElementById('modalOilPending'));
  modalOilApp = new bootstrap.Modal(document.getElementById('modalOilApprove'));
  modalOilRep = new bootstrap.Modal(document.getElementById('modalOilReport'));
  const modalAdminEl = document.getElementById('modalAdminEdit');
  if (modalAdminEl) {
    modalAdminEdit = new bootstrap.Modal(modalAdminEl);
  }

  // Init Signatures
  sigPad1 = new DigitalSignature('sigCanvas1');
  sigPad2 = new DigitalSignature('sigCanvas2');

  document.getElementById('modalOilRequest')?.addEventListener('shown.bs.modal', () => sigPad1?.resize());
  document.getElementById('modalOilApprove')?.addEventListener('shown.bs.modal', () => sigPad2?.resize());

  // Setup modules
  initTheme();
  setupRequestForm();
  setupAssignForm();
  setupDriverForm();
  setupOilModule();
  setupAdminEditForm();
  startRealtimeClock();
  initTableViewModes();

  // Resize & orientation listeners
  window.addEventListener('resize', () => {
    if (sigPad1) sigPad1.resize();
    if (sigPad2) sigPad2.resize();
    if ($.fn.DataTable) {
      $.fn.dataTable.tables({ visible: true, api: true }).columns.adjust().responsive.recalc();
    }
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      if (sigPad1) sigPad1.resize();
      if (sigPad2) sigPad2.resize();
      if (typeof renderCalendar === 'function' && document.getElementById('page-calendar')?.classList.contains('active')) {
        renderCalendar();
      }
      if ($.fn.DataTable) {
        $.fn.dataTable.tables({ visible: true, api: true }).columns.adjust().responsive.recalc();
      }
    }, 150);
  });

  // Load Data
  // 1. ดึงแคชตัวเลือกขึ้นมาแสดงผลทันที (0ms)
  initCachedOptions();

  // 2. ดึงแคชประวัติและคิวรถขึ้นมาแสดงผลทันที (0ms)
  initCachedData();

  // 3. โหลดข้อมูลหลักล่าสุดจากเซิร์ฟเวอร์ทันที
  loadData(true);
});

/* ==========================================================================
   13. Theme Management (โหมดมืด / โหมดสว่าง)
   ========================================================================== */

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme ? savedTheme : (prefersDark ? 'dark' : 'light');

  setTheme(initialTheme);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  const iconEl = document.getElementById('themeToggleIcon');
  const labelEl = document.getElementById('themeToggleLabel');

  if (theme === 'dark') {
    if (iconEl) iconEl.className = 'bi bi-sun-fill text-warning';
    if (labelEl) labelEl.textContent = 'โหมดสว่าง';
  } else {
    if (iconEl) iconEl.className = 'bi bi-moon-stars-fill text-primary';
    if (labelEl) labelEl.textContent = 'โหมดมืด';
  }

  // อัปเดตกราฟสถิติตามโทนสีของธีม
  if (carDashboard && document.getElementById('page-dashboard')?.classList.contains('active')) {
    carDashboard.update();
  }

  // อัปเดตปฏิทินตามธีม
  if (typeof renderCalendar === 'function' && document.getElementById('page-calendar')?.classList.contains('active')) {
    renderCalendar();
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

window.toggleTheme = toggleTheme;
window.setTheme = setTheme;
window.switchTableViewMode = switchTableViewMode;
window.filterCards = filterCards;
window.applyDriverCardsFilter = applyDriverCardsFilter;
window.applyReportCardsFilter = applyReportCardsFilter;
window.loadMoreReportCards = loadMoreReportCards;
window.loadData = loadData;
window.initCachedData = initCachedData;

/* ==========================================================================
   14. Central Database Management (Admin Mode)
   ========================================================================== */

function renderAdminTable() {
  const tableEl = document.getElementById('tableAdmin');
  if (!tableEl) return;

  const adminData = [];
  globalData.forEach(row => {
    if (!row || !row[0]) return;
    const id = row[0];
    const start = formatDateUI(row[4]);
    const end = formatDateUI(row[5]);
    const req = row[2] || '-';
    const place = row[7] || '-';
    const driver = row[12];
    const plate = row[13];
    const diffKm = row[19];

    let status = 'รอจัดรถ';
    let badgeClass = 'badge-status-pending';

    if (driver) {
      if (String(driver).includes('ยกเลิก')) {
        status = 'ยกเลิก';
        badgeClass = 'badge-status-cancelled';
      } else if (diffKm !== '' && diffKm !== null && diffKm !== undefined) {
        status = 'เสร็จสิ้น';
        badgeClass = 'badge-status-completed';
      } else {
        status = 'รอขับรถ';
        badgeClass = 'badge-status-assigned';
      }
    }

    const actionBtns = `
      <div class="d-flex gap-1">
        <button class="btn btn-sm btn-outline-secondary rounded-pill px-2 py-1" onclick="openView('${id}', false)" title="ดูรายละเอียด">
          <i class="bi bi-search"></i>
        </button>
        <button class="btn btn-sm btn-outline-primary rounded-pill px-2 py-1" onclick="openAdminEdit('${id}')" title="แก้ไข">
          <i class="bi bi-pencil-square"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger rounded-pill px-2 py-1" onclick="adminDeleteRecord('${id}')" title="ลบข้อมูล">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;

    adminData.push([
      actionBtns,
      `<span class="fw-bold font-heading text-primary">${id}</span>`,
      `<span class="badge-status ${badgeClass}">${status}</span>`,
      start,
      `<span class="text-danger">${end}</span>`,
      req,
      place,
      driver || '-',
      plate || '-',
      diffKm !== '' && diffKm !== null && diffKm !== undefined ? `${diffKm} กม.` : '-'
    ]);
  });

  if ($.fn.DataTable.isDataTable('#tableAdmin')) {
    const dt = $('#tableAdmin').DataTable();
    dt.clear().rows.add(adminData).draw(false);
    setTimeout(() => dt.columns.adjust().responsive.recalc(), 10);
  } else {
    $('#tableAdmin').DataTable({
      data: adminData,
      responsive: true,
      autoWidth: false,
      language: DATATABLES_THAI_LANG,
      order: [[1, 'desc']],
      stateSave: false,
      pageLength: 25
    });
  }
}

function updateAdminCounters() {
  let total = 0;
  let pending = 0;
  let assigned = 0;
  let completed = 0;

  globalData.forEach(row => {
    if (!row || !row[0]) return;
    total++;
    const driver = row[12];
    const diffKm = row[19];

    if (driver && String(driver).includes('ยกเลิก')) {
      // cancelled
    } else if (driver && diffKm !== '' && diffKm !== null && diffKm !== undefined) {
      completed++;
    } else if (driver && driver.trim() !== '') {
      assigned++;
    } else {
      pending++;
    }
  });

  const elTotal = document.getElementById('adminTotalCount');
  const elPending = document.getElementById('adminPendingCount');
  const elAssigned = document.getElementById('adminAssignedCount');
  const elCompleted = document.getElementById('adminCompletedCount');

  if (elTotal) elTotal.textContent = total;
  if (elPending) elPending.textContent = pending;
  if (elAssigned) elAssigned.textContent = assigned;
  if (elCompleted) elCompleted.textContent = completed;
}

function openAdminEdit(id) {
  const row = globalData.find(r => r[0] == id);
  if (!row) {
    return Swal.fire('ไม่พบข้อมูล', `ไม่พบคำขอเลขที่ ${id} ในระบบ`, 'warning');
  }

  $('#adm_id').val(row[0] || '');

  // กำหนดสถานะเริ่มต้น
  const driver = row[12];
  const diffKm = row[19];
  let statusVal = 'pending';
  if (driver && String(driver).includes('ยกเลิก')) {
    statusVal = 'cancelled';
  } else if (driver && diffKm !== '' && diffKm !== null && diffKm !== undefined) {
    statusVal = 'completed';
  } else if (driver && driver.trim() !== '') {
    statusVal = 'assigned';
  }
  $('#adm_status').val(statusVal);

  $('#adm_requester').val(row[2] || '');
  $('#adm_dept').val(row[3] || '');
  $('#adm_start').val(toDateTimeLocal(row[4]));
  $('#adm_end').val(toDateTimeLocal(row[5]));
  $('#adm_place').val(row[7] || '');
  $('#adm_subject').val(row[6] || '');
  $('#adm_cartype').val(row[11] || '');
  $('#adm_qty').val(row[8] !== undefined && row[8] !== null ? row[8] : '');
  $('#adm_passengers').val(row[9] || '');
  $('#adm_detail').val(row[10] || '');
  $('#adm_driver').val(row[12] || '');
  $('#adm_plate').val(row[13] || '');
  $('#adm_model').val(row[14] || '');
  $('#adm_act_start').val(toDateTimeLocal(row[15] || row[4]));
  $('#adm_act_end').val(toDateTimeLocal(row[16] || row[5]));
  $('#adm_start_km').val(row[17] !== undefined && row[17] !== null ? row[17] : '');
  $('#adm_end_km').val(row[18] !== undefined && row[18] !== null ? row[18] : '');
  $('#adm_diff_km').val(row[19] !== undefined && row[19] !== null ? row[19] : '');
  $('#adm_fuel').val(row[20] !== undefined && row[20] !== null ? row[20] : '');
  $('#adm_cost').val(row[21] !== undefined && row[21] !== null ? row[21] : '');

  if (modalAdminEdit) {
    modalAdminEdit.show();
  }
}

function setupAdminEditForm() {
  const form = document.getElementById('formAdminEdit');
  if (!form) return;

  $('#adm_start_km, #adm_end_km').on('input', function () {
    const s = parseFloat($('#adm_start_km').val());
    const e = parseFloat($('#adm_end_km').val());
    if (!isNaN(s) && !isNaN(e) && e >= s) {
      $('#adm_diff_km').val(e - s);
    } else {
      $('#adm_diff_km').val('');
    }
  });

  $('#adm_status').on('change', function () {
    const val = $(this).val();
    if (val === 'cancelled') {
      const curDriver = $('#adm_driver').val().trim();
      if (!curDriver.includes('ยกเลิก')) {
        $('#adm_driver').val(curDriver ? `${curDriver} (ยกเลิก)` : 'ยกเลิก');
      }
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = $('#adm_id').val();
    if (!id) return;

    const statusVal = $('#adm_status').val();
    let driverVal = $('#adm_driver').val().trim();
    if (statusVal === 'cancelled' && !driverVal.includes('ยกเลิก')) {
      driverVal = 'ยกเลิก';
    } else if (statusVal !== 'cancelled' && driverVal.includes('ยกเลิก')) {
      driverVal = '';
    }

    const payload = {
      id: id,
      requester: $('#adm_requester').val().trim(),
      dept: $('#adm_dept').val().trim(),
      start: $('#adm_start').val(),
      end: $('#adm_end').val(),
      place: $('#adm_place').val().trim(),
      subject: $('#adm_subject').val().trim(),
      carType: $('#adm_cartype').val().trim(),
      qty: $('#adm_qty').val(),
      passengers: $('#adm_passengers').val().trim(),
      detail: $('#adm_detail').val().trim(),
      driver: driverVal,
      plate: $('#adm_plate').val().trim(),
      model: $('#adm_model').val().trim(),
      actStart: $('#adm_act_start').val(),
      actEnd: $('#adm_act_end').val(),
      startKm: $('#adm_start_km').val(),
      endKm: $('#adm_end_km').val(),
      diffKm: $('#adm_diff_km').val(),
      fuel: $('#adm_fuel').val(),
      cost: $('#adm_cost').val()
    };

    if (modalAdminEdit) modalAdminEdit.hide();

    // Optimistic Update ทันที
    const targetIdx = globalData.findIndex(r => r[0] == id);
    let prevRow = null;
    if (targetIdx !== -1) {
      prevRow = [...globalData[targetIdx]];
      globalData[targetIdx][2] = payload.requester;
      globalData[targetIdx][3] = payload.dept;
      globalData[targetIdx][4] = payload.start;
      globalData[targetIdx][5] = payload.end;
      globalData[targetIdx][6] = payload.subject;
      globalData[targetIdx][7] = payload.place;
      globalData[targetIdx][8] = payload.qty;
      globalData[targetIdx][9] = payload.passengers;
      globalData[targetIdx][10] = payload.detail;
      globalData[targetIdx][11] = payload.carType;
      globalData[targetIdx][12] = payload.driver;
      globalData[targetIdx][13] = payload.plate;
      globalData[targetIdx][14] = payload.model;
      globalData[targetIdx][15] = payload.actStart;
      globalData[targetIdx][16] = payload.actEnd;
      globalData[targetIdx][17] = payload.startKm;
      globalData[targetIdx][18] = payload.endKm;
      globalData[targetIdx][19] = payload.diffKm;
      globalData[targetIdx][20] = payload.fuel;
      globalData[targetIdx][21] = payload.cost;
      saveLocalDataCache(globalData);
      renderTables();
      updateBadgeCounters();
      if (carDashboard) carDashboard.setData(globalData);
    }

    updateSyncBadge('syncing', 'กำลังบันทึกข้อมูล...');

    try {
      const res = await callAPI('updateRecord', payload);
      const updatedRow = res?.data?.updatedRow || res?.updatedRow;
      if (updatedRow && targetIdx !== -1) {
        globalData[targetIdx] = updatedRow;
        saveLocalDataCache(globalData);
        renderTables();
        updateBadgeCounters();
      }
      updateSyncBadge('online', 'ออนไลน์ (ซิงค์แล้ว)');

      Swal.fire({
        icon: 'success',
        title: 'บันทึกสำเร็จ!',
        text: `อัปเดตคำขอเลขที่ ${id} เรียบร้อยแล้ว`,
        timer: 1500,
        showConfirmButton: false
      });
    } catch (err) {
      if (prevRow && targetIdx !== -1) {
        globalData[targetIdx] = prevRow;
        saveLocalDataCache(globalData);
        renderTables();
        updateBadgeCounters();
      }
      updateSyncBadge('offline', 'เกิดข้อผิดพลาดในการบันทึก');
      Swal.fire('เกิดข้อผิดพลาด', err.message || 'ไม่สามารถบันทึกข้อมูลได้', 'error');
    }
  });
}

async function adminDeleteRecord(id) {
  if (!id) return;

  const confirm = await Swal.fire({
    title: 'ยืนยันการลบข้อมูล?',
    html: `คุณต้องการลบคำขอเลขที่ <b class="text-danger">${id}</b> ออกจากระบบอย่างถาวรหรือไม่?<br><small class="text-muted">ข้อมูลจะถูกลบทั้งใน Cloudflare D1 และ Google Sheets</small>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'ใช่, ต้องการลบ!',
    cancelButtonText: 'ยกเลิก'
  });

  if (!confirm.isConfirmed) return;

  const targetIdx = globalData.findIndex(r => r[0] == id);
  const deletedRow = targetIdx !== -1 ? [...globalData[targetIdx]] : null;

  // Optimistic Delete ทันที
  if (targetIdx !== -1) {
    globalData.splice(targetIdx, 1);
    saveLocalDataCache(globalData);
    renderTables();
    updateBadgeCounters();
    if (carDashboard) carDashboard.setData(globalData);
  }

  updateSyncBadge('syncing', 'กำลังลบข้อมูล...');

  try {
    await callAPI('deleteRecord', { id });
    updateSyncBadge('online', 'ออนไลน์ (ซิงค์แล้ว)');

    Swal.fire({
      icon: 'success',
      title: 'ลบข้อมูลสำเร็จ!',
      text: `ลบคำขอเลขที่ ${id} เรียบร้อยแล้ว`,
      timer: 1500,
      showConfirmButton: false
    });
  } catch (err) {
    // Rollback
    if (deletedRow && targetIdx !== -1) {
      globalData.splice(targetIdx, 0, deletedRow);
      saveLocalDataCache(globalData);
      renderTables();
      updateBadgeCounters();
      if (carDashboard) carDashboard.setData(globalData);
    }
    updateSyncBadge('offline', 'เกิดข้อผิดพลาดในการลบ');
    Swal.fire('เกิดข้อผิดพลาด', err.message || 'ไม่สามารถลบข้อมูลได้', 'error');
  }
}

async function adminDeleteCurrentRecord() {
  const id = $('#adm_id').val();
  if (!id) return;
  if (modalAdminEdit) modalAdminEdit.hide();
  await adminDeleteRecord(id);
}

function exportAdminCSV() {
  if (!globalData || globalData.length === 0) {
    return Swal.fire('ไม่มีข้อมูล', 'ยังไม่มีรายการคำขอในระบบสำหรับส่งออก', 'info');
  }

  const headers = [
    'เลขที่คำขอ', 'วันเวลาที่บันทึก', 'ผู้ขอ', 'กลุ่มงาน', 'วันเวลาเดินทาง', 'วันเวลากลับ',
    'เรื่อง/วัตถุประสงค์', 'สถานที่ไป', 'จำนวนคน', 'ผู้ร่วมเดินทาง', 'รายละเอียด', 'ประเภทรถ',
    'พขร.', 'ทะเบียนรถ', 'ยี่ห้อรถ', 'ออกจริง', 'กลับจริง', 'ไมล์เริ่มต้น', 'ไมล์สิ้นสุด',
    'ระยะทาง(กม.)', 'น้ำมัน(ลิตร)', 'ค่าน้ำมัน(บาท)', 'EventID', 'จำนวนพิมพ์'
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  let csvContent = '\uFEFF'; // UTF-8 BOM สำหรับเปิดใน MS Excel
  csvContent += headers.map(escapeCSV).join(',') + '\r\n';

  globalData.forEach(row => {
    if (!row || !row[0]) return;
    const rowLine = [];
    for (let i = 0; i < 24; i++) {
      rowLine.push(escapeCSV(row[i]));
    }
    csvContent += rowLine.join(',') + '\r\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  a.href = url;
  a.download = `car_requests_export_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function lockAdminSession() {
  unlockedAdmin = false;
  Swal.fire({
    icon: 'info',
    title: 'ออกจากโหมด Admin แล้ว',
    text: 'ล็อกระบบจัดการเรียบร้อยแล้ว',
    timer: 1500,
    showConfirmButton: false
  });
  switchPage('page-dashboard');
}

window.openAdminEdit = openAdminEdit;
window.adminDeleteRecord = adminDeleteRecord;
window.adminDeleteCurrentRecord = adminDeleteCurrentRecord;
window.exportAdminCSV = exportAdminCSV;
window.lockAdminSession = lockAdminSession;
