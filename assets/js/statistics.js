/**
 * statistics.js
 * Phân hệ Statistics – Thống kê hoạt động cá nhân (Giai đoạn 6):
 * - Tổng số công việc, đã hoàn thành, tỷ lệ hoàn thành
 * - Chuyển đổi khung thống kê theo Ngày / Tuần / Tháng
 * - Biểu đồ hoạt động vẽ bằng SVG thuần (không CDN, chạy 100% Offline sắc nét)
 * - Phân bổ trạng thái công việc (Hoàn thành / Đang làm / Chưa làm / Quá hạn)
 * - Thống kê thói quen (chuỗi cao nhất, tỷ lệ duy trì, tiến độ từng thói quen)
 * - Lịch sử công việc đã hoàn thành gần đây
 */

import * as db from './database.js';
import {
  addDays,
  escapeHTML,
  formatDateKey,
  formatDateTimeVN,
  getEffectiveTaskStatus,
  isTaskForToday
} from './utils.js';
import { computeHabitMetrics } from './habit.js';
import { ICONS } from './ui.js';

export const StatisticsModule = {
  state: {
    period: 'week' // 'day' | 'week' | 'month'
  },

  init() {
    document.getElementById('stats-period-switch')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-stats-period]');
      if (!btn) return;
      this.state.period = btn.dataset.statsPeriod;
      this.render();
    });
  },

  renderPeriodButtons() {
    document.querySelectorAll('#stats-period-switch [data-stats-period]').forEach((btn) => {
      const active = btn.dataset.statsPeriod === this.state.period;
      btn.classList.toggle('seg-btn--active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  },

  /**
   * Lọc công việc thuộc khung thời gian Ngày / Tuần (7 ngày) / Tháng (30 ngày).
   */
  filterTasksByPeriod(tasks, period, now) {
    const todayKey = formatDateKey(now);

    if (period === 'day') {
      return tasks.filter(
        (t) =>
          isTaskForToday(t, todayKey) ||
          (t.status === db.TASK_STATUSES.COMPLETED && formatDateKey(t.updatedAt) === todayKey)
      );
    }

    const daysBack = period === 'week' ? 6 : 29;
    const minKey = formatDateKey(addDays(now, -daysBack));

    return tasks.filter((t) => {
      const refKey = t.dueDate
        ? formatDateKey(t.dueDate)
        : formatDateKey(t.updatedAt || t.createdAt);
      return refKey >= minKey && refKey <= todayKey;
    });
  },

  /**
   * Vẽ biểu đồ cột SVG thuần (Hoạt động hoàn thành công việc + check-in thói quen).
   */
  renderActivityChart(tasks, habitLogs, period, now) {
    const container = document.getElementById('stats-chart-container');
    const captionEl = document.getElementById('stats-chart-caption');
    if (!container) return;

    const buckets = [];
    const shortDays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    if (period === 'day') {
      // 4 khung giờ trong ngày hôm nay: Sáng, Trưa, Chiều, Tối
      const todayKey = formatDateKey(now);
      const slots = [
        { label: 'Sáng', minH: 0, maxH: 11, count: 0 },
        { label: 'Trưa', minH: 11, maxH: 14, count: 0 },
        { label: 'Chiều', minH: 14, maxH: 18, count: 0 },
        { label: 'Tối', minH: 18, maxH: 24, count: 0 }
      ];

      for (const t of tasks) {
        if (t.status !== db.TASK_STATUSES.COMPLETED || !t.updatedAt) continue;
        if (formatDateKey(t.updatedAt) !== todayKey) continue;
        const h = new Date(t.updatedAt).getHours();
        const slot = slots.find((s) => h >= s.minH && h < s.maxH);
        if (slot) slot.count += 1;
      }

      for (const s of slots) {
        buckets.push({ label: s.label, tasksDone: s.count, habitsDone: 0 });
      }
      if (captionEl) captionEl.textContent = 'Công việc hoàn thành theo khung giờ hôm nay';
    } else if (period === 'week') {
      for (let i = 6; i >= 0; i--) {
        const d = addDays(now, -i);
        const key = formatDateKey(d);
        const tasksDone = tasks.filter(
          (t) => t.status === db.TASK_STATUSES.COMPLETED && formatDateKey(t.updatedAt) === key
        ).length;
        const habitsDone = habitLogs.filter((l) => l.completed && l.date === key).length;
        buckets.push({ label: shortDays[d.getDay()], tasksDone, habitsDone });
      }
      if (captionEl) captionEl.textContent = '7 ngày gần nhất: Công việc xong (xanh dương) & Thói quen (xanh lá)';
    } else {
      // 30 ngày gom thành 5 cụm (mỗi cụm 6 ngày)
      for (let g = 4; g >= 0; g--) {
        const endDate = addDays(now, -g * 6);
        const startDate = addDays(endDate, -5);
        const startKey = formatDateKey(startDate);
        const endKey = formatDateKey(endDate);

        const tasksDone = tasks.filter((t) => {
          if (t.status !== db.TASK_STATUSES.COMPLETED) return false;
          const k = formatDateKey(t.updatedAt);
          return k >= startKey && k <= endKey;
        }).length;

        const habitsDone = habitLogs.filter(
          (l) => l.completed && l.date >= startKey && l.date <= endKey
        ).length;

        buckets.push({
          label: `${startDate.getDate()}/${startDate.getMonth() + 1}`,
          tasksDone,
          habitsDone
        });
      }
      if (captionEl) captionEl.textContent = '30 ngày gần nhất (nhóm 6 ngày): Công việc & Thói quen';
    }

    const maxVal = Math.max(1, ...buckets.map((b) => Math.max(b.tasksDone, b.habitsDone)));
    const hasAnyActivity = buckets.some((b) => b.tasksDone > 0 || b.habitsDone > 0);

    const chartW = 360;
    const chartH = 156;
    const padTop = 18;
    const padBottom = 28;
    const usableH = chartH - padTop - padBottom;
    const slotW = chartW / buckets.length;

    const barsSVG = buckets
      .map((b, idx) => {
        const cx = idx * slotW + slotW / 2;
        const singleBar = period === 'day';
        const barW = singleBar ? Math.min(28, slotW * 0.4) : Math.min(14, slotW * 0.28);

        const hTask = Math.round((b.tasksDone / maxVal) * usableH);
        const yTask = padTop + (usableH - hTask);

        let group = '';
        if (singleBar) {
          group += `
            <rect x="${cx - barW / 2}" y="${yTask}" width="${barW}" height="${Math.max(hTask, b.tasksDone ? 4 : 2)}" rx="4" class="svg-bar svg-bar--task" />
            ${b.tasksDone > 0 ? `<text x="${cx}" y="${yTask - 5}" text-anchor="middle" class="svg-val">${b.tasksDone}</text>` : ''}
          `;
        } else {
          const hHabit = Math.round((b.habitsDone / maxVal) * usableH);
          const yHabit = padTop + (usableH - hHabit);
          const gap = 3;
          group += `
            <rect x="${cx - barW - gap / 2}" y="${yTask}" width="${barW}" height="${Math.max(hTask, b.tasksDone ? 4 : 2)}" rx="3" class="svg-bar svg-bar--task" />
            <rect x="${cx + gap / 2}" y="${yHabit}" width="${barW}" height="${Math.max(hHabit, b.habitsDone ? 4 : 2)}" rx="3" class="svg-bar svg-bar--habit" />
            ${b.tasksDone > 0 ? `<text x="${cx - barW / 2 - gap / 2}" y="${yTask - 4}" text-anchor="middle" class="svg-val">${b.tasksDone}</text>` : ''}
            ${b.habitsDone > 0 ? `<text x="${cx + barW / 2 + gap / 2}" y="${yHabit - 4}" text-anchor="middle" class="svg-val">${b.habitsDone}</text>` : ''}
          `;
        }

        group += `<text x="${cx}" y="${chartH - 8}" text-anchor="middle" class="svg-axis">${escapeHTML(b.label)}</text>`;
        return group;
      })
      .join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${chartW} ${chartH}" class="activity-svg" role="img" aria-label="Biểu đồ hoạt động">
        <line x1="8" y1="${padTop + usableH}" x2="${chartW - 8}" y2="${padTop + usableH}" class="svg-baseline" />
        ${barsSVG}
      </svg>
      ${
        !hasAnyActivity
          ? `<p class="section-head__meta" style="text-align:center; margin-top:4px;">Chưa có dữ liệu hoàn thành trong khung thời gian này.</p>`
          : ''
      }
    `;
  },

  renderStatusBreakdown(allTasks, now) {
    const container = document.getElementById('stats-status-breakdown');
    if (!container) return;

    const counts = { completed: 0, in_progress: 0, todo: 0, overdue: 0 };
    for (const t of allTasks) {
      const st = getEffectiveTaskStatus(t, now);
      if (st in counts) counts[st] += 1;
    }

    const total = allTasks.length || 1;
    const rows = [
      { key: 'completed', label: 'Hoàn thành', count: counts.completed, cls: 'bar-fill--success' },
      { key: 'in_progress', label: 'Đang thực hiện', count: counts.in_progress, cls: 'bar-fill--blue' },
      { key: 'todo', label: 'Chưa thực hiện', count: counts.todo, cls: 'bar-fill--muted' },
      { key: 'overdue', label: 'Quá hạn', count: counts.overdue, cls: 'bar-fill--danger' }
    ];

    container.innerHTML = rows
      .map((r) => {
        const pct = allTasks.length ? Math.round((r.count / total) * 100) : 0;
        return `
          <div class="breakdown-row">
            <div class="breakdown-row__head">
              <span>${r.label}</span>
              <strong>${r.count} (${pct}%)</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill ${r.cls}" style="width:${pct}%"></div>
            </div>
          </div>
        `;
      })
      .join('');
  },

  renderHabitStats(habits, habitLogs, now) {
    const container = document.getElementById('stats-habits-summary');
    if (!container) return;

    if (!habits.length) {
      container.innerHTML = `<p class="section-head__meta">Chưa có thói quen nào để thống kê.</p>`;
      return;
    }

    const logsByHabit = new Map();
    for (const log of habitLogs) {
      if (!log.completed) continue;
      if (!logsByHabit.has(log.habitId)) logsByHabit.set(log.habitId, new Set());
      logsByHabit.get(log.habitId).add(log.date);
    }

    const rows = habits.map((h) => ({
      habit: h,
      metrics: computeHabitMetrics(h, logsByHabit.get(h.id) || new Set(), now)
    }));

    const avgRate = Math.round(
      rows.reduce((sum, r) => sum + r.metrics.adherenceRate, 0) / rows.length
    );
    const maxBestStreak = Math.max(0, ...rows.map((r) => r.metrics.bestStreak));

    container.innerHTML = `
      <div class="stats-grid" style="margin-bottom:14px;">
        <div class="stat-box">
          <span class="stat-box__num">${habits.length}</span>
          <span class="stat-box__label">Thói quen</span>
        </div>
        <div class="stat-box">
          <span class="stat-box__num">${avgRate}%</span>
          <span class="stat-box__label">Duy trì TB</span>
        </div>
        <div class="stat-box">
          <span class="stat-box__num">${maxBestStreak}</span>
          <span class="stat-box__label">Chuỗi cao nhất</span>
        </div>
      </div>

      <div class="stack-sm">
        ${rows
          .map(
            ({ habit, metrics }) => `
              <div class="breakdown-row">
                <div class="breakdown-row__head">
                  <span>${escapeHTML(habit.name)}</span>
                  <span class="section-head__meta">
                    ${ICONS.flame} ${metrics.currentStreak} ngày · <strong>${metrics.adherenceRate}%</strong>
                  </span>
                </div>
                <div class="progress-track">
                  <div class="progress-fill bar-fill--success" style="width:${metrics.adherenceRate}%"></div>
                </div>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  },

  renderTaskHistory(allTasks) {
    const container = document.getElementById('stats-task-history');
    if (!container) return;

    const completed = allTasks
      .filter((t) => t.status === db.TASK_STATUSES.COMPLETED)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 12);

    if (!completed.length) {
      container.innerHTML = `<p class="section-head__meta">Chưa có công việc hoàn thành nào trong lịch sử.</p>`;
      return;
    }

    container.innerHTML = completed
      .map(
        (t) => `
          <div class="kv-row">
            <span class="history-task-title">${escapeHTML(t.title)}</span>
            <span class="section-head__meta" style="flex-shrink:0;">${escapeHTML(formatDateTimeVN(t.updatedAt))}</span>
          </div>
        `
      )
      .join('');
  },

  async render() {
    this.renderPeriodButtons();
    const now = new Date();

    const [allTasks, habits, habitLogs] = await Promise.all([
      db.getAllRecords(db.STORES.TASKS),
      db.getAllRecords(db.STORES.HABITS),
      db.getAllRecords(db.STORES.HABIT_LOGS)
    ]);

    const periodTasks = this.filterTasksByPeriod(allTasks, this.state.period, now);
    const totalAll = allTasks.length;
    const completedAll = allTasks.filter((t) => t.status === db.TASK_STATUSES.COMPLETED).length;
    const rateAll = totalAll > 0 ? Math.round((completedAll / totalAll) * 100) : 0;

    const periodDone = periodTasks.filter((t) => t.status === db.TASK_STATUSES.COMPLETED).length;
    const periodRate = periodTasks.length > 0 ? Math.round((periodDone / periodTasks.length) * 100) : 0;

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };

    setEl('stat-all-total', totalAll);
    setEl('stat-all-done', completedAll);
    setEl('stat-all-rate', `${rateAll}%`);

    const periodNames = { day: 'hôm nay', week: '7 ngày qua', month: '30 ngày qua' };
    setEl(
      'stat-period-summary',
      `Trong ${periodNames[this.state.period]}: hoàn thành ${periodDone}/${periodTasks.length} công việc (${periodRate}%).`
    );

    this.renderActivityChart(allTasks, habitLogs, this.state.period, now);
    this.renderStatusBreakdown(allTasks, now);
    this.renderHabitStats(habits, habitLogs, now);
    this.renderTaskHistory(allTasks);
  }
};
