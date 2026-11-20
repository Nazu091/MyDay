/**
 * settings.js
 * Phân hệ Settings – Cài đặt, Nhắc nhở, Sao lưu & Khôi phục JSON (v1.0.1):
 * - Chuyển Light Mode / Dark Mode / Theo hệ thống (lưu LocalStorage)
 * - Cấu hình nhắc nhở hằng ngày (LocalStorage + Notification/SW API + nhắc trong ứng dụng)
 * - Sao lưu & Khôi phục dữ liệu JSON có kiểm tra cấu trúc và xác nhận
 * - Hướng dẫn bảo vệ file sao lưu trung thực (chưa mã hóa)
 * - Xóa toàn bộ dữ liệu xác nhận 2 bước
 * - Thông tin phiên bản, trạng thái PWA/Offline & kiểm tra cập nhật
 */

import * as db from './database.js';
import { escapeHTML, formatDateKey } from './utils.js';
import { showToast } from './ui.js';

export const APP_VERSION = '1.0.1';
const SETTINGS_STORAGE_KEY = 'myday_settings_v1';
const LAST_REMINDER_DATE_KEY = 'myday_last_reminder_date';

const DEFAULT_SETTINGS = {
  theme: 'system', // 'light' | 'dark' | 'system'
  reminderEnabled: false,
  reminderTime: '08:00'
};

