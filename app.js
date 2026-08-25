// *** ใส่ URL Web App ของคุณที่อัปเดตใหม่ล่าสุดตรงนี้ ***
  const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwoatvXXCf37JqNgYsF0WrQNxDgKLklRrQnCQfNAHVW8ECJIvnxZw3Bc-LZWva8jB6L2Q/exec'; 
  
  let globalData = []; let carList = []; let userList = []; 
  let unlockedAssign = false; let unlockedDriver = false; let unlockedOil = false;
  let calendar; let charts = {}; 

  // 🟢 เพิ่ม 2 บรรทัดนี้เพื่อป้องกันการโหลดซ้อน
  let isFetchingData = false; 
  let isFetchingOil = false;

  // ข้อมูลน้ำมัน
  let oilPendingList = []; let oilHistoryList = [];

  // ระบบวาดลายเซ็น (Canvas)
  let sigPad1, sigPad2;

  async function loadOptions() {
    try {
      const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'getOptions' }) });
      const json = await res.json();
      if (json.status === 'success') {
        const d = json.data;
        userList = d.users;
        populateSelect('req_c', userList.map(u => u.name), 'เลือกผู้ขอ');
        populateSelect('assign_m', d.drivers, 'เลือกผู้ขับรถ');
        populateSelect('filterDriver', d.drivers, '-- กรองผู้ขับรถทั้งหมด --'); 
        
        carList = d.cars;
        const plateSelect = document.getElementById('assign_n');
        const oilCarSelect = document.getElementById('oilCar');
        plateSelect.innerHTML = '<option value="" disabled selected>เลือกทะเบียนรถ</option>';
        oilCarSelect.innerHTML = '<option value="">-- เลือกทะเบียนรถ --</option>';
        carList.forEach(c => {
          plateSelect.innerHTML += `<option value="${c.plate}">${c.plate}</option>`;
          oilCarSelect.innerHTML += `<option value="${c.plate}">${c.plate}</option>`;
        });
      }
    } catch(err) { console.error(err); }
  }

  document.getElementById('req_c').addEventListener('change', function() {
     const selectedUser = userList.find(u => u.name === this.value);
     document.getElementById('req_d').value = selectedUser ? selectedUser.group : ''; 
  });

  function populateSelect(id, arr, placeholder) {
    const el = document.getElementById(id); el.innerHTML = `<option value="" selected>${placeholder}</option>`;
    arr.forEach(item => el.innerHTML += `<option value="${item}">${item}</option>`);
  }
  document.getElementById('assign_n').addEventListener('change', function() {
     const selectedCar = carList.find(c => c.plate === this.value);
     if(selectedCar) document.getElementById('assign_o').value = selectedCar.model;
  });

  window.onload = () => {
    loadOptions(); 
    loadData(true); // 🟢 สั่งให้โหลดข้อมูลเงียบๆ เป็นพื้นหลัง (ส่งค่า true)
    sigPad1 = initCanvas('sigCanvas1');
    sigPad2 = initCanvas('sigCanvas2');
  };

