/**
 * habit.js
 * Phân hệ Habit Tracker – Quản lý thói quen cá nhân (Giai đoạn 5):
 * - Thêm, chỉnh sửa, xóa thói quen (xóa kèm HabitLogs nguyên tử)
 * - Đánh dấu hoàn thành mỗi ngày (check-in 1 chạm hôm nay & 7 ngày gần nhất)
 * - Tính toán chuẩn xác Chuỗi ngày liên tiếp hiện tại (Current Streak) & Kỷ lục (Best Streak)
 * - Modal Lịch sử 30 ngày gần nhất (cho phép cập nhật bổ sung)
 * - Thống kê tỷ lệ duy trì từng thói quen & tiến độ tổng hôm nay
 */

import * as db from './database.js';
import {
  addDays,
  escapeHTML,
  formatDateKey,
  parseDateKey
} from './utils.js';
import {
  HABIT_FREQ_LABELS,
  ICONS,
  closeModal,
  openModal,
  showToast
} from './ui.js';

const SUGGESTED_HABITS = [
  'Đọc sách 20 phút',
  'Học tiếng Anh',
  'Tập thể dục',
  'Dậy sớm',
  'Uống đủ 2L nước'
];

/**
 * Tính chuỗi ngày liên tiếp (Current Streak), chuỗi dài nhất (Best Streak)
 * và tỷ lệ duy trì trong 30 ngày gần nhất (hoặc kể từ ngày tạo thói quen).
 * @param {object} habit
 * @param {Set<string>} completedDatesSet
 * @param {Date} [now=new Date()]
 */
export function computeHabitMetrics(habit, completedDatesSet, now = new Date()) {
  const todayKey = formatDateKey(now);
  const yesterdayKey = formatDateKey(addDays(now, -1));

  // 1. Current Streak: bắt đầu từ hôm nay nếu đã làm, hoặc hôm qua nếu hôm nay chưa check-in
  let currentStreak = 0;
  let cursor = completedDatesSet.has(todayKey)
    ? now
    : completedDatesSet.has(yesterdayKey)
      ? addDays(now, -1)
      : null;

  if (cursor) {
    while (completedDatesSet.has(formatDateKey(cursor))) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    }
  }

  // 2. Best Streak: duyệt toàn bộ ngày đã hoàn thành tăng dần
  const sortedDates = Array.from(completedDatesSet).sort();
  let bestStreak = 0;
  let running = 0;
  let prevKey = null;

  for (const key of sortedDates) {
    if (!prevKey) {
      running = 1;
    } else {
      const expectedNext = formatDateKey(addDays(parseDateKey(prevKey), 1));
      running = key === expectedNext ? running + 1 : 1;
    }
    if (running > bestStreak) bestStreak = running;
    prevKey = key;
  }

  // 3. Tỷ lệ duy trì (30 ngày gần nhất hoặc kể từ ngày tạo thói quen)
  const createdKey = habit.createdAt ? formatDateKey(habit.createdAt) : todayKey;
  const createdDate = parseDateKey(createdKey);
  const todayDate = parseDateKey(todayKey);
  const daysSinceCreated = Math.max(1, Math.floor((todayDate - createdDate) / 86400000) + 1);
  const windowDays = Math.min(30, daysSinceCreated);

  let completedInWindow = 0;
  for (let i = 0; i < windowDays; i++) {
    const k = formatDateKey(addDays(now, -i));
    if (completedDatesSet.has(k)) completedInWindow += 1;
  }

  const adherenceRate = Math.round((completedInWindow / windowDays) * 100);

  return {
    currentStreak,
    bestStreak,
    adherenceRate,
    windowDays,
    completedInWindow,
    totalCompleted: completedDatesSet.size,
    completedToday: completedDatesSet.has(todayKey)
  };
}

