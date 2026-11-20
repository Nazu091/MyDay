/**
 * task.js
 * Phân hệ Quản lý công việc đầy đủ (Giai đoạn 4):
 * - CRUD công việc hoàn chỉnh (Thêm, Sửa, Xóa có xác nhận, Đánh dấu hoàn thành)
 * - Hỗ trợ Ngày/Giờ bắt đầu & kết thúc, Mức độ ưu tiên, Trạng thái (4 trạng thái)
 * - Hỗ trợ Công việc lặp lại (Hằng ngày / Hằng tuần / Hằng tháng) tự động sinh kỳ tiếp theo
 * - Quản lý Danh mục phân loại công việc (Thêm / Xóa danh mục tùy chỉnh)
 * - Tìm kiếm tức thời, Lọc theo Trạng thái / Ưu tiên / Danh mục & Sắp xếp linh hoạt
 */

import * as db from './database.js';
import {
  combineDateAndTimeToISO,
  escapeHTML,
  formatDateKey,
  formatTaskSchedule,
  getEffectiveTaskStatus,
  isTaskOverdue,
  shiftISOByRepeatRule,
  splitISOToDateAndTime
} from './utils.js';
import {
  ICONS,
  PRIORITY_LABELS,
  REPEAT_LABELS,
  STATUS_LABELS,
  closeModal,
  openModal,
  showToast
} from './ui.js';

const PRIORITY_WEIGHT = Object.freeze({ high: 3, medium: 2, low: 1 });

const CATEGORY_COLORS = [
  '#2563EB',
  '#111827',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4'
];