function switchPage(pageId, tabElement) {
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById(pageId).classList.add('active');
    if (tabElement) {
      tabElement.classList.add('active');
      if (tabElement.classList.contains('dropdown-item')) {
        tabElement.closest('.nav-item').querySelector('.nav-link').classList.add('active');
      }
    }
    
    // วาดกราฟ/ปฏิทินทันที (ถ้ามีข้อมูลแล้ว)
    if (pageId === 'page-calendar' && globalData.length > 0) {
      if (!calendar) renderCalendar(); else setTimeout(() => calendar.render(), 50);
    } else if (pageId === 'page-dashboard' && globalData.length > 0) {
      updateDashboard();
    }

    // จัดการการโหลดข้อมูลเบื้องหลัง
    if (pageId === 'page-oil') {
      if (oilHistoryList.length === 0) loadOilData(false); 
      else loadOilData(true); 
    } else if (pageId !== 'page-request') {
      if (globalData.length === 0) loadData(false); 
      else loadData(true); 
    }
  }

  async function checkLoginAndSwitch(pageId, tabElement) {
    if (pageId === 'page-assign' && !unlockedAssign) {
      const { value: pass } = await Swal.fire({ title: '🔑 จัดรถ', input: 'password', showCancelButton: true });
      if (!pass) return;
      try {
        const res = await callAPI('checkAuth', { type: 'assign', pass: pass });
        if(res.data === true) { unlockedAssign = true; Swal.fire('สำเร็จ', 'ปลดล็อก', 'success'); } else return Swal.fire('ผิดพลาด', 'รหัสผิด!', 'error');
      } catch(e) { return Swal.fire('ผิดพลาด', 'ระบบมีปัญหา: ' + e.message, 'error'); }
    }
    if (pageId === 'page-driver' && !unlockedDriver) {
      const { value: pass } = await Swal.fire({ title: '👨‍✈️ รายงาน พขร.', input: 'password', showCancelButton: true });
      if (!pass) return;
      try {
        const res = await callAPI('checkAuth', { type: 'driver', pass: pass });
        if(res.data === true) { unlockedDriver = true; Swal.fire('สำเร็จ', 'ปลดล็อก', 'success'); } else return Swal.fire('ผิดพลาด', 'รหัสผิด!', 'error');
      } catch(e) { return Swal.fire('ผิดพลาด', 'ระบบมีปัญหา: ' + e.message, 'error'); }
    }
    switchPage(pageId, tabElement);
  }

  async function callAPI(action, payload) {
    Swal.fire({ title: 'รอสักครู่...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action, payload }) });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.message);
      return data;
    } catch (err) { Swal.fire('ข้อผิดพลาด', err.message, 'error'); throw err; }
  }

  document.getElementById('formRequest').addEventListener('submit', async (e) => {
    e.preventDefault();
    const st = new Date(document.getElementById('req_e').value); const en = new Date(document.getElementById('req_f').value);
    if (en - st < 1800000) return Swal.fire('ข้อผิดพลาด', 'เวลาถึงต้องมากกว่าเวลาขอ อย่างน้อย 30 นาที', 'error');
    const parseThaiDate = val => { if(!val) return val; let [d, t] = val.split('T'); let [y, m, day] = d.split('-'); let yInt = parseInt(y); if(yInt > 2500) yInt -= 543; return `${yInt}-${m}-${day}T${t}`; };
    const payload = { requester: $('#req_c').val(), group: $('#req_d').val(), start: parseThaiDate($('#req_e').val()), end: parseThaiDate($('#req_f').val()), subject: $('#req_g').val(), place: $('#req_h').val(), qty: $('#req_i').val(), include: $('#req_j').val(), detail: $('#req_k').val(), carType: $('#req_l').val() };
    const res = await callAPI('requestCar', payload);
    Swal.fire('สำเร็จ', `สร้างคำขอสำเร็จ ID: ${res.data.id}`, 'success'); e.target.reset();
  });

// 🟢 เพิ่มพารามิเตอร์ silent เพื่อบอกว่าต้องโชว์หน้าต่างโหลดไหม (ค่าเริ่มต้นคือ โหลดเงียบๆ)
async function loadData(silent = true) {
    if (isFetchingData) return; // ถ้ากำลังโหลดอยู่ ให้ข้ามไปเลย (ป้องกันค้าง)
    isFetchingData = true; // ล็อกการโหลด
    
    if (!silent) Swal.fire({ title: 'กำลังดึงข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
      const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'getData' }) });
      const json = await res.json();
      
      if (json.status !== 'success') throw new Error(json.message);
      
      globalData = json.data || []; 
      renderTables();
      
      // วาดกราฟและปฏิทินเฉพาะตอนที่ผู้ใช้อยู่หน้านั้นจริงๆ
      if (document.getElementById('page-calendar').classList.contains('active')) {
        if (!calendar) renderCalendar(); else calendar.render();
      }
      if (document.getElementById('page-dashboard').classList.contains('active')) {
        updateDashboard();
      }
      
    } catch (err) { 
      console.error("Load Data Error:", err);
      if (!silent) Swal.fire('ข้อผิดพลาด', 'โหลดข้อมูลไม่สำเร็จ: ' + err.message, 'error'); 
    } finally {
      // โหลดเสร็จแล้ว ปลดล็อก
      isFetchingData = false;
      if (!silent) Swal.close();
    }
  }

  function formatDateUI(dStr) {
    if (!dStr) return '-'; const d = new Date(dStr);
    return isNaN(d) ? dStr : d.toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
  }

  function renderTables() {
    let assignData = []; let driverData = []; let reportData = [];

    globalData.forEach((row) => {
      const id = row[0]; const start = formatDateUI(row[4]); const end = formatDateUI(row[5]);
      const req = row[2]; const subj = row[6]; const place = row[7]; const cType = row[11];
      const driver = row[12]; const plate = row[13]; const diffKm = row[19]; const printCount = parseInt(row[23]) || 0; 
      
      let status = 'รอจัดรถ'; let badge = 'danger';
      if (driver) {
        if (String(driver).includes('ยกเลิก')) { status = 'ยกเลิก'; badge = 'secondary'; }
        else if (diffKm !== '') { status = 'เสร็จสิ้น'; badge = 'success'; }
        else { status = 'รอขับรถ'; badge = 'warning'; }
      }

      if (id && (!driver || !String(driver).includes('ยกเลิก'))) {
        let assignBtn = !driver ? `<button class="btn btn-sm btn-warning" onclick="openAssign('${id}')">จัดรถ</button>` : `<button class="btn btn-sm btn-success" onclick="openAssign('${id}')">แก้ไข</button>`;
        assignData.push([assignBtn, id, start, `<span class="text-danger">${end}</span>`, req, subj, place, cType]);
      }

      if (driver && id && !String(driver).includes('ยกเลิก')) {
        let driverBtn = diffKm === '' ? `<button class="btn btn-sm btn-info text-white" onclick="openDriver('${id}')">บันทึกขับ</button>` : `<button class="btn btn-sm btn-primary" onclick="openDriver('${id}')">แก้ไข</button>`;
        driverData.push([driverBtn, id, start, `<span class="text-danger">${end}</span>`, req, place, driver, plate]);
      }

      if (id) {
        let printBadge = printCount > 0 ? ` <span class="badge bg-info text-dark">พิมพ์ ${printCount}</span>` : '';
        reportData.push([
            `<button class="btn btn-sm btn-outline-primary" onclick="openView('${id}', false)">🔍 ข้อมูล</button>`, 
            id, 
            `<span class="badge bg-${badge}">${status}</span>${printBadge}`, 
            start, 
            `<span class="text-danger">${end}</span>`, 
            req, 
            place, 
            driver || '-', 
            plate || '-', 
            diffKm !== '' ? diffKm + ' กม.' : '-'
        ]);
      }
    });

    updateDataTable('#tableAssign', assignData, [[1, 'desc']]);
    
    if (!$.fn.DataTable.isDataTable('#tableDriver')) {
        const tableDr = $('#tableDriver').DataTable({ data: driverData, responsive: true, language: { url: "//cdn.datatables.net/plug-ins/1.13.6/i18n/th.json" }, order: [[1, 'desc']], stateSave: true });
        $('#filterDriver').off('change').on('change', function() { tableDr.column(6).search(this.value).draw(); }); 
    } else {
        $('#tableDriver').DataTable().clear().rows.add(driverData).draw(false);
    }
    
    updateDataTable('#tableReport', reportData, [[1, 'desc']]);
  }

  function updateDataTable(selector, dataset, order) {
      if ($.fn.DataTable.isDataTable(selector)) {
          $(selector).DataTable().clear().rows.add(dataset).draw(false);
      } else {
          $(selector).DataTable({
              data: dataset, responsive: true,
              language: { url: "//cdn.datatables.net/plug-ins/1.13.6/i18n/th.json" },
              order: order,
              stateSave: true
          });
      }
  }

  function toDateTimeLocal(isoStr) {
    if (!isoStr) return ''; const d = new Date(isoStr);
    if (isNaN(d)) return ''; const tzoffset = (new Date()).getTimezoneOffset() * 60000; 
    return (new Date(d - tzoffset)).toISOString().slice(0, 16);
  }

  const modalAssign = new bootstrap.Modal(document.getElementById('modalAssign'));
  function openAssign(id) {
    $('#assign_id').val(id); $('#assign_id_lbl').text(id); $('#formAssign')[0].reset();
    const row = globalData.find(r => r[0] == id);
    if (row) { if(row[12]) $('#assign_m').val(row[12]); if(row[13]){ $('#assign_n').val(row[13]); $('#assign_o').val(row[14]); } }
    modalAssign.show();
  }
  document.getElementById('formAssign').addEventListener('submit', async (e) => {
    e.preventDefault();
    await callAPI('assignCar', { id: $('#assign_id').val(), driver: $('#assign_m').val(), plate: $('#assign_n').val(), model: $('#assign_o').val() });
    Swal.fire('สำเร็จ', 'บันทึกเรียบร้อย', 'success'); modalAssign.hide(); loadData(); 
  });

  const modalDriver = new bootstrap.Modal(document.getElementById('modalDriver'));
  function openDriver(id) {
    $('#driver_id').val(id); $('#driver_id_lbl').text(id); $('#formDriver')[0].reset(); 
    const row = globalData.find(r => r[0] == id);
    if (row) {
      if(row[15]) $('#driver_p').val(toDateTimeLocal(row[15])); if(row[16]) $('#driver_q').val(toDateTimeLocal(row[16]));
      if(row[17] !== '') $('#driver_r').val(row[17]); if(row[18] !== '') $('#driver_s').val(row[18]);
      if(row[19] !== '') $('#driver_t').val(row[19]); if(row[20] !== '') $('#driver_u').val(row[20]);
      if(row[21] !== '') $('#driver_v').val(row[21]);
    }
    modalDriver.show();
  }
  function calcKM() {
    const start = parseFloat($('#driver_r').val()) || 0; const end = parseFloat($('#driver_s').val()) || 0; const diff = end - start;
    $('#driver_t').val(diff);
    if (diff <= 0 && $('#driver_s').val() !== '') $('#driver_t').addClass('is-invalid'); else $('#driver_t').removeClass('is-invalid');
  }
  $('#driver_r, #driver_s').on('input', calcKM);
  document.getElementById('formDriver').addEventListener('submit', async (e) => {
    e.preventDefault();
    const actSt = new Date($('#driver_p').val()); const actEn = new Date($('#driver_q').val()); const diffKm = parseFloat($('#driver_t').val());
    if (actEn - actSt < 1800000) return Swal.fire('ผิดพลาด', '"ขับถึงจริง" ต้องมากกว่า "ขับจริง" > 30 นาที', 'error');
    if (diffKm <= 0) return Swal.fire('ผิดพลาด', 'เลขกิโลเมตรถึง ต้องมากกว่ากิโลเมตรเริ่ม', 'error');
    await callAPI('driverReport', { id: $('#driver_id').val(), actStart: $('#driver_p').val(), actEnd: $('#driver_q').val(), startKm: $('#driver_r').val(), endKm: $('#driver_s').val(), diffKm: diffKm, fuel: $('#driver_u').val(), cost: $('#driver_v').val() });
    Swal.fire('สำเร็จ', 'บันทึกเรียบร้อย', 'success'); modalDriver.hide(); loadData(); 
  });

  const modalView = new bootstrap.Modal(document.getElementById('modalView'));
  function openView(id, fromCalendar = false) {
    $('#view_id_lbl').text(id); const row = globalData.find(r => r[0] == id); if(!row) return;
    $('#viewBody').html(`
      <div class="col-md-6 mb-2"><b>ผู้ขอ:</b> ${row[2] || '-'} (${row[3] || '-'})</div><div class="col-md-6 mb-2"><b>ประเภทรถ:</b> ${row[11] || '-'}</div>
      <div class="col-md-6 mb-2"><b>ขอวันที่:</b> ${formatDateUI(row[4])}</div><div class="col-md-6 mb-2"><b>ถึงวันที่:</b> <span class="text-danger">${formatDateUI(row[5])}</span></div>
      <div class="col-md-12 mb-2"><b>เรื่อง:</b> ${row[6] || '-'}</div><div class="col-md-12 mb-2"><b>สถานที่:</b> ${row[7] || '-'}</div>
      <div class="col-md-12 mb-2"><b>ผู้เดินทาง:</b> ${row[8]} คน (ได้แก่: ${row[9] || '-'})</div><hr>
      <div class="col-md-6 mb-2"><b>พนักงานขับรถ:</b> ${row[12] || '-'}</div><div class="col-md-6 mb-2"><b>ทะเบียนรถ:</b> ${row[13] || '-'} (${row[14] || '-'})</div>
      <div class="col-md-6 mb-2"><b>เลขไมล์:</b> ${row[17] || '-'} ถึง ${row[18] || '-'} (ระยะ: ${row[19] || '-'})</div>
      <div class="col-md-6 mb-2"><b>เติมน้ำมัน:</b> ${row[20] || '-'} ลิตร (${row[21] || '-'} บาท)</div>
    `);
    $('#btnPrintDoc').toggle(!fromCalendar); modalView.show();
  }