export const HabitModule = {
  state: {
    editingHabitId: null,
    historyHabitId: null
  },

  init(callbacks) {
    this.callbacks = callbacks;
    this.bindEvents();
  },

  bindEvents() {
    const viewEl = document.getElementById('view-habits');
    if (viewEl) {
      document.getElementById('btn-add-habit')?.addEventListener('click', () => {
        this.openCreateModal();
      });

      viewEl.addEventListener('click', async (e) => {
        // Chip gợi ý thói quen nhanh khi danh sách trống
        const chip = e.target.closest('[data-suggest-habit]');
        if (chip) {
          this.openCreateModal(chip.dataset.suggestHabit);
          return;
        }

        // Check-in hôm nay hoặc 1 ngày trong dải 7 ngày
        const toggleBtn = e.target.closest('[data-action="toggle-habit-day"]');
        if (toggleBtn) {
          await this.toggleHabitLog(toggleBtn.dataset.habitId, toggleBtn.dataset.dateKey);
          return;
        }

        // Mở lịch sử 30 ngày
        const historyBtn = e.target.closest('[data-action="habit-history"]');
        if (historyBtn) {
          await this.openHistoryModal(historyBtn.dataset.habitId);
          return;
        }

        // Mở chỉnh sửa thói quen
        const editBtn = e.target.closest('[data-action="edit-habit"]');
        if (editBtn) {
          await this.openEditModal(editBtn.dataset.habitId);
          return;
        }

        // Xóa thói quen
        const delBtn = e.target.closest('[data-action="delete-habit"]');
        if (delBtn) {
          await this.deleteHabit(delBtn.dataset.habitId);
        }
      });
    }

    // Form Thêm / Sửa thói quen
    document.getElementById('habit-form')?.addEventListener('submit', (e) => {
      this.handleHabitFormSubmit(e);
    });

    document.getElementById('btn-delete-habit-modal')?.addEventListener('click', async () => {
      if (!this.state.editingHabitId) return;
      const deleted = await this.deleteHabit(this.state.editingHabitId);
      if (deleted) closeModal('modal-habit');
    });

    // Tương tác trực tiếp trên lưới lịch sử 30 ngày
    document.getElementById('habit-history-grid')?.addEventListener('click', async (e) => {
      const cell = e.target.closest('[data-history-date]');
      if (!cell || !this.state.historyHabitId) return;
      await this.toggleHabitLog(this.state.historyHabitId, cell.dataset.historyDate, true);
    });
  },

  openCreateModal(prefillName = '') {
    this.state.editingHabitId = null;
    const form = document.getElementById('habit-form');
    form?.reset();

    document.getElementById('modal-habit-title').textContent = 'Thêm thói quen mới';
    document.getElementById('btn-save-habit').textContent = 'Lưu thói quen';
    document.getElementById('btn-delete-habit-modal').hidden = true;
    document.getElementById('habit-name-input').value = prefillName;
    document.getElementById('habit-freq-select').value = 'daily';
    document.getElementById('habit-active-check').checked = true;

    openModal('modal-habit');
    setTimeout(() => document.getElementById('habit-name-input')?.focus(), 180);
  },

  async openEditModal(habitId) {
    const habit = await db.getRecord(db.STORES.HABITS, habitId);
    if (!habit) return;

    this.state.editingHabitId = habit.id;
    document.getElementById('modal-habit-title').textContent = 'Chỉnh sửa thói quen';
    document.getElementById('btn-save-habit').textContent = 'Cập nhật thói quen';
    document.getElementById('btn-delete-habit-modal').hidden = false;

    document.getElementById('habit-name-input').value = habit.name || '';
    document.getElementById('habit-desc-input').value = habit.description || '';
    document.getElementById('habit-freq-select').value = habit.frequency || 'daily';
    document.getElementById('habit-active-check').checked = habit.isActive !== false;

    openModal('modal-habit');
  },

  async handleHabitFormSubmit(event) {
    event.preventDefault();

    const name = document.getElementById('habit-name-input')?.value || '';
    const description = document.getElementById('habit-desc-input')?.value || '';
    const frequency = document.getElementById('habit-freq-select')?.value || 'daily';
    const isActive = Boolean(document.getElementById('habit-active-check')?.checked);

    try {
      if (this.state.editingHabitId) {
        const existing = await db.getRecord(db.STORES.HABITS, this.state.editingHabitId);
        if (!existing) throw new Error('Thói quen không còn tồn tại.');

        const updated = db.buildHabitRecord({
          ...existing,
          name,
          description,
          frequency,
          isActive
        });
        await db.putRecord(db.STORES.HABITS, updated);
        showToast('Đã cập nhật thói quen.', 'success');
      } else {
        const record = db.buildHabitRecord({ name, description, frequency, isActive });
        await db.addRecord(db.STORES.HABITS, record);
        showToast('Đã thêm thói quen mới!', 'success');
      }

      closeModal('modal-habit');
      await this.callbacks.onDataChanged?.();
    } catch (error) {
      showToast(error.message, 'error');
    }
  },

  async deleteHabit(habitId) {
    const habit = await db.getRecord(db.STORES.HABITS, habitId);
    if (!habit) return false;

    const confirmed = window.confirm(
      `Bạn có chắc muốn xóa thói quen "${habit.name}" và toàn bộ lịch sử thực hiện?`
    );
    if (!confirmed) return false;

    await db.deleteHabitWithLogs(habitId);
    showToast('Đã xóa thói quen.', 'default');
    await this.callbacks.onDataChanged?.();
    return true;
  },

  /**
   * Bật/tắt hoàn thành thói quen cho một ngày cụ thể bằng compound index [habitId, date].
   */
  async toggleHabitLog(habitId, dateKey, refreshHistoryModal = false) {
    if (!habitId || !dateKey) return;
    try {
      const existing = await db.getOneByIndex(db.STORES.HABIT_LOGS, 'habitId_date', [habitId, dateKey]);

      if (existing) {
        const updated = db.buildHabitLogRecord({
          ...existing,
          completed: !existing.completed
        });
        await db.putRecord(db.STORES.HABIT_LOGS, updated);
      } else {
        const created = db.buildHabitLogRecord({
          habitId,
          date: dateKey,
          completed: true
        });
        await db.addRecord(db.STORES.HABIT_LOGS, created);
      }

      await this.render();
      if (refreshHistoryModal && this.state.historyHabitId === habitId) {
        await this.renderHistoryModalContent(habitId);
      }
    } catch (error) {
      showToast(`Lỗi lưu thói quen: ${error.message}`, 'error');
    }
  },

  async openHistoryModal(habitId) {
    this.state.historyHabitId = habitId;
    await this.renderHistoryModalContent(habitId);
    openModal('modal-habit-history');
  },

  async renderHistoryModalContent(habitId) {
    const habit = await db.getRecord(db.STORES.HABITS, habitId);
    if (!habit) return;

    const logs = await db.getByIndex(db.STORES.HABIT_LOGS, 'habitId', habitId);
    const completedSet = new Set(logs.filter((l) => l.completed).map((l) => l.date));
    const now = new Date();
    const metrics = computeHabitMetrics(habit, completedSet, now);

    document.getElementById('habit-history-title').textContent = habit.name;
    document.getElementById('habit-hist-streak').textContent = `${metrics.currentStreak} ngày`;
    document.getElementById('habit-hist-best').textContent = `${metrics.bestStreak} ngày`;
    document.getElementById('habit-hist-rate').textContent = `${metrics.adherenceRate}%`;
    document.getElementById('habit-hist-total').textContent = `${metrics.totalCompleted} lần`;

    const gridEl = document.getElementById('habit-history-grid');
    if (!gridEl) return;

    const cells = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(now, -i);
      const key = formatDateKey(d);
      const done = completedSet.has(key);
      const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      cells.push(`
        <button
          type="button"
          class="history-day ${done ? 'history-day--done' : ''}"
          data-history-date="${key}"
          title="${label} – ${done ? 'Đã hoàn thành' : 'Chưa thực hiện'}"
          aria-pressed="${done ? 'true' : 'false'}"
        >
          <span>${d.getDate()}</span>
          <small>T${d.getMonth() + 1}</small>
        </button>
      `);
    }
    gridEl.innerHTML = cells.join('');
  },

  async render() {
    const listEl = document.getElementById('habits-list-container');
    const summaryEl = document.getElementById('habits-today-summary');
    const barEl = document.getElementById('habits-today-bar');
    if (!listEl) return;

    const now = new Date();
    const todayKey = formatDateKey(now);

    const [habits, allLogs] = await Promise.all([
      db.getAllRecords(db.STORES.HABITS),
      db.getAllRecords(db.STORES.HABIT_LOGS)
    ]);

    // Gom log theo habitId
    const logsByHabit = new Map();
    for (const log of allLogs) {
      if (!log.completed) continue;
      if (!logsByHabit.has(log.habitId)) logsByHabit.set(log.habitId, new Set());
      logsByHabit.get(log.habitId).add(log.date);
    }

    const activeHabits = habits.filter((h) => h.isActive !== false);
    const doneTodayCount = activeHabits.filter((h) => logsByHabit.get(h.id)?.has(todayKey)).length;
    const todayPercent = activeHabits.length > 0 ? Math.round((doneTodayCount / activeHabits.length) * 100) : 0;

    if (summaryEl) {
      summaryEl.textContent = activeHabits.length > 0
        ? `Hôm nay: ${doneTodayCount}/${activeHabits.length} thói quen (${todayPercent}%)`
        : 'Chưa có thói quen nào đang theo dõi';
    }
    if (barEl) {
      barEl.style.width = `${todayPercent}%`;
    }

    if (!habits.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p style="margin-bottom:12px;">Bắt đầu xây dựng kỷ luật cá nhân bằng cách thêm thói quen đầu tiên của bạn:</p>
          <div class="suggestion-chips">
            ${SUGGESTED_HABITS.map(
              (s) => `<button type="button" class="filter-pill" data-suggest-habit="${escapeHTML(s)}">+ ${escapeHTML(s)}</button>`
            ).join('')}
          </div>
        </div>
      `;
      return;
    }

    // 7 ngày gần nhất để check-in nhanh trên thẻ
    const last7Days = [];
    const shortDays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(now, -i);
      last7Days.push({
        key: formatDateKey(d),
        label: shortDays[d.getDay()],
        dayNum: d.getDate()
      });
    }

    const sortedHabits = [...habits].sort((a, b) => {
      const aActive = a.isActive !== false ? 0 : 1;
      const bActive = b.isActive !== false ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    listEl.innerHTML = sortedHabits
      .map((habit) => {
        const completedSet = logsByHabit.get(habit.id) || new Set();
        const metrics = computeHabitMetrics(habit, completedSet, now);
        const isPaused = habit.isActive === false;

        return `
          <article class="card habit-card ${isPaused ? 'habit-card--paused' : ''}">
            <div class="habit-card__top">
              <button
                type="button"
                class="habit-check-btn ${metrics.completedToday ? 'habit-check-btn--done' : ''}"
                data-action="toggle-habit-day"
                data-habit-id="${escapeHTML(habit.id)}"
                data-date-key="${todayKey}"
                aria-label="Đánh dấu hoàn thành hôm nay: ${escapeHTML(habit.name)}"
                aria-pressed="${metrics.completedToday ? 'true' : 'false'}"
              >
                ${metrics.completedToday ? ICONS.check : ''}
              </button>

              <div class="habit-card__info">
                <div class="habit-card__title-row">
                  <h3>${escapeHTML(habit.name)}</h3>
                  ${isPaused ? `<span class="status-badge status-badge--todo">Tạm dừng</span>` : ''}
                </div>
                ${habit.description ? `<p class="habit-card__desc">${escapeHTML(habit.description)}</p>` : ''}
                <div class="habit-card__stats">
                  <span class="streak-pill ${metrics.currentStreak > 0 ? 'streak-pill--hot' : ''}">
                    ${ICONS.flame}
                    <span>Chuỗi ${metrics.currentStreak} ngày</span>
                  </span>
                  <span class="section-head__meta">Duy trì ${metrics.adherenceRate}%</span>
                  <span class="section-head__meta">${escapeHTML(HABIT_FREQ_LABELS[habit.frequency] || 'Mỗi ngày')}</span>
                </div>
              </div>

              <div class="task-row__actions">
                <button type="button" class="icon-btn" data-action="habit-history" data-habit-id="${escapeHTML(habit.id)}" title="Lịch sử 30 ngày" aria-label="Xem lịch sử">
                  ${ICONS.history}
                </button>
                <button type="button" class="icon-btn" data-action="edit-habit" data-habit-id="${escapeHTML(habit.id)}" title="Chỉnh sửa" aria-label="Chỉnh sửa">
                  ${ICONS.edit}
                </button>
                <button type="button" class="icon-btn icon-btn--danger" data-action="delete-habit" data-habit-id="${escapeHTML(habit.id)}" title="Xóa" aria-label="Xóa">
                  ${ICONS.trash}
                </button>
              </div>
            </div>

            <div class="habit-week-strip" aria-label="7 ngày gần nhất">
              ${last7Days
                .map((d) => {
                  const done = completedSet.has(d.key);
                  const isToday = d.key === todayKey;
                  return `
                    <button
                      type="button"
                      class="habit-day-dot ${done ? 'habit-day-dot--done' : ''} ${isToday ? 'habit-day-dot--today' : ''}"
                      data-action="toggle-habit-day"
                      data-habit-id="${escapeHTML(habit.id)}"
                      data-date-key="${d.key}"
                      title="${d.label} (${d.key})"
                      aria-pressed="${done ? 'true' : 'false'}"
                    >
                      <span>${d.label}</span>
                      <strong>${d.dayNum}</strong>
                    </button>
                  `;
                })
                .join('')}
            </div>
          </article>
        `;
      })
      .join('');
  }
};
