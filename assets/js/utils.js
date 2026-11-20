/**
 * utils.js
 * Các hàm tiện ích dùng chung cho toàn bộ ứng dụng MyDay:
 * - Tạo UUID v4 an toàn
 * - Xử lý ngày giờ theo múi giờ địa phương (UTC+7 Việt Nam)
 * - Tiện ích tính toán lịch (Tuần, Tháng, Cộng/Trừ ngày, Lặp lại)
 * - Kiểm tra trạng thái hiệu lực & chống XSS
 */

export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join('')
    ].join('-');
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * Định dạng Date thành khóa YYYY-MM-DD theo múi giờ địa phương.
 * @param {Date|string} [date=new Date()]
 * @returns {string}
 */
export function formatDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Chuyển chuỗi YYYY-MM-DD thành đối tượng Date lúc 00:00:00 giờ địa phương.
 * @param {string} dateKey
 * @returns {Date}
 */
export function parseDateKey(dateKey) {
  if (!isValidDateKey(dateKey)) return new Date();
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Cộng hoặc trừ số ngày trên đối tượng Date (trả về Date mới, không sửa bản gốc).
 * @param {Date|string} date
 * @param {number} days
 * @returns {Date}
 */
export function addDays(date, days) {
  const base = typeof date === 'string' && isValidDateKey(date) ? parseDateKey(date) : new Date(date);
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Lấy ngày Thứ Hai đầu tuần của một ngày bất kỳ.
 * @param {Date|string} date
 * @returns {Date}
 */
export function getStartOfWeek(date) {
  const d = typeof date === 'string' && isValidDateKey(date) ? parseDateKey(date) : new Date(date);
  const day = d.getDay(); // 0 (CN) -> 6 (T7)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(d, diffToMonday);
}

/**
 * Kết hợp input date (YYYY-MM-DD) và time (HH:mm) thành chuỗi ISO.
 * @param {string} dateStr
 * @param {string} [timeStr='']
 * @param {'start'|'end'} [kind='end']
 * @returns {string|null}
 */
export function combineDateAndTimeToISO(dateStr, timeStr = '', kind = 'end') {
  if (!isValidDateKey(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);

  if (typeof timeStr === 'string' && /^\d{2}:\d{2}$/.test(timeStr)) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
  }

  if (kind === 'start') {
    return new Date(year, month - 1, day, 0, 0, 1, 0).toISOString();
  }
  return new Date(year, month - 1, day, 23, 59, 59, 0).toISOString();
}

export function splitISOToDateAndTime(isoString) {
  if (!isoString) return { date: '', time: '' };
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };

  const date = formatDateKey(d);
  const sec = d.getSeconds();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');

  const isImplicitEnd = hh === '23' && mm === '59' && (sec === 59 || sec === 0);
  const isImplicitStart = hh === '00' && mm === '00' && sec === 1;

  if (isImplicitEnd || isImplicitStart) {
    return { date, time: '' };
  }
  return { date, time: `${hh}:${mm}` };
}

export function shiftISOByRepeatRule(isoString, repeatRule) {
  if (!isoString || !repeatRule || repeatRule === 'none') return isoString;
  const base = new Date(isoString);
  if (Number.isNaN(base.getTime())) return null;

  const next = new Date(base.getTime());

  if (repeatRule === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (repeatRule === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (repeatRule === 'monthly') {
    const originalDay = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const maxDayInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(originalDay, maxDayInMonth));
  }

  return next.toISOString();
}

export function getVietnameseGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'Chào buổi sáng';
  if (hour >= 11 && hour < 14) return 'Chào buổi trưa';
  if (hour >= 14 && hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export function formatVietnameseFullDate(date = new Date()) {
  const d = typeof date === 'string' && isValidDateKey(date) ? parseDateKey(date) : new Date(date);
  const weekdays = [
    'Chủ Nhật',
    'Thứ Hai',
    'Thứ Ba',
    'Thứ Tư',
    'Thứ Năm',
    'Thứ Sáu',
    'Thứ Bảy'
  ];
  return `${weekdays[d.getDay()]}, ${d.getDate()} tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}

export function formatMonthYearVN(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
}

export function formatDateTimeVN(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mo}/${yyyy} · ${hh}:${mm}`;
}

export function formatShortDueDate(isoString) {
  if (!isoString) return 'Chưa đặt hạn';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return 'Chưa đặt hạn';

  const today = new Date();
  const todayKey = formatDateKey(today);
  const tomorrowKey = formatDateKey(addDays(today, 1));
  const yesterdayKey = formatDateKey(addDays(today, -1));

  const targetKey = formatDateKey(d);
  const { time } = splitISOToDateAndTime(isoString);
  const timePart = time ? `, ${time}` : '';

  if (targetKey === todayKey) return `Hôm nay${timePart}`;
  if (targetKey === tomorrowKey) return `Ngày mai${timePart}`;
  if (targetKey === yesterdayKey) return `Hôm qua${timePart}`;

  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mo}${timePart}`;
}

export function formatTaskSchedule(startDate, dueDate) {
  if (!startDate && !dueDate) return 'Chưa đặt lịch';
  if (startDate && !dueDate) return `Bắt đầu: ${formatShortDueDate(startDate)}`;
  if (!startDate && dueDate) return formatShortDueDate(dueDate);

  const startKey = formatDateKey(startDate);
  const dueKey = formatDateKey(dueDate);
  const s = splitISOToDateAndTime(startDate);
  const e = splitISOToDateAndTime(dueDate);

  if (startKey === dueKey && s.time && e.time) {
    const dayLabel = formatShortDueDate(startDate).split(',')[0];
    return `${dayLabel}, ${s.time} – ${e.time}`;
  }
  return `${formatShortDueDate(startDate)} → ${formatShortDueDate(dueDate)}`;
}

export function isTaskOverdue(task, now = new Date()) {
  if (!task || task.status === 'completed' || !task.dueDate) return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

export function getEffectiveTaskStatus(task, now = new Date()) {
  if (!task) return 'todo';
  if (task.status === 'completed') return 'completed';
  if (isTaskOverdue(task, now)) return 'overdue';
  if (task.status === 'in_progress') return 'in_progress';
  return 'todo';
}

/**
 * Kiểm tra một công việc có nằm trên một ngày cụ thể (YYYY-MM-DD) hay không.
 * @param {object} task
 * @param {string} dateKey
 * @returns {boolean}
 */
export function isTaskOnDateKey(task, dateKey) {
  if (!task || !dateKey) return false;
  const dueKey = task.dueDate ? formatDateKey(task.dueDate) : '';
  const startKey = task.startDate ? formatDateKey(task.startDate) : '';

  if (dueKey === dateKey) return true;
  if (startKey === dateKey) return true;
  if (startKey && dueKey && startKey <= dateKey && dateKey <= dueKey) return true;
  return false;
}

export function isTaskForToday(task, todayKey = formatDateKey(new Date())) {
  if (!task) return false;
  if (isTaskOnDateKey(task, todayKey)) return true;
  if (!task.dueDate && !task.startDate && task.createdAt && formatDateKey(task.createdAt) === todayKey) {
    return true;
  }
  return false;
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidDateKey(dateStr) {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function escapeHTML(text = '') {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}