export const SettingsModule = {
  reminderIntervalId: null,

  getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },

  saveSettings(partial) {
    const next = { ...this.getSettings(), ...partial };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    this.applyTheme(next.theme);
    return next;
  },

  applyTheme(theme = this.getSettings().theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      const isDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      metaTheme.setAttribute('content', isDark ? '#0B0F19' : '#F9FAFB');
    }
  },

  init(callbacks = {}) {
    this.callbacks = callbacks;

    // 1. Chuyển Light / Dark / System
    document.getElementById('theme-selector')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-theme-choice]');
      if (!btn) return;
      const choice = btn.dataset.themeChoice;
      this.saveSettings({ theme: choice });
      this.syncThemeButtons();
      const labels = { light: 'Sáng', dark: 'Tối', system: 'Theo hệ thống' };
      showToast(`Đã chuyển giao diện: ${labels[choice] || choice}`);
    });

    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemThemeChange = () => {
      if (this.getSettings().theme === 'system') {
        this.applyTheme('system');
      }
    };
    if (typeof darkQuery.addEventListener === 'function') {
      darkQuery.addEventListener('change', onSystemThemeChange);
    } else if (typeof darkQuery.addListener === 'function') {
      darkQuery.addListener(onSystemThemeChange);
    }

    // 2. Cấu hình nhắc nhở
    document.getElementById('setting-reminder-enabled')?.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      if (enabled && 'Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          // Safari có thể hạn chế nếu chưa cài Home Screen; vẫn nhắc trong app
        }
      }
      this.saveSettings({ reminderEnabled: enabled });
      this.updateReminderStatusUI();
      showToast(enabled ? 'Đã bật nhắc nhở hằng ngày.' : 'Đã tắt nhắc nhở.');
    });

    document.getElementById('setting-reminder-time')?.addEventListener('change', (e) => {
      const time = e.target.value || '08:00';
      this.saveSettings({ reminderTime: time });
      localStorage.removeItem(LAST_REMINDER_DATE_KEY);
      showToast(`Đã đặt giờ nhắc nhở: ${time}`);
    });

    document.getElementById('btn-test-reminder')?.addEventListener('click', () => {
      this.triggerReminderNotification(true);
    });

    // 3. Sao lưu JSON
    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      this.handleExportBackup();
    });

    // 4. Khôi phục JSON
    const importInput = document.getElementById('input-import-json');
    document.getElementById('btn-import-json')?.addEventListener('click', () => {
      importInput?.click();
    });

    importInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await this.handleImportBackup(file);
      }
      e.target.value = '';
    });

    // 5. Xóa toàn bộ dữ liệu (xác nhận 2 lớp)
    document.getElementById('btn-clear-all-data')?.addEventListener('click', () => {
      this.handleClearAllData();
    });

    // 6. Kiểm tra cập nhật PWA (Service Worker)
    document.getElementById('btn-check-update')?.addEventListener('click', () => {
      this.callbacks.onCheckUpdate?.();
    });

    this.startReminderWatcher();
  },

  /* ========================================================================
   * NHẮC NHỞ HẰNG NGÀY (LOCAL, TƯƠNG THÍCH CHROME & SAFARI iOS)
   * ======================================================================== */

  startReminderWatcher() {
    if (this.reminderIntervalId) clearInterval(this.reminderIntervalId);

    const check = () => {
      const settings = this.getSettings();
      if (!settings.reminderEnabled) return;

      const now = new Date();
      const todayKey = formatDateKey(now);
      if (localStorage.getItem(LAST_REMINDER_DATE_KEY) === todayKey) return;

      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (currentHHMM >= settings.reminderTime) {
        localStorage.setItem(LAST_REMINDER_DATE_KEY, todayKey);
        this.triggerReminderNotification(false);
      }
    };

    check();
    this.reminderIntervalId = setInterval(check, 30000);
  },

  async triggerReminderNotification(isTest = false) {
    const tasks = await db.getAllRecords(db.STORES.TASKS);
    const pendingCount = tasks.filter((t) => t.status !== db.TASK_STATUSES.COMPLETED).length;

    const title = isTest ? 'MyDay – Kiểm tra nhắc nhở' : 'MyDay – Nhắc nhở hôm nay';
    const body = pendingCount > 0
      ? `Bạn đang có ${pendingCount} công việc chưa hoàn thành. Hãy mở MyDay để kiểm tra kế hoạch!`
      : 'Tuyệt vời! Bạn hiện không còn công việc tồn đọng nào.';

    if ('Notification' in window) {
      if (Notification.permission === 'default' && isTest) {
        try {
          await Notification.requestPermission();
        } catch {
          // Bỏ qua nếu trình duyệt từ chối
        }
      }

      if (Notification.permission === 'granted') {
        try {
          new Notification(title, {
            body,
            icon: './assets/icons/icon-192.png'
          });
          if (isTest) showToast('Đã gửi thông báo thử nghiệm!', 'success');
          this.updateReminderStatusUI();
          return;
        } catch {
          // Trên một số phiên bản iOS PWA, cần hiển thị thông qua ServiceWorkerRegistration
          try {
            if ('serviceWorker' in navigator) {
              const reg = await navigator.serviceWorker.getRegistration();
              if (reg && typeof reg.showNotification === 'function') {
                await reg.showNotification(title, {
                  body,
                  icon: './assets/icons/icon-192.png'
                });
                if (isTest) showToast('Đã gửi thông báo thử nghiệm!', 'success');
                this.updateReminderStatusUI();
                return;
              }
            }
          } catch {
            // Chuyển sang nhắc trực tiếp trong ứng dụng bên dưới
          }
        }
      }
    }

    showToast(`${title}: ${body}`, 'default', 4200);
    this.updateReminderStatusUI();
  },

  updateReminderStatusUI() {
    const statusEl = document.getElementById('reminder-permission-note');
    if (!statusEl) return;

    if (!('Notification' in window)) {
      statusEl.textContent = 'Trình duyệt hiện tại không hỗ trợ Notification API — nhắc nhở sẽ hiển thị trực tiếp trong ứng dụng khi bạn mở MyDay.';
      return;
    }

    const perm = Notification.permission;
    if (perm === 'granted') {
      statusEl.textContent = 'Quyền thông báo đã được cấp. Nhắc nhở sẽ hiển thị khi ứng dụng đang mở (không cần máy chủ).';
    } else if (perm === 'denied') {
      statusEl.textContent = 'Thông báo trình duyệt đang bị chặn — bạn có thể cấp lại quyền trong cài đặt trình duyệt, hoặc dùng nhắc nhở trực tiếp trong app.';
    } else {
      statusEl.textContent = 'Chưa cấp quyền thông báo hệ thống. Bật công tắc hoặc nhấn "Thử nhắc nhở ngay" để kích hoạt.';
    }
  },

  /* ========================================================================
   * SAO LƯU & KHÔI PHỤC DỮ LIỆU JSON
   * ======================================================================== */

  async handleExportBackup() {
    try {
      const payload = await db.exportAllData();
      payload.appVersion = APP_VERSION;
      payload.settings = this.getSettings();

      const jsonString = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const dateKey = formatDateKey(new Date());
      const a = document.createElement('a');
      a.href = url;
      a.download = `myday-backup-${dateKey}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Giữ Blob URL 5 giây để iOS Safari hoàn tất tải xuống ổn định
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      showToast(`Đã tải xuống file sao lưu myday-backup-${dateKey}.json`, 'success');
    } catch (error) {
      showToast(`Không thể sao lưu: ${error.message}`, 'error');
    }
  },

  async handleImportBackup(file) {
    try {
      const rawText = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new Error('Nội dung file không phải định dạng JSON hợp lệ.');
      }

      if (!parsed || parsed.app !== 'MyDay' || !parsed.data) {
        throw new Error('File JSON này không phải file sao lưu của ứng dụng MyDay.');
      }

      const summary = [
        `• Công việc: ${Array.isArray(parsed.data.Tasks) ? parsed.data.Tasks.length : 0}`,
        `• Thói quen: ${Array.isArray(parsed.data.Habits) ? parsed.data.Habits.length : 0}`,
        `• Nhật ký thói quen: ${Array.isArray(parsed.data.HabitLogs) ? parsed.data.HabitLogs.length : 0}`,
        `• Ghi chú: ${Array.isArray(parsed.data.Notes) ? parsed.data.Notes.length : 0}`,
        `• Danh mục: ${Array.isArray(parsed.data.Categories) ? parsed.data.Categories.length : 0}`
      ].join('\n');

      const confirmed = window.confirm(
        `Khôi phục dữ liệu từ file "${file.name}"?\n\nDữ liệu hiện tại trên thiết bị sẽ được thay thế bằng:\n${summary}\n\nBạn có chắc chắn muốn tiếp tục?`
      );
      if (!confirmed) return;

      await db.importAllData(parsed);

      if (parsed.settings && typeof parsed.settings === 'object') {
        this.saveSettings({
          theme: parsed.settings.theme || 'system',
          reminderEnabled: Boolean(parsed.settings.reminderEnabled),
          reminderTime: parsed.settings.reminderTime || '08:00'
        });
      }

      showToast('Khôi phục dữ liệu thành công!', 'success');
      await this.callbacks.onDataChanged?.();
    } catch (error) {
      showToast(`Lỗi khôi phục: ${error.message}`, 'error', 4000);
    }
  },

  async handleClearAllData() {
    const step1 = window.confirm(
      'CẢNH BÁO: Bạn sắp xóa toàn bộ công việc, thói quen, lịch sử, ghi chú và danh mục trên thiết bị này. Hành động này không thể hoàn tác.\n\nBạn nên nhấn "Sao lưu JSON" trước khi xóa. Tiếp tục?'
    );
    if (!step1) return;

    const confirmWord = window.prompt('Để xác nhận xóa toàn bộ dữ liệu, hãy nhập chính xác chữ: XOA');
    if (!confirmWord || confirmWord.trim().toUpperCase() !== 'XOA') {
      showToast('Đã hủy thao tác xóa dữ liệu.');
      return;
    }

    try {
      await db.clearAllData();
      await db.seedDefaultCategoriesIfEmpty();
      localStorage.removeItem(LAST_REMINDER_DATE_KEY);
      showToast('Đã xóa sạch toàn bộ dữ liệu cá nhân.', 'default');
      await this.callbacks.onDataChanged?.();
    } catch (error) {
      showToast(`Lỗi khi xóa dữ liệu: ${error.message}`, 'error');
    }
  },

  /* ========================================================================
   * HIỂN THỊ GIAO DIỆN SETTINGS
   * ======================================================================== */

  syncThemeButtons() {
    const current = this.getSettings().theme;
    document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      const isActive = btn.dataset.themeChoice === current;
      btn.classList.toggle('seg-btn--active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  },

  async render() {
    const settings = this.getSettings();
    this.syncThemeButtons();

    const remToggle = document.getElementById('setting-reminder-enabled');
    const remTime = document.getElementById('setting-reminder-time');
    if (remToggle) remToggle.checked = Boolean(settings.reminderEnabled);
    if (remTime) remTime.value = settings.reminderTime || '08:00';
    this.updateReminderStatusUI();

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    const versionEl = document.getElementById('settings-app-version');
    if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

    const modeEl = document.getElementById('settings-pwa-mode');
    if (modeEl) {
      modeEl.textContent = isStandalone
        ? 'Đã cài đặt (Màn hình chính)'
        : 'Đang chạy trên trình duyệt';
    }

    const swEl = document.getElementById('settings-sw-status');
    if (swEl) {
      if (!('serviceWorker' in navigator)) {
        swEl.textContent = 'Không hỗ trợ';
      } else {
        const reg = await navigator.serviceWorker.getRegistration();
        swEl.textContent = reg?.active ? 'Đang hoạt động (Sẵn sàng Offline)' : 'Chưa kích hoạt (cần HTTPS/localhost)';
      }
    }

    const dbInfoEl = document.getElementById('settings-db-summary');
    if (dbInfoEl) {
      const overview = await db.getDatabaseOverview();
      dbInfoEl.innerHTML = overview.stores
        .map(
          (store) => `
            <div class="kv-row">
              <span>${escapeHTML(store.name)}</span>
              <strong>${store.count} bản ghi</strong>
            </div>
          `
        )
        .join('');
    }
  }
};