// 🟢 ฟังก์ชันช่วยแปลงวันที่สำหรับหน้าพิมพ์
  function pDate(dStr) {
    if(!dStr) return ''; const d = new Date(dStr); if(isNaN(d)) return '';
    const m = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
    return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()+543}`;
  }
  function pTime(dStr) {
    if(!dStr) return ''; const d = new Date(dStr); if(isNaN(d)) return '';
    return `${('0'+d.getHours()).slice(-2)}:${('0'+d.getMinutes()).slice(-2)} น.`;
  }

  // 🟢 ฟังก์ชันสั่งพิมพ์
  async function printDoc() {
    const id = $('#view_id_lbl').text();
    const row = globalData.find(r => r[0] == id);
    if(!row) return;

    // เติมข้อมูลลงในแบบฟอร์ม
    $('#prt_id').text(row[0] || '');
    $('#prt_date').text(pDate(row[1]));
    $('#prt_req').text(row[2] || ''); $('#prt_req_name').text(row[2] || ''); $('#prt_req_sign').text(row[2] || '');
    $('#prt_group').text(row[3] || '');
    $('#prt_subj').text(row[6] || '');
    $('#prt_place').text(row[7] || ''); $('#prt_aplace').text(row[7] || '');
    $('#prt_qty').text(row[8] || '');
    $('#prt_include').text(row[9] || '');
    
    // เวลาขอ
    $('#prt_sd').text(pDate(row[4])); $('#prt_st').text(pTime(row[4]));
    $('#prt_ed').text(pDate(row[5])); $('#prt_et').text(pTime(row[5]));

    // จัดรถ
    $('#prt_model').text(row[14] || ''); $('#prt_amodel').text(row[14] || '');
    $('#prt_plate').text(row[13] || ''); $('#prt_aplate').text(row[13] || '');
    $('#prt_driver').text(row[12] || ''); $('#prt_d_name').text(row[12] || ''); $('#prt_d_sign').text(row[12] || '');
    $('#prt_fuel').text(row[20] || ''); $('#prt_cost').text(row[21] || '');

    // พขร. ขับจริง
    $('#prt_asd').text(pDate(row[15])); $('#prt_ast').text(pTime(row[15]));
    $('#prt_aed').text(pDate(row[16])); $('#prt_aet').text(pTime(row[16]));
    $('#prt_skm').text(row[17] || ''); $('#prt_ekm').text(row[18] || ''); $('#prt_dkm').text(row[19] || '');

    // ปิด Modal รายละเอียดก่อน
    modalView.hide();

    // หน่วงเวลาเล็กน้อยให้หน้าต่าง Modal หายไปก่อน แล้วค่อยเด้งหน้าต่าง Print
    setTimeout(() => {
       window.print();
       
       // แอบบันทึกสถิติการพิมพ์ไว้เบื้องหลัง
       fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'printDoc', payload: { id: id } }) })
         .then(() => loadData(true)).catch(e => console.error(e));
         
    }, 500); 
  }
// ================= 🟢 ฟังก์ชันปฏิทิน 🟢 =================
  function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (calendar) calendar.destroy();

    const events = globalData.map(row => {
      const id = row[0]; const start = row[4]; const end = row[5];
      const place = row[7] || 'ไม่ระบุสถานที่'; const driver = row[12];
      const plate = row[13] ? `(${row[13]})` : '(ยังไม่จัดรถ)';
      const diffKm = row[19];

      let color = '#dc3545'; 
      if (driver) {
        if (driver.includes('ยกเลิก')) color = '#6c757d'; 
        else if (diffKm !== '') color = '#198754'; 
        else color = '#ffc107'; 
      }

      return {
        id: id, title: `${place} ${plate}`, start: start, end: end,
        backgroundColor: color, borderColor: color, textColor: color === '#ffc107' ? '#000' : '#fff' 
      };
    }).filter(event => event.id);

    calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth', 
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' },
      locale: 'th', 
      events: events,
      eventClick: function(info) {
        openView(info.event.id, true); 
      }
    });
    calendar.render();
  }

  // ================= 🟢 ฟังก์ชันแดชบอร์ด 🟢 =================
  function toggleDashFilters() {
    const type = document.getElementById('dashFilterType').value;
    document.getElementById('f-date').style.display = type === 'date' ? 'flex' : 'none';
    document.getElementById('f-month').style.display = type === 'month' ? 'block' : 'none';
    document.getElementById('f-fy').style.display = type === 'fy' ? 'block' : 'none';
  }

  function initDashFY() {
    const fys = new Set();
    globalData.forEach(r => {
      let dVal = r[15] || r[4]; 
      if(dVal) {
        const d = new Date(dVal);
        if(!isNaN(d)) {
           let m = d.getMonth() + 1;
           let y = d.getFullYear() + 543;
           fys.add(m >= 10 ? y + 1 : y); 
        }
      }
    });
    const sel = document.getElementById('dashFY');
    sel.innerHTML = '';
    Array.from(fys).sort().reverse().forEach(fy => {
       sel.innerHTML += `<option value="${fy}">${fy}</option>`;
    });
  }

  function updateDashboard() {
    if(Object.keys(charts).length === 0) initDashFY(); 

    const type = document.getElementById('dashFilterType').value;
    let filteredData = globalData.filter(r => r[0] && !(r[12] && String(r[12]).includes('ยกเลิก')));

    if (type === 'date') {
      const sd = new Date(document.getElementById('dashStartDate').value);
      const ed = new Date(document.getElementById('dashEndDate').value);
      ed.setHours(23,59,59,999);
      if(!isNaN(sd) && !isNaN(ed)) {
        filteredData = filteredData.filter(r => {
          const d = new Date(r[15] || r[4]); return d >= sd && d <= ed;
        });
      }
    } else if (type === 'month') {
      const val = document.getElementById('dashMonth').value; 
      if(val) {
        const [yy, mm] = val.split('-');
        filteredData = filteredData.filter(r => {
          const d = new Date(r[15] || r[4]);
          return d.getFullYear() == yy && (d.getMonth() + 1) == mm;
        });
      }
    } else if (type === 'fy') {
      const targetFy = parseInt(document.getElementById('dashFY').value);
      if(targetFy) {
         filteredData = filteredData.filter(r => {
           const d = new Date(r[15] || r[4]);
           if(isNaN(d)) return false;
           let m = d.getMonth() + 1; let y = d.getFullYear() + 543;
           return (m >= 10 ? y + 1 : y) === targetFy;
         });
      }
    }

    const dailyCounts = {};
    const carCounts = {};
    const driverCounts = {};
    const carKMs = {}; 

    filteredData.forEach(r => {
      if (!r[15]) return; 

      let st = new Date(r[15]);
      if (isNaN(st)) return;
      let en = new Date(r[16]);
      if (isNaN(en)) en = st; 

      let current = new Date(st);
      current.setHours(0,0,0,0);
      let endDay = new Date(en);
      endDay.setHours(0,0,0,0);
      
      let daysCount = 0;
      while(current <= endDay) {
          const dateStr = `${('0'+current.getDate()).slice(-2)}/${('0'+(current.getMonth()+1)).slice(-2)}/${current.getFullYear()+543}`;
          dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
          current.setDate(current.getDate() + 1);
          daysCount++;
      }
      if(daysCount === 0) daysCount = 1;

      const plate = r[13];
      if(plate) {
         carCounts[plate] = (carCounts[plate] || 0) + daysCount; 
         
         const kmSt = parseFloat(r[17]);
         const kmEn = parseFloat(r[18]);
         if(!carKMs[plate]) carKMs[plate] = { min: Infinity, max: -Infinity };
         if(!isNaN(kmSt) && kmSt < carKMs[plate].min) carKMs[plate].min = kmSt;
         if(!isNaN(kmEn) && kmEn > carKMs[plate].max) carKMs[plate].max = kmEn;
      }

      const driver = r[12];
      if(driver) {
         driverCounts[driver] = (driverCounts[driver] || 0) + daysCount; 
      }
    });

    const carKmLabels = []; const carKmData = [];
    for(let plate in carKMs) {
      if(carKMs[plate].min !== Infinity && carKMs[plate].max !== -Infinity) {
        let diff = carKMs[plate].max - carKMs[plate].min;
        if(diff > 0) { carKmLabels.push(plate); carKmData.push(diff); }
      }
    }

    renderChart('chartDaily', 'line', 'จำนวนการใช้รถ (ครั้ง/วัน)', Object.keys(dailyCounts), Object.values(dailyCounts), '#0d6efd', false);
    renderChart('chartCarCount', 'bar', 'จำนวนครั้งที่ใช้รถแต่ละคัน (นับตามวัน)', Object.keys(carCounts), Object.values(carCounts), '#198754', true);
    renderChart('chartDriverCount', 'bar', 'จำนวนครั้งของ พขร. (นับตามวัน)', Object.keys(driverCounts), Object.values(driverCounts), '#ffc107', true);
    renderChart('chartCarKm', 'bar', 'ระยะทางที่ขับรวม (กม.)', carKmLabels, carKmData, '#dc3545', true);
  }

  function renderChart(canvasId, type, label, labels, data, color, isHorizontal = false) {
    if(charts[canvasId]) charts[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    let options = { responsive: true, maintainAspectRatio: false };
    if(isHorizontal) {
       options.indexAxis = 'y'; 
       options.scales = { x: { beginAtZero: true } };
    } else {
       options.scales = { y: { beginAtZero: true } };
    }
    
    charts[canvasId] = new Chart(ctx, {
      type: type,
      data: {
        labels: labels,
        datasets: [{ label: label, data: data, backgroundColor: color, borderColor: color, borderWidth: 1 }]
      },
      options: options
    });
  }

  // ================= 🟢 ฟังก์ชันระบบน้ำมัน 🟢 =================
  const modalOilReq = new bootstrap.Modal(document.getElementById('modalOilRequest'));
  const modalOilPen = new bootstrap.Modal(document.getElementById('modalOilPending'));
  const modalOilApp = new bootstrap.Modal(document.getElementById('modalOilApprove'));
  const modalOilRep = new bootstrap.Modal(document.getElementById('modalOilReport'));

async function loadOilData(silent = true) {
    if (isFetchingOil) return; // ถ้ากำลังโหลดอยู่ ให้ข้าม
    isFetchingOil = true; // ล็อก
    
    if (!silent) Swal.fire({ title: 'โหลดข้อมูลน้ำมัน...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
      const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ action: 'getOilData' }) });
      const json = await res.json();
      
      if(json.status !== 'success') throw new Error(json.message);
      
      const d = json.data;
      $('#oilBalanceDisplay').text(parseFloat(d.balance || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
      oilPendingList = d.pending || [];
      oilHistoryList = d.history || [];
      
    } catch(err) { 
      console.error("Load Oil Data Error:", err);
      if (!silent) Swal.fire('ผิดพลาดระบบน้ำมัน', err.message, 'error'); 
    } finally {
      // โหลดเสร็จแล้ว ปลดล็อก
      isFetchingOil = false;
      if (!silent) Swal.close();
    }
  }
  function toggleOilType() {
    const type = $('#oilType').val();
    if(type === 'out') {
      $('#oilCarDiv').show(); $('#oilCar').prop('required', true);
    } else {
      $('#oilCarDiv').hide(); $('#oilCar').prop('required', false).val('');
    }
  }

  function openOilRequest() {
    $('#formOilRequest')[0].reset(); toggleOilType(); clearCanvas(sigPad1); modalOilReq.show();
  }

  document.getElementById('formOilRequest').addEventListener('submit', async (e) => {
    e.preventDefault();
    if(isCanvasBlank(document.getElementById('sigCanvas1'))) return Swal.fire('คำเตือน', 'กรุณาเซ็นชื่อก่อนบันทึก', 'warning');
    const type = $('#oilType').val(); const qty = parseFloat($('#oilQty').val());
    const payload = {
       inQty: type === 'in' ? qty : '', outQty: type === 'out' ? qty : '',
       car: $('#oilCar').val() || '', detail: $('#oilDetail').val(),
       sig1: document.getElementById('sigCanvas1').toDataURL()
    };
    await callAPI('requestOil', payload);
    Swal.fire('สำเร็จ', 'ส่งรายการรออนุมัติแล้ว', 'success'); modalOilReq.hide(); loadOilData();
  });

  async function checkLoginOilApprove() {
    if(!unlockedOil) {
      const { value: pass } = await Swal.fire({ title: '🔐 ปลดล็อกสำหรับผู้อนุมัติ', input: 'password', showCancelButton: true });
      if (!pass) return;
      try {
        const res = await callAPI('checkAuth', { type: 'oil', pass: pass });
        if(res.data === true) { unlockedOil = true; Swal.fire('สำเร็จ', 'เข้าสู่ระบบอนุมัติ', 'success'); } 
        else { return Swal.fire('ผิดพลาด', 'รหัสผิด!', 'error'); }
      } catch(e) { return Swal.fire('ผิดพลาด', 'ระบบมีปัญหา: ' + e.message, 'error'); }
    }
    openOilPending();
  }

  function openOilPending() {
    let pendingData = [];
    oilPendingList.forEach(item => {
      const r = item.data;
      const typeStr = r[1] ? '<span class="badge bg-success">นำเข้า</span>' : '<span class="badge bg-danger">เบิกออก</span>';
      const qty = r[1] ? r[1] : r[2];
      const img = r[6] ? `<img src="${r[6]}" style="height:30px; border:1px solid #ccc;">` : '';
      pendingData.push([
        `<button class="btn btn-sm btn-primary" onclick="openOilApprove(${item.row})">✍️ พิจารณา</button>`,
        formatDateUI(r[0]), typeStr, `<span class="fw-bold">${qty}</span>`,
        r[4]||'-', r[5], img
      ]);
    });
    updateDataTable('#tableOilPending', pendingData, []);
    modalOilPen.show();
  }

  function openOilApprove(rowNum) {
    const item = oilPendingList.find(x => x.row === rowNum);
    if(!item) return;
    const r = item.data;
    const typeTxt = r[1] ? `นำเข้า ${r[1]} ลิตร` : `เบิกออก ${r[2]} ลิตร`;
    $('#oilApproveSummary').html(`กำลังอนุมัติรายการ: <b>${typeTxt}</b><br>รายละเอียด: ${r[5]}<br>ป้ายทะเบียน: ${r[4]||'-'}`);
    $('#oilApproveRow').val(rowNum);
    $('#oilNote').val(''); clearCanvas(sigPad2);
    modalOilPen.hide(); modalOilApp.show();
  }

  document.getElementById('formOilApprove').addEventListener('submit', async (e) => {
    e.preventDefault();
    if(isCanvasBlank(document.getElementById('sigCanvas2'))) return Swal.fire('คำเตือน', 'กรุณาเซ็นชื่ออนุมัติ', 'warning');
    const payload = {
      row: $('#oilApproveRow').val(), note: $('#oilNote').val(), sig2: document.getElementById('sigCanvas2').toDataURL()
    };
    await callAPI('approveOil', payload);
    Swal.fire('สำเร็จ', 'อนุมัติเรียบร้อย ยอดคงเหลือถูกอัปเดตแล้ว', 'success'); modalOilApp.hide(); loadOilData();
  });

  function openOilReport() {
    let repData = [];
    oilHistoryList.forEach(item => {
      const r = item.data;
      const status = item.approved ? '<span class="badge bg-success">อนุมัติแล้ว</span>' : '<span class="badge bg-warning text-dark">รออนุมัติ</span>';
      const sig1 = r[6] ? `<img src="${r[6]}" height="25">` : '';
      const sig2 = r[7] ? `<img src="${r[7]}" height="25">` : '-';
      repData.push([
        status, formatDateUI(r[0]),
        `<span class="text-success">${r[1]||'-'}</span>`, `<span class="text-danger">${r[2]||'-'}</span>`,
        `<span class="fw-bold text-primary">${r[3]||'-'}</span>`,
        r[4]||'-', `${r[5]}<br><small class="text-muted">${r[8]||''}</small>`,
        sig1, sig2
      ]);
    });
    updateDataTable('#tableOilReport', repData, [[1, 'desc']]);
    modalOilRep.show();
  }

  // --- HTML5 Canvas Signature ---
  function initCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    let drawing = false;

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width || 300; canvas.height = 150;
      ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000';
    };
    resize();

    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const start = (e) => { e.preventDefault(); drawing = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); };
    const draw = (e) => { e.preventDefault(); if (!drawing) return; const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); };
    const stop = (e) => { e.preventDefault(); drawing = false; };

    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', draw); canvas.addEventListener('mouseup', stop); canvas.addEventListener('mouseout', stop);
    canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', draw, { passive: false }); canvas.addEventListener('touchend', stop, { passive: false });
    return { canvas, ctx, resize };
  }
  function clearCanvas(pad) { pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height); }
  function isCanvasBlank(canvas) {
    const blank = document.createElement('canvas'); blank.width = canvas.width; blank.height = canvas.height;
    return canvas.toDataURL() === blank.toDataURL();
  }

  // ================= ป้องกันคัดลอก =================
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key)) || (e.ctrlKey && ['u','U','c','C'].includes(e.key))) {
      e.preventDefault(); Swal.fire({ icon: 'warning', title: 'สงวนลิขสิทธิ์', text: 'ไม่อนุญาตให้คัดลอกข้อมูล', timer: 1500, showConfirmButton: false });
    }
  });

  // Resize canvas when modal opens on mobile
  document.getElementById('modalOilRequest').addEventListener('shown.bs.modal', () => { if(sigPad1) sigPad1.resize(); });
  document.getElementById('modalOilApprove').addEventListener('shown.bs.modal', () => { if(sigPad2) sigPad2.resize(); });
