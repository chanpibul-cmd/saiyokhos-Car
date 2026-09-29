/**
 * โมดูลปฏิทินคิวรถ (Interactive Calendar Module)
 * ใช้งานร่วมกับ FullCalendar 6 รองรับมุมมองหลากหลายและฟิลเตอร์สถานะ
 */

let calendarInstance = null;
let currentCalendarFilter = 'all';
let currentCalendarSearch = '';

function parseCalendarDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  let s = String(val).trim();

  // ดักจับกรณีรูปแบบ dd/mm/yyyy หรือ dd/mm/yyyy hh:mm:ss
  const thaiMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
  if (thaiMatch) {
    const d = thaiMatch[1].padStart(2, '0');
    const m = thaiMatch[2].padStart(2, '0');
    let y = parseInt(thaiMatch[3], 10);
    if (y > 2500) y -= 543;
    const time = thaiMatch[4] ? thaiMatch[4].trim() : '00:00:00';
    return `${y}-${m}-${d}T${time}`;
  }

  // ดักจับกรณี yyyy-mm-dd ที่ปีเป็น พ.ศ.
  const yMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (yMatch) {
    let y = parseInt(yMatch[1], 10);
    if (y > 2500) y -= 543;
    return `${y}-${yMatch[2]}-${yMatch[3]}${yMatch[4] || ''}`;
  }

  return s;
}

function getCalendarEvents() {
  if (!globalData || !Array.isArray(globalData)) return [];

  let pendingCount = 0;
  let assignedCount = 0;
  let completedCount = 0;
  let totalCount = 0;

  const events = [];

  globalData.forEach(row => {
    if (!row || !row[0]) return;

    const id = String(row[0]);
    const start = parseCalendarDate(row[4]);
    const end = parseCalendarDate(row[5]);
    const req = row[2] || '';
    const subj = row[6] || '';
    const place = row[7] || 'ไม่ระบุสถานที่';
    const driver = String(row[12] || '');
    const plate = row[13] ? String(row[13]) : '';
    const diffKm = row[19];

    // คำนวณสถานะและสี
    let statusKey = 'pending';
    let color = '#dc3545'; // แดง: รอจัดรถ
    let textColor = '#ffffff';

    if (driver && driver.includes('ยกเลิก')) {
      statusKey = 'cancelled';
      color = '#6c757d'; // เทา: ยกเลิก
    } else if (diffKm !== '' && diffKm !== null && diffKm !== undefined) {
      statusKey = 'completed';
      color = '#198754'; // เขียว: เสร็จสิ้น
      completedCount++;
    } else if (driver && driver.trim() !== '') {
      statusKey = 'assigned';
      color = '#ffc107'; // เหลือง/ส้ม: รอขับรถ
      textColor = '#000000';
      assignedCount++;
    } else {
      pendingCount++;
    }
    totalCount++;

    // ตรวจสอบฟิลเตอร์สถานะ
    if (currentCalendarFilter !== 'all' && statusKey !== currentCalendarFilter) {
      return;
    }

    // ตรวจสอบฟิลเตอร์คำค้นหา
    if (currentCalendarSearch) {
      const q = currentCalendarSearch.toLowerCase();
      const matchAll = `${id} ${place} ${plate} ${req} ${subj} ${driver}`.toLowerCase();
      if (!matchAll.includes(q)) return;
    }

    const displayPlate = plate ? `(${plate})` : '(ยังไม่จัดรถ)';
    const title = `${place} ${displayPlate}`;

    events.push({
      id: id,
      title: title,
      start: start,
      end: end,
      backgroundColor: color,
      borderColor: color,
      textColor: textColor,
      extendedProps: {
        statusKey: statusKey,
        requester: req,
        subject: subj,
        place: place,
        driver: driver,
        plate: plate
      }
    });
  });

  // อัปเดตตัวเลขสรุปบนปุ่มฟิลเตอร์
  const elPending = document.getElementById('calBadgePending');
  const elAssigned = document.getElementById('calBadgeAssigned');
  const elCompleted = document.getElementById('calBadgeCompleted');
  const elAll = document.getElementById('calBadgeAll');

  if (elPending) elPending.textContent = pendingCount;
  if (elAssigned) elAssigned.textContent = assignedCount;
  if (elCompleted) elCompleted.textContent = completedCount;
  if (elAll) elAll.textContent = totalCount;

  return events;
}

function renderCalendar() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;

  if (calendarInstance) {
    calendarInstance.destroy();
    calendarInstance = null;
  }

  const isMobile = window.innerWidth < 768;
  const events = getCalendarEvents();

  calendarInstance = new FullCalendar.Calendar(calendarEl, {
    initialView: isMobile ? 'listWeek' : 'dayGridMonth',
    locale: 'th',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: isMobile ? 'listWeek,dayGridMonth' : 'dayGridMonth,timeGridWeek,timeGridDay,listMonth'
    },
    buttonText: {
      today: 'วันนี้',
      month: 'เดือน',
      week: 'สัปดาห์',
      day: 'วัน',
      listMonth: 'รายการเดือน',
      listWeek: 'รายการสัปดาห์'
    },
    navLinks: true,
    dayMaxEvents: 4,
    events: events,
    eventClick: function(info) {
      if (typeof openView === 'function') {
        openView(info.event.id, true);
      }
    },
    windowResize: function(view) {
      if (window.innerWidth < 768 && calendarInstance && calendarInstance.view.type === 'dayGridMonth') {
        calendarInstance.changeView('listWeek');
      }
    }
  });

  calendarInstance.render();
}

function setCalendarFilter(statusKey) {
  currentCalendarFilter = statusKey;
  renderCalendar();
}

function setCalendarSearch(query) {
  currentCalendarSearch = (query || '').trim();
  renderCalendar();
}

window.renderCalendar = renderCalendar;
window.setCalendarFilter = setCalendarFilter;
window.setCalendarSearch = setCalendarSearch;
window.carCalendar = {
  setFilter: setCalendarFilter,
  setSearch: setCalendarSearch,
  render: renderCalendar,
  updateEvents: renderCalendar
};
