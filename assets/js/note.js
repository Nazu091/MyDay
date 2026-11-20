/**
 * note.js
 * Phân hệ Notes – Ghi chú cá nhân (Giai đoạn 6):
 * - Tạo, chỉnh sửa, xóa ghi chú (có xác nhận)
 * - Tìm kiếm tức thời theo tiêu đề và nội dung
 * - Ghim / bỏ ghim ghi chú quan trọng (tự đẩy nhóm Đã ghim lên đầu)
 * - Hiển thị ngày tạo và thời gian cập nhật gần nhất
 */

import * as db from './database.js';
import { escapeHTML, formatDateTimeVN } from './utils.js';
import { ICONS, closeModal, openModal, showToast } from './ui.js';

export const NoteModule = {
  state: {
    searchQuery: '',
    editingNoteId: null
  },

  init(callbacks) {
    this.callbacks = callbacks;
    this.bindEvents();
  },

  bindEvents() {
    const panel = document.getElementById('profile-notes');
    if (panel) {
      document.getElementById('btn-add-note')?.addEventListener('click', () => {
        this.openCreateModal();
      });

      const searchInput = document.getElementById('notes-search-input');
      const clearBtn = document.getElementById('notes-search-clear');
      searchInput?.addEventListener('input', (e) => {
        this.state.searchQuery = e.target.value;
        if (clearBtn) clearBtn.hidden = !this.state.searchQuery;
        this.render();
      });

      clearBtn?.addEventListener('click', () => {
        this.state.searchQuery = '';
        if (searchInput) searchInput.value = '';
        clearBtn.hidden = true;
        this.render();
      });

      panel.addEventListener('click', async (e) => {
        const pinBtn = e.target.closest('[data-action="toggle-pin-note"]');
        if (pinBtn) {
          await this.togglePin(pinBtn.dataset.noteId);
          return;
        }

        const delBtn = e.target.closest('[data-action="delete-note"]');
        if (delBtn) {
          await this.deleteNote(delBtn.dataset.noteId);
          return;
        }

        const editTrigger = e.target.closest('[data-action="edit-note"]');
        if (editTrigger) {
          await this.openEditModal(editTrigger.dataset.noteId);
        }
      });
    }

    document.getElementById('note-form')?.addEventListener('submit', (e) => {
      this.handleNoteFormSubmit(e);
    });

    document.getElementById('btn-delete-note-modal')?.addEventListener('click', async () => {
      if (!this.state.editingNoteId) return;
      const deleted = await this.deleteNote(this.state.editingNoteId);
      if (deleted) closeModal('modal-note');
    });
  },

  openCreateModal() {
    this.state.editingNoteId = null;
    document.getElementById('note-form')?.reset();
    document.getElementById('modal-note-title').textContent = 'Tạo ghi chú mới';
    document.getElementById('btn-save-note').textContent = 'Lưu ghi chú';
    document.getElementById('btn-delete-note-modal').hidden = true;
    document.getElementById('note-timestamps-meta').hidden = true;

    openModal('modal-note');
    setTimeout(() => document.getElementById('note-title-input')?.focus(), 180);
  },

  async openEditModal(noteId) {
    const note = await db.getRecord(db.STORES.NOTES, noteId);
    if (!note) return;

    this.state.editingNoteId = note.id;
    document.getElementById('modal-note-title').textContent = 'Chỉnh sửa ghi chú';
    document.getElementById('btn-save-note').textContent = 'Cập nhật ghi chú';
    document.getElementById('btn-delete-note-modal').hidden = false;

    document.getElementById('note-title-input').value = note.title || '';
    document.getElementById('note-content-input').value = note.content || '';
    document.getElementById('note-pin-check').checked = Boolean(note.isPinned);

    const metaEl = document.getElementById('note-timestamps-meta');
    if (metaEl) {
      metaEl.hidden = false;
      metaEl.textContent = `Tạo lúc: ${formatDateTimeVN(note.createdAt)} · Cập nhật: ${formatDateTimeVN(note.updatedAt)}`;
    }

    openModal('modal-note');
  },

  async handleNoteFormSubmit(event) {
    event.preventDefault();

    const title = document.getElementById('note-title-input')?.value || '';
    const content = document.getElementById('note-content-input')?.value || '';
    const isPinned = Boolean(document.getElementById('note-pin-check')?.checked);

    try {
      if (this.state.editingNoteId) {
        const existing = await db.getRecord(db.STORES.NOTES, this.state.editingNoteId);
        if (!existing) throw new Error('Ghi chú không còn tồn tại.');

        const updated = db.buildNoteRecord({
          ...existing,
          title: title.trim() || 'Không có tiêu đề',
          content,
          isPinned
        });
        await db.putRecord(db.STORES.NOTES, updated);
        showToast('Đã cập nhật ghi chú.', 'success');
      } else {
        const record = db.buildNoteRecord({
          title: title.trim() || 'Không có tiêu đề',
          content,
          isPinned
        });
        await db.addRecord(db.STORES.NOTES, record);
        showToast('Đã lưu ghi chú mới!', 'success');
      }

      closeModal('modal-note');
      await this.callbacks.onDataChanged?.();
    } catch (error) {
      showToast(error.message, 'error');
    }
  },

  async togglePin(noteId) {
    const note = await db.getRecord(db.STORES.NOTES, noteId);
    if (!note) return;

    const updated = db.buildNoteRecord({
      ...note,
      isPinned: !note.isPinned
    });
    await db.putRecord(db.STORES.NOTES, updated);
    showToast(updated.isPinned ? 'Đã ghim ghi chú.' : 'Đã bỏ ghim ghi chú.');
    await this.render();
  },

  async deleteNote(noteId) {
    const note = await db.getRecord(db.STORES.NOTES, noteId);
    if (!note) return false;

    const confirmed = window.confirm(`Bạn có chắc muốn xóa ghi chú "${note.title}"?`);
    if (!confirmed) return false;

    await db.deleteRecord(db.STORES.NOTES, noteId);
    showToast('Đã xóa ghi chú.', 'default');
    await this.callbacks.onDataChanged?.();
    return true;
  },

  renderNoteCard(note) {
    const preview = note.content || 'Chưa có nội dung chi tiết.';
    return `
      <article class="card note-card ${note.isPinned ? 'note-card--pinned' : ''}">
        <div class="note-card__head">
          <h4 class="note-card__title task-row__clickable" data-action="edit-note" data-note-id="${escapeHTML(note.id)}">
            ${escapeHTML(note.title || 'Không có tiêu đề')}
          </h4>
          <div class="task-row__actions">
            <button
              type="button"
              class="icon-btn ${note.isPinned ? 'icon-btn--accent' : ''}"
              data-action="toggle-pin-note"
              data-note-id="${escapeHTML(note.id)}"
              title="${note.isPinned ? 'Bỏ ghim' : 'Ghim ghi chú'}"
              aria-label="${note.isPinned ? 'Bỏ ghim' : 'Ghim ghi chú'}"
            >
              ${note.isPinned ? ICONS.pinFilled : ICONS.pin}
            </button>
            <button
              type="button"
              class="icon-btn icon-btn--danger"
              data-action="delete-note"
              data-note-id="${escapeHTML(note.id)}"
              title="Xóa ghi chú"
              aria-label="Xóa ghi chú"
            >
              ${ICONS.trash}
            </button>
          </div>
        </div>
        <p class="note-card__body task-row__clickable" data-action="edit-note" data-note-id="${escapeHTML(note.id)}">
          ${escapeHTML(preview)}
        </p>
        <div class="note-card__foot">
          <span>Tạo: ${escapeHTML(formatDateTimeVN(note.createdAt))}</span>
          <span>Sửa: ${escapeHTML(formatDateTimeVN(note.updatedAt))}</span>
        </div>
      </article>
    `;
  },

  async render() {
    const container = document.getElementById('notes-list-container');
    const countEl = document.getElementById('notes-count-badge');
    if (!container) return;

    const allNotes = await db.getAllRecords(db.STORES.NOTES);
    const query = this.state.searchQuery.trim().toLowerCase();

    const filtered = allNotes
      .filter((n) => {
        if (!query) return true;
        return `${n.title || ''} ${n.content || ''}`.toLowerCase().includes(query);
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (countEl) {
      countEl.textContent = query
        ? `Tìm thấy ${filtered.length} / ${allNotes.length} ghi chú`
        : `${allNotes.length} ghi chú`;
    }

    if (!allNotes.length) {
      container.innerHTML = `
        <div class="empty-state">
          <p>Chưa có ghi chú nào. Nhấn <strong>+ Tạo ghi chú</strong> để lưu ý tưởng hoặc thông tin quan trọng.</p>
        </div>
      `;
      return;
    }

    if (!filtered.length) {
      container.innerHTML = `<div class="empty-state"><p>Không tìm thấy ghi chú nào khớp với "${escapeHTML(this.state.searchQuery)}".</p></div>`;
      return;
    }

    const pinned = filtered.filter((n) => n.isPinned);
    const others = filtered.filter((n) => !n.isPinned);

    let html = '';
    if (pinned.length) {
      html += `
        <div class="notes-group">
          <p class="notes-group__label">Đã ghim (${pinned.length})</p>
          <div class="notes-grid">${pinned.map((n) => this.renderNoteCard(n)).join('')}</div>
        </div>
      `;
    }
    if (others.length) {
      html += `
        <div class="notes-group">
          ${pinned.length ? `<p class="notes-group__label">Ghi chú khác (${others.length})</p>` : ''}
          <div class="notes-grid">${others.map((n) => this.renderNoteCard(n)).join('')}</div>
        </div>
      `;
    }

    container.innerHTML = html;
  }
};
