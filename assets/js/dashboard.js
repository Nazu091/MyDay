/**
 * dashboard.js
 * Phân hệ Dashboard – Tổng quan trong ngày.
 * Đồng bộ trực tiếp với TaskModule (chạm vào công việc để chỉnh sửa,
 * tích hoàn thành có hỗ trợ tự động sinh lịch lặp lại).
 */

import * as db from './database.js';
import {
  escapeHTML,
  formatDateKey,
  formatTaskSchedule,
  formatVietnameseFullDate,
  getEffectiveTaskStatus,
  getVietnameseGreeting,
  isTaskForToday,
  isTaskOverdue
} from './utils.js';
import { ICONS, PRIORITY_LABELS, REPEAT_LABELS, STATUS_LABELS } from './ui.js';

const RING_RADIUS = 38;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const DashboardModule = {
  init(callbacks) {
    this.callbacks = callbacks;

    const viewEl = document.getElementById('view-home');
    if (!viewEl) return;

    viewEl.addEventListener('click', async (event) => {
      const toggleBtn = event.target.closest('[data-action="toggle-task"]');
      if (toggleBtn) {
        await this.callbacks.onToggleTask?.(toggleBtn.dataset.taskId);
        return;
      }

      const editTrigger = event.target.closest('[data-action="edit-task"]');
      if (editTrigger) {
        await this.callbacks.onEditTask?.(editTrigger.dataset.taskId);
        return;
      }

      if (event.target.closest('[data-action="open-quick-add"]')) {
        await this.callbacks.onOpenCreateTask?.();
        return;
      }

      const navBtn = event.target.closest('[data-navigate]');
      if (navBtn) {
        this.callbacks.onNavigate?.(navBtn.dataset.navigate);
      }
    });
  },

  async render() {
    const now = new Date();
    const todayKey = formatDateKey(now);

    const greetingEl = document.getElementById('dash-greeting');
    const dateEl = document.getElementById('dash-date');
    const subtitleEl = document.getElementById('dash-subtitle');

    if (greetingEl) greetingEl.textContent = getVietnameseGreeting(now);
    if (dateEl) dateEl.textContent = formatVietnameseFullDate(now);

    const [allTasks, allCategories] = await Promise.all([
      db.getAllRecords(db.STORES.TASKS),
      db.getAllRecords(db.STORES.CATEGORIES)
    ]);

    const categoryMap = new Map(allCategories.map((c) => [c.id, c]));

    const todayTasks = allTasks.filter((t) => isTaskForToday(t, todayKey));
    const totalToday = todayTasks.length;
    const completedToday = todayTasks.filter((t) => t.status === db.TASK_STATUSES.COMPLETED).length;
    const remainingToday = totalToday - completedToday;
    const completionRate = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;

    if (subtitleEl) {
      if (totalToday === 0) {
        subtitleEl.textContent = 'Hôm nay bạn chưa có công việc nào. Hãy thêm một việc để bắt đầu ngày mới.';
      } else if (remainingToday === 0) {
        subtitleEl.textContent = 'Tuyệt vời! Bạn đã hoàn thành toàn bộ công việc trong ngày hôm nay.';
      } else {
        subtitleEl.textContent = `Bạn còn ${remainingToday} công việc cần hoàn thành trong hôm nay.`;
      }
    }

    this.renderProgressCard({ totalToday, completedToday, remainingToday, completionRate });

    const importantTasks = allTasks
      .filter((t) => {
        if (t.priority !== db.TASK_PRIORITIES.HIGH) return false;
        return isTaskForToday(t, todayKey) || isTaskOverdue(t, now);
      })
      .sort((a, b) => {
        const aDone = a.status === db.TASK_STATUSES.COMPLETED ? 1 : 0;
        const bDone = b.status === db.TASK_STATUSES.COMPLETED ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
      });

    this.renderTaskList(
      document.getElementById('dash-important-list'),
      importantTasks,
      categoryMap,
      now,
      'Chưa có hoạt động ưu tiên cao nào trong hôm nay.'
    );

    const upcomingTasks = allTasks
      .filter((t) => t.status !== db.TASK_STATUSES.COMPLETED)
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .slice(0, 8);

    const upcomingBadge = document.getElementById('dash-upcoming-count');
    if (upcomingBadge) {
      const totalOpen = allTasks.filter((t) => t.status !== db.TASK_STATUSES.COMPLETED).length;
      upcomingBadge.textContent = `${totalOpen} việc`;
    }

    this.renderTaskList(
      document.getElementById('dash-upcoming-list'),
      upcomingTasks,
      categoryMap,
      now,
      'Không có công việc sắp tới nào. Nhấn "+ Thêm nhanh" để tạo công việc mới.'
    );
  },

  renderProgressCard({ totalToday, completedToday, remainingToday, completionRate }) {
    const totalEl = document.getElementById('stat-today-total');
    const doneEl = document.getElementById('stat-today-completed');
    const remainingEl = document.getElementById('stat-today-remaining');
    const percentEl = document.getElementById('stat-today-percent');
    const ringEl = document.getElementById('dash-progress-ring');

    if (totalEl) totalEl.textContent = String(totalToday);
    if (doneEl) doneEl.textContent = String(completedToday);
    if (remainingEl) remainingEl.textContent = String(remainingToday);
    if (percentEl) percentEl.textContent = `${completionRate}%`;

    if (ringEl) {
      const offset = RING_CIRCUMFERENCE - (completionRate / 100) * RING_CIRCUMFERENCE;
      ringEl.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
      ringEl.style.strokeDashoffset = `${offset}`;
    }
  },

  renderTaskList(container, tasks, categoryMap, now, emptyMessage) {
    if (!container) return;

    if (!tasks.length) {
      container.innerHTML = `<div class="empty-state"><p>${escapeHTML(emptyMessage)}</p></div>`;
      return;
    }

    container.innerHTML = tasks
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
              aria-label="${isDone ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'}: ${escapeHTML(task.title)}"
              aria-pressed="${isDone ? 'true' : 'false'}"
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
                ${
                  effectiveStatus === 'in_progress' || effectiveStatus === 'overdue'
                    ? `<span class="status-badge status-badge--${escapeHTML(effectiveStatus)}">${escapeHTML(STATUS_LABELS[effectiveStatus])}</span>`
                    : ''
                }
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
  }
};