export const TaskModule = {
  state: {
    searchQuery: '',
    statusFilter: 'all',     // 'all' | 'todo' | 'in_progress' | 'overdue' | 'completed'
    priorityFilter: 'all',   // 'all' | 'high' | 'medium' | 'low'
    categoryFilter: 'all',   // 'all' | 'none' | <categoryId>
    sortBy: 'due_asc',       // 'due_asc' | 'priority_desc' | 'newest' | 'start_asc'
    editingTaskId: null,
    selectedCategoryColor: '#2563EB'
  },

  init(callbacks) {
    this.callbacks = callbacks;
    this.bindTaskViewEvents();
    this.bindTaskModalEvents();
    this.bindCategoryModalEvents();
  },

  /* ========================================================================
   * GẮN SỰ KIỆN GIAO DIỆN
   * ======================================================================== */

  bindTaskViewEvents() {
    const viewEl = document.getElementById('view-tasks');
    if (!viewEl) return;

    // Tìm kiếm tức thời
    const searchInput = document.getElementById('tasks-search-input');
    const clearSearchBtn = document.getElementById('tasks-search-clear');
    searchInput?.addEventListener('input', (e) => {
      this.state.searchQuery = e.target.value;
      if (clearSearchBtn) clearSearchBtn.hidden = !this.state.searchQuery;
      this.render();
    });

    clearSearchBtn?.addEventListener('click', () => {
      this.state.searchQuery = '';
      if (searchInput) searchInput.value = '';
      clearSearchBtn.hidden = true;
      this.render();
    });

    // Lọc theo Trạng thái (Status Filter Pills)
    document.getElementById('tasks-status-pills')?.addEventListener('click', (e) => {
      const pill = e.target.closest('[data-status-filter]');
      if (!pill) return;
      this.state.statusFilter = pill.dataset.statusFilter;
      this.render();
    });

    // Lọc theo Ưu tiên, Danh mục và Sắp xếp
    document.getElementById('tasks-filter-priority')?.addEventListener('change', (e) => {
      this.state.priorityFilter = e.target.value;
      this.render();
    });

    document.getElementById('tasks-filter-category')?.addEventListener('change', (e) => {
      this.state.categoryFilter = e.target.value;
      this.render();
    });

    document.getElementById('tasks-sort-select')?.addEventListener('change', (e) => {
      this.state.sortBy = e.target.value;
      this.render();
    });

    // Nút đặt lại bộ lọc
    document.getElementById('btn-reset-task-filters')?.addEventListener('click', () => {
      this.resetFilters();
    });

    // Nút mở quản lý danh mục
    document.getElementById('btn-open-categories')?.addEventListener('click', () => {
      this.openCategoriesModal();
    });

    // Event delegation trên danh sách công việc
    document.getElementById('tasks-list-container')?.addEventListener('click', async (event) => {
      const toggleBtn = event.target.closest('[data-action="toggle-task"]');
      if (toggleBtn) {
        await this.toggleTaskCompletion(toggleBtn.dataset.taskId);
        return;
      }

      const deleteBtn = event.target.closest('[data-action="delete-task"]');
      if (deleteBtn) {
        await this.deleteTask(deleteBtn.dataset.taskId);
        return;
      }

      const editTrigger = event.target.closest('[data-action="edit-task"]');
      if (editTrigger) {
        await this.openEditModal(editTrigger.dataset.taskId);
      }
    });
  },

  bindTaskModalEvents() {
    // Chọn mức độ ưu tiên
    document.getElementById('task-priority-group')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-priority]');
      if (btn) this.setFormPriority(btn.dataset.priority);
    });

    // Submit form Thêm / Sửa công việc
    document.getElementById('task-form')?.addEventListener('submit', (e) => {
      this.handleTaskFormSubmit(e);
    });

    // Xóa công việc ngay trong Modal chỉnh sửa
    document.getElementById('btn-delete-task-modal')?.addEventListener('click', async () => {
      if (!this.state.editingTaskId) return;
      const deleted = await this.deleteTask(this.state.editingTaskId);
      if (deleted) closeModal('modal-task');
    });
  },

  bindCategoryModalEvents() {
    // Chọn màu danh mục
    const paletteEl = document.getElementById('category-color-palette');
    if (paletteEl) {
      paletteEl.innerHTML = CATEGORY_COLORS.map(
        (color) => `
          <button
            type="button"
            class="color-swatch ${color === this.state.selectedCategoryColor ? 'color-swatch--active' : ''}"
            style="background-color: ${color}"
            data-color="${color}"
            aria-label="Chọn màu ${color}"
          ></button>
        `
      ).join('');

      paletteEl.addEventListener('click', (e) => {
        const swatch = e.target.closest('[data-color]');
        if (!swatch) return;
        this.state.selectedCategoryColor = swatch.dataset.color;
        paletteEl.querySelectorAll('.color-swatch').forEach((btn) => {
          btn.classList.toggle('color-swatch--active', btn.dataset.color === this.state.selectedCategoryColor);
        });
      });
    }

    // Thêm danh mục mới
    document.getElementById('category-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('category-name-input');
      const name = nameInput?.value || '';

      try {
        const record = db.buildCategoryRecord({
          name,
          color: this.state.selectedCategoryColor
        });
        await db.addRecord(db.STORES.CATEGORIES, record);
        if (nameInput) nameInput.value = '';
        showToast(`Đã thêm danh mục "${record.name}".`, 'success');
        await this.renderCategoriesList();
        await this.callbacks.onDataChanged?.();
      } catch (error) {
        const msg = error?.name === 'ConstraintError'
          ? 'Tên danh mục này đã tồn tại.'
          : error.message;
        showToast(msg, 'error');
      }
    });

    // Xóa danh mục
    document.getElementById('categories-list')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="delete-category"]');
      if (!btn) return;
      await this.deleteCategory(btn.dataset.categoryId);
    });
  },

  /* ========================================================================
   * MODAL THÊM & CHỈNH SỬA CÔNG VIỆC
   * ======================================================================== */

  async populateCategorySelects(selectedId = '') {
    const categories = await db.getAllRecords(db.STORES.CATEGORIES);
    const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    const formSelect = document.getElementById('task-category');
    if (formSelect) {
      formSelect.innerHTML =
        `<option value="">Không phân loại</option>` +
        sorted
          .map((cat) => `<option value="${escapeHTML(cat.id)}">${escapeHTML(cat.name)}</option>`)
          .join('');
      formSelect.value = selectedId || '';
    }

    const filterSelect = document.getElementById('tasks-filter-category');
    if (filterSelect) {
      const currentVal = this.state.categoryFilter;
      filterSelect.innerHTML =
        `<option value="all">Tất cả danh mục</option>` +
        `<option value="none">Không phân loại</option>` +
        sorted
          .map((cat) => `<option value="${escapeHTML(cat.id)}">${escapeHTML(cat.name)}</option>`)
          .join('');

      const exists = currentVal === 'all' || currentVal === 'none' || sorted.some((c) => c.id === currentVal);
      if (!exists) this.state.categoryFilter = 'all';
      filterSelect.value = this.state.categoryFilter;
    }
  },

  setFormPriority(priority) {
    const hiddenInput = document.getElementById('task-priority');
    if (hiddenInput) hiddenInput.value = priority;

    document.querySelectorAll('#task-priority-group [data-priority]').forEach((btn) => {
      const isActive = btn.dataset.priority === priority;
      btn.classList.toggle('seg-btn--active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  },

  /**
   * Mở Modal ở chế độ Tạo mới công việc.
   * @param {{ dueDateKey?: string }} [preset]
   */
  async openCreateModal(preset = {}) {
    this.state.editingTaskId = null;

    const form = document.getElementById('task-form');
    form?.reset();

    await this.populateCategorySelects('');

    const titleHeading = document.getElementById('modal-task-title');
    if (titleHeading) titleHeading.textContent = 'Thêm công việc mới';

    const submitBtn = document.getElementById('btn-save-task');
    if (submitBtn) submitBtn.textContent = 'Lưu công việc';

    const deleteBtn = document.getElementById('btn-delete-task-modal');
    if (deleteBtn) deleteBtn.hidden = true;

    const dueInput = document.getElementById('task-due-date');
    if (dueInput) dueInput.value = preset.dueDateKey || formatDateKey(new Date());

    const statusSelect = document.getElementById('task-status');
    if (statusSelect) statusSelect.value = db.TASK_STATUSES.TODO;

    const repeatSelect = document.getElementById('task-repeat');
    if (repeatSelect) repeatSelect.value = db.REPEAT_RULES.NONE;

    this.setFormPriority(db.TASK_PRIORITIES.MEDIUM);
    openModal('modal-task');

    setTimeout(() => {
      document.getElementById('task-title')?.focus();
    }, 180);
  },

  /**
   * Mở Modal ở chế độ Chỉnh sửa công việc hiện có.
   * @param {string} taskId
   */
  async openEditModal(taskId) {
    const task = await db.getRecord(db.STORES.TASKS, taskId);
    if (!task) {
      showToast('Không tìm thấy công việc này.', 'error');
      return;
    }

    this.state.editingTaskId = task.id;
    await this.populateCategorySelects(task.categoryId || '');

    const titleHeading = document.getElementById('modal-task-title');
    if (titleHeading) titleHeading.textContent = 'Chỉnh sửa công việc';

    const submitBtn = document.getElementById('btn-save-task');
    if (submitBtn) submitBtn.textContent = 'Cập nhật công việc';

    const deleteBtn = document.getElementById('btn-delete-task-modal');
    if (deleteBtn) deleteBtn.hidden = false;

    const startParts = splitISOToDateAndTime(task.startDate);
    const dueParts = splitISOToDateAndTime(task.dueDate);

    document.getElementById('task-title').value = task.title || '';
    document.getElementById('task-start-date').value = startParts.date;
    document.getElementById('task-start-time').value = startParts.time;
    document.getElementById('task-due-date').value = dueParts.date;
    document.getElementById('task-due-time').value = dueParts.time;
    document.getElementById('task-status').value =
      task.status === db.TASK_STATUSES.OVERDUE ? db.TASK_STATUSES.TODO : task.status;
    document.getElementById('task-repeat').value = task.repeatRule || db.REPEAT_RULES.NONE;
    document.getElementById('task-desc').value = task.description || '';

    this.setFormPriority(task.priority || db.TASK_PRIORITIES.MEDIUM);
    openModal('modal-task');
  },

  /**
   * Lưu dữ liệu từ form (tự phân biệt Tạo mới hoặc Cập nhật) vào IndexedDB.
   * @param {SubmitEvent} event
   */
  async handleTaskFormSubmit(event) {
    event.preventDefault();

    const title = document.getElementById('task-title')?.value || '';
    const startDateStr = document.getElementById('task-start-date')?.value || '';
    const startTimeStr = document.getElementById('task-start-time')?.value || '';
    const dueDateStr = document.getElementById('task-due-date')?.value || '';
    const dueTimeStr = document.getElementById('task-due-time')?.value || '';
    const priority = document.getElementById('task-priority')?.value || db.TASK_PRIORITIES.MEDIUM;
    const status = document.getElementById('task-status')?.value || db.TASK_STATUSES.TODO;
    const categoryId = document.getElementById('task-category')?.value || null;
    const repeatRule = document.getElementById('task-repeat')?.value || db.REPEAT_RULES.NONE;
    const description = document.getElementById('task-desc')?.value || '';

    if (startTimeStr && !startDateStr) {
      showToast('Vui lòng chọn Ngày bắt đầu khi đã nhập Giờ bắt đầu.', 'error');
      return;
    }
    if (dueTimeStr && !dueDateStr) {
      showToast('Vui lòng chọn Ngày kết thúc khi đã nhập Giờ kết thúc.', 'error');
      return;
    }

    const startDate = startDateStr ? combineDateAndTimeToISO(startDateStr, startTimeStr, 'start') : null;
    const dueDate = dueDateStr ? combineDateAndTimeToISO(dueDateStr, dueTimeStr, 'end') : null;

    try {
      if (this.state.editingTaskId) {
        const existing = await db.getRecord(db.STORES.TASKS, this.state.editingTaskId);
        if (!existing) throw new Error('Công việc không còn tồn tại.');

        const wasCompleted = existing.status === db.TASK_STATUSES.COMPLETED;
        const updated = db.buildTaskRecord({
          ...existing,
          title,
          description,
          startDate,
          dueDate,
          priority,
          status,
          categoryId: categoryId || null,
          repeatRule
        });

        await db.putRecord(db.STORES.TASKS, updated);

        // Nếu người dùng đổi từ chưa hoàn thành -> hoàn thành ngay trong form sửa của việc lặp lại
        if (!wasCompleted && updated.status === db.TASK_STATUSES.COMPLETED) {
          const spawned = await this.spawnNextRecurringTaskIfNeeded(updated);
          showToast(
            spawned
              ? 'Đã cập nhật & tạo lịch lặp lại tiếp theo!'
              : 'Đã cập nhật công việc!',
            'success'
          );
        } else {
          showToast('Đã cập nhật công việc!', 'success');
        }
      } else {
        const newTask = db.buildTaskRecord({
          title,
          description,
          startDate,
          dueDate,
          priority,
          status,
          categoryId: categoryId || null,
          repeatRule
        });

        await db.addRecord(db.STORES.TASKS, newTask);
        showToast('Đã thêm công việc mới!', 'success');
      }

      closeModal('modal-task');
      await this.callbacks.onDataChanged?.();
    } catch (error) {
      showToast(error.message, 'error');
    }
  },

  /* ========================================================================
   * NGHIỆP VỤ HOÀN THÀNH, LẶP LẠI & XÓA CÔNG VIỆC
   * ======================================================================== */

  /**
   * Khi hoàn thành một công việc có quy tắc lặp lại (daily/weekly/monthly),
   * tự động sinh bản ghi công việc mới cho kỳ kế tiếp (tránh trùng lặp).
   * @param {object} completedTask
   * @returns {Promise<boolean>} true nếu vừa tạo mới kỳ kế tiếp
   */
  async spawnNextRecurringTaskIfNeeded(completedTask) {
    if (!completedTask || !completedTask.repeatRule || completedTask.repeatRule === db.REPEAT_RULES.NONE) {
      return false;
    }

    const baseDue = completedTask.dueDate || combineDateAndTimeToISO(formatDateKey(new Date()), '', 'end');
    const nextDue = shiftISOByRepeatRule(baseDue, completedTask.repeatRule);
    const nextStart = completedTask.startDate
      ? shiftISOByRepeatRule(completedTask.startDate, completedTask.repeatRule)
      : null;

    // Kiểm tra xem kỳ lặp lại tiếp theo đã tồn tại chưa (tránh nhân bản nếu bấm nhầm bật/tắt liên tục)
    const allTasks = await db.getAllRecords(db.STORES.TASKS);
    const alreadyExists = allTasks.some(
      (t) =>
        t.id !== completedTask.id &&
        t.status !== db.TASK_STATUSES.COMPLETED &&
        t.title === completedTask.title &&
        t.repeatRule === completedTask.repeatRule &&
        t.dueDate === nextDue
    );

    if (alreadyExists) return false;

    const nextTask = db.buildTaskRecord({
      title: completedTask.title,
      description: completedTask.description,
      startDate: nextStart,
      dueDate: nextDue,
      priority: completedTask.priority,
      status: db.TASK_STATUSES.TODO,
      categoryId: completedTask.categoryId,
      repeatRule: completedTask.repeatRule
    });

    await db.addRecord(db.STORES.TASKS, nextTask);
    return true;
  },

  /**
   * Đổi trạng thái hoàn thành <-> chưa hoàn thành (dùng chung cho cả Dashboard và Tab Công việc).
   * @param {string} taskId
   */
  async toggleTaskCompletion(taskId) {
    if (!taskId) return;
    try {
      const task = await db.getRecord(db.STORES.TASKS, taskId);
      if (!task) return;

      const isNowCompleted = task.status !== db.TASK_STATUSES.COMPLETED;
      const updated = db.buildTaskRecord({
        ...task,
        status: isNowCompleted ? db.TASK_STATUSES.COMPLETED : db.TASK_STATUSES.TODO
      });

      await db.putRecord(db.STORES.TASKS, updated);

      if (isNowCompleted) {
        const spawned = await this.spawnNextRecurringTaskIfNeeded(updated);
        showToast(
          spawned
            ? 'Đã hoàn thành & tự động tạo kỳ lặp lại tiếp theo!'
            : 'Đã đánh dấu hoàn thành công việc.',
          'success'
        );
      } else {
        showToast('Đã chuyển lại sang chưa thực hiện.', 'default');
      }

      await this.callbacks.onDataChanged?.();
    } catch (error) {
      showToast(`Không thể cập nhật: ${error.message}`, 'error');
    }
  },

  /**
   * Xóa một công việc có hộp thoại xác nhận.
   * @param {string} taskId
   * @returns {Promise<boolean>}
   */
  async deleteTask(taskId) {
    const task = await db.getRecord(db.STORES.TASKS, taskId);
    if (!task) return false;

    const confirmed = window.confirm(`Bạn có chắc chắn muốn xóa công việc "${task.title}"?`);
    if (!confirmed) return false;

    await db.deleteRecord(db.STORES.TASKS, taskId);
    showToast('Đã xóa công việc.', 'default');
    await this.callbacks.onDataChanged?.();
    return true;
  },

  /* ========================================================================
   * QUẢN LÝ DANH MỤC (CATEGORIES)
   * ======================================================================== */

  async openCategoriesModal() {
    await this.renderCategoriesList();
    openModal('modal-categories');
  },

  async renderCategoriesList() {
    const container = document.getElementById('categories-list');
    if (!container) return;

    const [categories, tasks] = await Promise.all([
      db.getAllRecords(db.STORES.CATEGORIES),
      db.getAllRecords(db.STORES.TASKS)
    ]);

    const taskCounts = new Map();
    for (const t of tasks) {
      if (t.categoryId) {
        taskCounts.set(t.categoryId, (taskCounts.get(t.categoryId) || 0) + 1);
      }
    }

    const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    if (!sorted.length) {
      container.innerHTML = `<div class="empty-state"><p>Chưa có danh mục nào.</p></div>`;
      return;
    }

    container.innerHTML = sorted
      .map((cat) => {
        const count = taskCounts.get(cat.id) || 0;
        return `
          <div class="cat-manage-row">
            <div class="cat-manage-row__info">
              <span class="cat-manage-row__dot" style="background-color: ${escapeHTML(cat.color)}"></span>
              <span>${escapeHTML(cat.name)}</span>
              <span class="section-head__meta">(${count})</span>
            </div>
            <button
              type="button"
              class="icon-btn icon-btn--danger"
              data-action="delete-category"
              data-category-id="${escapeHTML(cat.id)}"
              aria-label="Xóa danh mục ${escapeHTML(cat.name)}"
            >
              ${ICONS.trash}
            </button>
          </div>
        `;
      })
      .join('');
  },

  async deleteCategory(categoryId) {
    const cat = await db.getRecord(db.STORES.CATEGORIES, categoryId);
    if (!cat) return;

    const confirmed = window.confirm(
      `Xóa danh mục "${cat.name}"? Các công việc thuộc danh mục này sẽ chuyển sang "Không phân loại".`
    );
    if (!confirmed) return;

    // Gỡ liên kết categoryId ở các công việc liên quan để tránh dữ liệu mồ côi
    const linkedTasks = await db.getByIndex(db.STORES.TASKS, 'categoryId', categoryId);
    for (const task of linkedTasks) {
      await db.putRecord(db.STORES.TASKS, db.buildTaskRecord({ ...task, categoryId: null }));
    }

    await db.deleteRecord(db.STORES.CATEGORIES, categoryId);
    showToast(`Đã xóa danh mục "${cat.name}".`, 'default');
    await this.renderCategoriesList();
    await this.callbacks.onDataChanged?.();
  },

  /* ========================================================================
   * LỌC, TÌM KIẾM, SẮP XẾP & HIỂN THỊ DANH SÁCH
   * ======================================================================== */

  resetFilters() {
    this.state.searchQuery = '';
    this.state.statusFilter = 'all';
    this.state.priorityFilter = 'all';
    this.state.categoryFilter = 'all';
    this.state.sortBy = 'due_asc';

    const searchInput = document.getElementById('tasks-search-input');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('tasks-search-clear');
    if (clearBtn) clearBtn.hidden = true;
    const prioEl = document.getElementById('tasks-filter-priority');
    if (prioEl) prioEl.value = 'all';
    const catEl = document.getElementById('tasks-filter-category');
    if (catEl) catEl.value = 'all';
    const sortEl = document.getElementById('tasks-sort-select');
    if (sortEl) sortEl.value = 'due_asc';

    this.render();
  },

  hasActiveFilters() {
    return (
      this.state.searchQuery.trim().length > 0 ||
      this.state.statusFilter !== 'all' ||
      this.state.priorityFilter !== 'all' ||
      this.state.categoryFilter !== 'all'
    );
  },

  applyFiltersAndSort(tasks, now) {
    const query = this.state.searchQuery.trim().toLowerCase();

    const filtered = tasks.filter((task) => {
      const effectiveStatus = getEffectiveTaskStatus(task, now);

      if (this.state.statusFilter !== 'all' && effectiveStatus !== this.state.statusFilter) {
        return false;
      }

      if (this.state.priorityFilter !== 'all' && task.priority !== this.state.priorityFilter) {
        return false;
      }

      if (this.state.categoryFilter === 'none' && task.categoryId) {
        return false;
      }
      if (
        this.state.categoryFilter !== 'all' &&
        this.state.categoryFilter !== 'none' &&
        task.categoryId !== this.state.categoryFilter
      ) {
        return false;
      }

      if (query) {
        const haystack = `${task.title} ${task.description || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      // Đưa việc chưa hoàn thành lên trước việc đã hoàn thành khi xem 'Tất cả'
      if (this.state.statusFilter === 'all') {
        const aDone = a.status === db.TASK_STATUSES.COMPLETED ? 1 : 0;
        const bDone = b.status === db.TASK_STATUSES.COMPLETED ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
      }

      if (this.state.sortBy === 'priority_desc') {
        const diff = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
        if (diff !== 0) return diff;
        return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
      }

      if (this.state.sortBy === 'newest') {
        return new Date(b.createdAt) - new Date(a.createdAt);
      }

      if (this.state.sortBy === 'start_asc') {
        const aStart = a.startDate || a.dueDate || '9999';
        const bStart = b.startDate || b.dueDate || '9999';
        return aStart.localeCompare(bStart);
      }

      // Mặc định: due_asc (hạn gần nhất lên trước)
      if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return sorted;
  },

  renderStatusPills(allTasks, now) {
    const counts = {
      all: allTasks.length,
      todo: 0,
      in_progress: 0,
      overdue: 0,
      completed: 0
    };

    for (const task of allTasks) {
      const status = getEffectiveTaskStatus(task, now);
      if (status in counts) counts[status] += 1;
    }

    const pills = [
      { key: 'all', label: 'Tất cả' },
      { key: 'todo', label: 'Chưa làm' },
      { key: 'in_progress', label: 'Đang làm' },
      { key: 'overdue', label: 'Quá hạn' },
      { key: 'completed', label: 'Hoàn thành' }
    ];

    const container = document.getElementById('tasks-status-pills');
    if (!container) return;

    container.innerHTML = pills
      .map((p) => {
        const active = this.state.statusFilter === p.key;
        return `
          <button
            type="button"
            class="filter-pill ${active ? 'filter-pill--active' : ''} ${p.key === 'overdue' && counts.overdue > 0 ? 'filter-pill--warn' : ''}"
            data-status-filter="${p.key}"
            aria-pressed="${active ? 'true' : 'false'}"
          >
            <span>${p.label}</span>
            <span class="filter-pill__count">${counts[p.key]}</span>
          </button>
        `;
      })
      .join('');
  },

  async render() {
    const container = document.getElementById('tasks-list-container');
    const countEl = document.getElementById('tasks-total-badge');
    const resetBtn = document.getElementById('btn-reset-task-filters');
    if (!container) return;

    const now = new Date();
    const [allTasks, categories] = await Promise.all([
      db.getAllRecords(db.STORES.TASKS),
      db.getAllRecords(db.STORES.CATEGORIES)
    ]);

    await this.populateCategorySelects();
    this.renderStatusPills(allTasks, now);

    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const visibleTasks = this.applyFiltersAndSort(allTasks, now);

    if (resetBtn) resetBtn.hidden = !this.hasActiveFilters();
    if (countEl) {
      countEl.textContent = this.hasActiveFilters()
        ? `Hiển thị ${visibleTasks.length} / ${allTasks.length} công việc`
        : `${allTasks.length} công việc`;
    }

    if (!allTasks.length) {
      container.innerHTML = `
        <div class="empty-state">
          <p>Bạn chưa có công việc nào. Nhấn <strong>+ Thêm công việc</strong> để bắt đầu lên kế hoạch.</p>
        </div>
      `;
      return;
    }

    if (!visibleTasks.length) {
      container.innerHTML = `
        <div class="empty-state">
          <p>Không tìm thấy công việc nào khớp với bộ lọc hiện tại.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = visibleTasks
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
                    ? `<span class="meta-item">
                         ${ICONS.repeat}
                         <span>${escapeHTML(REPEAT_LABELS[task.repeatRule])}</span>
                       </span>`
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

            <div class="task-row__actions">
              <button
                type="button"
                class="icon-btn"
                data-action="edit-task"
                data-task-id="${escapeHTML(task.id)}"
                aria-label="Chỉnh sửa công việc"
                title="Chỉnh sửa"
              >
                ${ICONS.edit}
              </button>
              <button
                type="button"
                class="icon-btn icon-btn--danger"
                data-action="delete-task"
                data-task-id="${escapeHTML(task.id)}"
                aria-label="Xóa công việc"
                title="Xóa"
              >
                ${ICONS.trash}
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }
};
