/**
 * calendar.js
 * Phân hệ Lịch (Giai đoạn 5):
 * - Chế độ xem: Ngày / Tuần / Tháng
 * - Chuyển nhanh giữa các ngày (Trước / Hôm nay / Sau / Chọn ngày trực tiếp)
 * - Đánh dấu trực quan ngày có công việc (phân biệt trạng thái)
 * - Xem chi tiết, chỉnh sửa và tích hoàn thành công việc trực tiếp trên lịch
 * - Thêm nhanh công việc gắn sẵn ngày đang chọn
 */

import * as db from './database.js';
import {
  addDays,
  escapeHTML,
  formatDateKey,
  formatMonthYearVN,
  formatTaskSchedule,
  formatVietnameseFullDate,
  getEffectiveTaskStatus,
  getStartOfWeek,
  isTaskOnDateKey,
  isTaskOverdue,
  parseDateKey
} from './utils.js';
import { ICONS, PRIORITY_LABELS, REPEAT_LABELS, STATUS_LABELS } from './ui.js';

const WEEKDAY_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export const CalendarModule = {
  state: {
    mode: 'month', // 'day' | 'week' | 'month'
    selectedDateKey: formatDateKey(new Date()),
    anchorDate: new Date()
  },

  init(callbacks) {
    this.callbacks = callbacks;
    const viewEl = document.getElementById('view-calendar');
    if (!viewEl) return;

    // Chuyển chế độ Ngày / Tuần / Tháng
    document.getElementById('calendar-mode-switch')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cal-mode]');
      if (!btn) return;
      this.state.mode = btn.dataset.calMode;
      this.state.anchorDate = parseDateKey(this.state.selectedDateKey);
      this.render();
    });

    // Điều hướng Trước / Hôm nay / Sau
    document.getElementById('btn-cal-prev')?.addEventListener('click', () => this.navigate(-1));
    document.getElementById('btn-cal-next')?.addEventListener('click', () => this.navigate(1));
    document.getElementById('btn-cal-today')?.addEventListener('click', () => {
      const today = new Date();
      this.state.selectedDateKey = formatDateKey(today);
      this.state.anchorDate = today;
      this.render();
    });

    // Nhảy nhanh tới ngày bất kỳ
    document.getElementById('cal-jump-date')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;
      this.state.selectedDateKey = val;
      this.state.anchorDate = parseDateKey(val);
      this.render();
    });

    // Thêm công việc gắn sẵn ngày đang chọn trên Lịch
    document.getElementById('btn-cal-add-task')?.addEventListener('click', () => {
      this.callbacks.onOpenCreateTask?.({ dueDateKey: this.state.selectedDateKey });
    });

    // Event delegation: chọn ô ngày trên lưới & thao tác trên công việc
    viewEl.addEventListener('click', async (e) => {
      const dayCell = e.target.closest('[data-cal-date]');
      if (dayCell) {
        this.state.selectedDateKey = dayCell.dataset.calDate;
        this.state.anchorDate = parseDateKey(this.state.selectedDateKey);
        await this.render();
        return;
      }

      const toggleBtn = e.target.closest('[data-action="toggle-task"]');
      if (toggleBtn) {
        await this.callbacks.onToggleTask?.(toggleBtn.dataset.taskId);
        return;
      }

      const editTrigger = e.target.closest('[data-action="edit-task"]');
      if (editTrigger) {
        await this.callbacks.onEditTask?.(editTrigger.dataset.taskId);
      }
    });
  },

  navigate(step) {
    const anchor = this.state.anchorDate;
    if (this.state.mode === 'day') {
      const next = addDays(anchor, step);
      this.state.anchorDate = next;
      this.state.selectedDateKey = formatDateKey(next);
    } else if (this.state.mode === 'week') {
      const next = addDays(anchor, step * 7);
      this.state.anchorDate = next;
      this.state.selectedDateKey = formatDateKey(next);
    } else {
      // Chế độ Tháng: chuyển sang mùng 1 của tháng trước/sau
      const nextMonth = new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
      this.state.anchorDate = nextMonth;
      this.state.selectedDateKey = formatDateKey(nextMonth);
    }
    this.render();
  },

  /**
   * Tạo bản đồ ngày -> danh sách công việc cho một tập các khóa ngày cần hiển thị.
   * @param {object[]} allTasks
   * @param {string[]} dateKeys
   * @returns {Map<string, object[]>}
   */
  buildDayTaskMap(allTasks, dateKeys) {
    const map = new Map();
    for (const key of dateKeys) {
      map.set(key, []);
    }

    for (const task of allTasks) {
      if (!task.dueDate && !task.startDate) continue;
      for (const key of dateKeys) {
        if (isTaskOnDateKey(task, key)) {
          map.get(key).push(task);
        }
      }
    }
    return map;
  },

  renderModeButtons() {
    document.querySelectorAll('#calendar-mode-switch [data-cal-mode]').forEach((btn) => {
      const active = btn.dataset.calMode === this.state.mode;
      btn.classList.toggle('seg-btn--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  },

  renderPeriodTitle() {
    const titleEl = document.getElementById('cal-period-title');
    const jumpEl = document.getElementById('cal-jump-date');
    if (jumpEl) jumpEl.value = this.state.selectedDateKey;
    if (!titleEl) return;

    const anchor = this.state.anchorDate;
    if (this.state.mode === 'day') {
      titleEl.textContent = formatVietnameseFullDate(this.state.selectedDateKey);
    } else if (this.state.mode === 'week') {
      const start = getStartOfWeek(anchor);
      const end = addDays(start, 6);
      const sLabel = `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`;
      const eLabel = `${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}/${end.getFullYear()}`;
      titleEl.textContent = `Tuần ${sLabel} – ${eLabel}`;
    } else {
      titleEl.textContent = formatMonthYearVN(anchor);
    }
  },

  renderCalendarSurface(allTasks, now) {
    const surfaceEl = document.getElementById('calendar-grid-surface');
    if (!surfaceEl) return;

    const todayKey = formatDateKey(now);

    if (this.state.mode === 'day') {
      // Dải 7 ngày nhỏ xung quanh ngày đang chọn giúp chạm chuyển ngày nhanh bằng 1 tay
      const center = parseDateKey(this.state.selectedDateKey);
      const stripDays = [];
      for (let i = -3; i <= 3; i++) {
        stripDays.push(addDays(center, i));
      }
      const keys = stripDays.map((d) => formatDateKey(d));
      const dayMap = this.buildDayTaskMap(allTasks, keys);

      surfaceEl.innerHTML = `
        <div class="cal-week-grid">
          ${stripDays
            .map((d) => {
              const key = formatDateKey(d);
              const items = dayMap.get(key) || [];
              const weekdayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
              return this.renderWeekCellHTML(d, key, WEEKDAY_SHORT[weekdayIdx], items, todayKey, now);
            })
            .join('')}
        </div>
      `;
      return;
    }

    if (this.state.mode === 'week') {
      const start = getStartOfWeek(this.state.anchorDate);
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        weekDays.push(addDays(start, i));
      }
      const keys = weekDays.map((d) => formatDateKey(d));
      const dayMap = this.buildDayTaskMap(allTasks, keys);

      surfaceEl.innerHTML = `
        <div class="cal-week-grid">
          ${weekDays
            .map((d, idx) => {
              const key = formatDateKey(d);
              const items = dayMap.get(key) || [];
              return this.renderWeekCellHTML(d, key, WEEKDAY_SHORT[idx], items, todayKey, now);
            })
            .join('')}
        </div>
      `;
      return;
    }

    // Chế độ Tháng (42 ô chuẩn 6 hàng x 7 cột, bắt đầu từ Thứ Hai)
    const year = this.state.anchorDate.getFullYear();
    const month = this.state.anchorDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const gridStart = getStartOfWeek(firstOfMonth);

    const monthDays = [];
    for (let i = 0; i < 42; i++) {
      monthDays.push(addDays(gridStart, i));
    }

    // Nếu hàng thứ 6 hoàn toàn thuộc tháng sau thì chỉ cần hiển thị 35 ô cho gọn
    const totalCells = monthDays[35].getMonth() !== month ? 35 : 42;
    const visibleDays = monthDays.slice(0, totalCells);
    const keys = visibleDays.map((d) => formatDateKey(d));
    const dayMap = this.buildDayTaskMap(allTasks, keys);

    surfaceEl.innerHTML = `
      <div class="cal-weekdays">
        ${WEEKDAY_SHORT.map((w) => `<span>${w}</span>`).join('')}
      </div>
      <div class="cal-month-grid">
        ${visibleDays
          .map((d) => {
            const key = formatDateKey(d);
            const items = dayMap.get(key) || [];
            const isCurrentMonth = d.getMonth() === month;
            const isToday = key === todayKey;
            const isSelected = key === this.state.selectedDateKey;
            const dotsHTML = this.renderStatusDots(items, now);

            return `
              <button
                type="button"
                class="cal-cell ${!isCurrentMonth ? 'cal-cell--muted' : ''} ${isToday ? 'cal-cell--today' : ''} ${isSelected ? 'cal-cell--selected' : ''}"
                data-cal-date="${key}"
                aria-label="${escapeHTML(formatVietnameseFullDate(key))} (${items.length} công việc)"
                aria-pressed="${isSelected ? 'true' : 'false'}"
              >
                <span class="cal-cell__num">${d.getDate()}</span>
                <span class="cal-cell__dots">${dotsHTML}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    `;
  },

  renderWeekCellHTML(dateObj, key, weekdayLabel, items, todayKey, now) {
    const isToday = key === todayKey;
    const isSelected = key === this.state.selectedDateKey;
    const dotsHTML = this.renderStatusDots(items, now);

    return `
      <button
        type="button"
        class="cal-week-cell ${isToday ? 'cal-week-cell--today' : ''} ${isSelected ? 'cal-week-cell--selected' : ''}"
        data-cal-date="${key}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
      >
        <span class="cal-week-cell__day">${weekdayLabel}</span>
        <span class="cal-week-cell__num">${dateObj.getDate()}</span>
        <span class="cal-cell__dots">${dotsHTML}</span>
      </button>
    `;
  },

  renderStatusDots(items, now) {
    if (!items.length) return '';
    // Hiển thị tối đa 3 chấm biểu thị màu trạng thái công việc trong ngày
    const statuses = items.slice(0, 3).map((task) => getEffectiveTaskStatus(task, now));
    return statuses
      .map((st) => `<i class="cal-dot cal-dot--${st}"></i>`)
      .join('');
  },

  renderSelectedDayTasks(allTasks, categoryMap, now) {
    const headingEl = document.getElementById('cal-selected-heading');
    const countEl = document.getElementById('cal-selected-count');
    const listEl = document.getElementById('cal-day-tasks');
    if (!listEl) return;

    const dateKey = this.state.selectedDateKey;
    if (headingEl) headingEl.textContent = formatVietnameseFullDate(dateKey);

    const dayTasks = allTasks
      .filter((t) => isTaskOnDateKey(t, dateKey))
      .sort((a, b) => {
        const aDone = a.status === db.TASK_STATUSES.COMPLETED ? 1 : 0;
        const bDone = b.status === db.TASK_STATUSES.COMPLETED ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return (a.startDate || a.dueDate || '').localeCompare(b.startDate || b.dueDate || '');
      });

    if (countEl) countEl.textContent = `${dayTasks.length} công việc`;

    if (!dayTasks.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>Không có công việc nào trong ngày này. Nhấn <strong>+ Thêm cho ngày này</strong> để lên lịch.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = dayTasks
      .map((task) => {
        const effectiveStatus = getEffectiveTaskStatus(task, now);
        const isDone = effectiveStatus === db.TASK_STATUSES.COMPLETED;
        const overdue = isTaskOverdue(task, now);
        const category = task.categoryId ? categoryMap.get(task.categoryId) : null;
        const scheduleLabel = formatTaskSchedule(task.startDate, task.dueDate);
        const hasRepeat = task.repeatRule && task.repeatRule !== db.REPEAT_RULES.NONE;

        return `
          <article class="task-row ${isDone ? 'task-row--done' : ''}">
            <button
              type="button"
              class="task-check ${isDone ? 'task-check--checked' : ''}"
              data-action="toggle-task"
              data-task-id="${escapeHTML(task.id)}"
              aria-label="${isDone ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'}"
            >
              ${isDone ? ICONS.check : ''}
            </button>

            <div class="task-row__content task-row__clickable" data-action="edit-task" data-task-id="${escapeHTML(task.id)}">
              <div class="task-row__top">
                <h3 class="task-row__title">${escapeHTML(task.title)}</h3>
                <span class="priority-pill priority-pill--${escapeHTML(task.priority)}">
                  ${escapeHTML(PRIORITY_LABELS[task.priority] || 'Trung bình')}
                </span>
              </div>

              ${task.description ? `<p class="task-row__desc">${escapeHTML(task.description)}</p>` : ''}

              <div class="task-row__meta">
                <span class="status-badge status-badge--${escapeHTML(effectiveStatus)}">
                  ${escapeHTML(STATUS_LABELS[effectiveStatus])}
                </span>
                <span class="meta-item ${overdue ? 'meta-item--danger' : ''}">
                  ${ICONS.clock}
                  <span>${escapeHTML(scheduleLabel)}</span>
                </span>
                ${
                  hasRepeat
                    ? `<span class="meta-item">${ICONS.repeat}<span>${escapeHTML(REPEAT_LABELS[task.repeatRule])}</span></span>`
                    : ''
                }
                ${
                  category
                    ? `<span class="category-tag">
                         <span class="category-tag__dot" style="background-color: ${escapeHTML(category.color)}"></span>
                         ${escapeHTML(category.name)}
                       </span>`
                    : ''
                }
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  },

  async render() {
    const now = new Date();
    const [allTasks, categories] = await Promise.all([
      db.getAllRecords(db.STORES.TASKS),
      db.getAllRecords(db.STORES.CATEGORIES)
    ]);

    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    this.renderModeButtons();
    this.renderPeriodTitle();
    this.renderCalendarSurface(allTasks, now);
    this.renderSelectedDayTasks(allTasks, categoryMap, now);
  }
};
