/**
 * app.js
 * Bộ điều phối trung tâm (Entry Point, Router & PWA Lifecycle Manager) của MyDay.
 */

import * as db from './database.js';
import { closeAllModals, closeModal, showToast } from './ui.js';
import { DashboardModule } from './dashboard.js';
import { TaskModule } from './task.js';
import { CalendarModule } from './calendar.js';
import { HabitModule } from './habit.js';
import { NoteModule } from './note.js';
import { StatisticsModule } from './statistics.js';
import { SettingsModule } from './settings.js';

const TAB_TITLES = Object.freeze({
  home: 'MyDay',
  tasks: 'Công việc',
  calendar: 'Lịch',
  habits: 'Thói quen',
  profile: 'Cá nhân'
});

let currentTab = 'home';
let currentProfileSection = 'notes';
let swRegistration = null;
let waitingWorker = null;
let refreshingOnUpdate = false;

/**
 * Cập nhật trạng thái kết nối Online / Offline trên header, sidebar và thanh thông báo Offline.
 */
function updateNetworkStatus() {
  const isOnline = navigator.onLine;
  document.querySelectorAll('[data-network-indicator]').forEach((el) => {
    el.classList.toggle('net-pill--online', isOnline);
    el.classList.toggle('net-pill--offline', !isOnline);
    const label = el.querySelector('.net-pill__text');
    if (label) label.textContent = isOnline ? 'Online' : 'Offline';
  });

  const offlineBanner = document.getElementById('offline-banner');
  if (offlineBanner) {
    offlineBanner.hidden = isOnline;
  }
}

/**
 * Hiển thị thanh thông báo khi có bản cập nhật Service Worker mới sẵn sàng.
 */
function showUpdateBanner(worker) {
  waitingWorker = worker;
  const banner = document.getElementById('update-banner');
  if (banner) banner.hidden = false;
}

/**
 * Đăng ký Service Worker & lắng nghe vòng đời cập nhật ứng dụng (tương thích Chrome & iOS Safari).
 */
async function registerServiceWorker() {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && !isLocal) return;

  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    swRegistration = registration;

    // Nếu đã có bản mới đang chờ kích hoạt
    if (registration.waiting) {
      showUpdateBanner(registration.waiting);
    }

    // Lắng nghe khi phát hiện phiên bản sw.js mới
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(installing);
        }
      });
    });

    // Tự tải lại giao diện sạch sẽ khi Service Worker mới tiếp quản
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshingOnUpdate) return;
      refreshingOnUpdate = true;
      window.location.reload();
    });
  } catch (error) {
    console.warn('Chưa thể đăng ký Service Worker:', error.message);
  }
}

/**
 * Cho phép người dùng chủ động kiểm tra bản cập nhật từ mục Cài đặt.
 */
async function checkForAppUpdate() {
  if (!swRegistration) {
    showToast('Service Worker chỉ khả dụng trên HTTPS hoặc localhost.');
    return;
  }
  if (!navigator.onLine) {
    showToast('Đang ở chế độ Offline — không thể kiểm tra bản cập nhật lúc này.');
    return;
  }

  try {
    await swRegistration.update();
    if (swRegistration.waiting) {
      showUpdateBanner(swRegistration.waiting);
      showToast('Đã tìm thấy phiên bản mới! Nhấn "Cập nhật ngay".', 'success');
    } else {
      showToast('Bạn đang sử dụng phiên bản MyDay mới nhất.', 'success');
    }
  } catch {
    showToast('Không thể kiểm tra cập nhật lúc này.', 'error');
  }
}

async function switchTab(tabName) {
  if (!TAB_TITLES[tabName]) return;
  currentTab = tabName;

  const mobileTitle = document.getElementById('mobile-header-title');
  if (mobileTitle) mobileTitle.textContent = TAB_TITLES[tabName];

  document.querySelectorAll('[data-tab-target]').forEach((btn) => {
    const isActive = btn.dataset.tabTarget === tabName;
    btn.classList.toggle('nav-item--active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  document.querySelectorAll('.app-view').forEach((view) => {
    const isTarget = view.id === `view-${tabName}`;
    view.hidden = !isTarget;
    view.classList.toggle('app-view--active', isTarget);
  });

  const fabBtn = document.getElementById('btn-fab-add');
  if (fabBtn) {
    fabBtn.hidden = !(tabName === 'home' || tabName === 'tasks');
  }

  await renderActiveView();
  window.scrollTo(0, 0);
}

async function switchProfileSection(sectionName) {
  currentProfileSection = sectionName;

  document.querySelectorAll('[data-profile-tab]').forEach((btn) => {
    const isActive = btn.dataset.profileTab === sectionName;
    btn.classList.toggle('seg-btn--active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('.profile-panel').forEach((panel) => {
    panel.hidden = panel.id !== `profile-${sectionName}`;
  });

  await renderProfileSection();
}

async function renderProfileSection() {
  if (currentProfileSection === 'notes') await NoteModule.render();
  if (currentProfileSection === 'statistics') await StatisticsModule.render();
  if (currentProfileSection === 'settings') await SettingsModule.render();
}

async function renderActiveView() {
  if (currentTab === 'home') await DashboardModule.render();
  else if (currentTab === 'tasks') await TaskModule.render();
  else if (currentTab === 'calendar') await CalendarModule.render();
  else if (currentTab === 'habits') await HabitModule.render();
  else if (currentTab === 'profile') await renderProfileSection();
}

function bindGlobalEvents() {
  document.querySelectorAll('[data-tab-target]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tabTarget));
  });

  document.querySelectorAll('[data-profile-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchProfileSection(btn.dataset.profileTab));
  });

  document.querySelectorAll('[data-action="global-quick-add"]').forEach((btn) => {
    btn.addEventListener('click', () => TaskModule.openCreateModal());
  });

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => closeModal(el.dataset.closeModal));
  });

  // Nút áp dụng cập nhật phiên bản mới từ banner
  document.getElementById('btn-apply-update')?.addEventListener('click', () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  });

  document.getElementById('btn-dismiss-update')?.addEventListener('click', () => {
    const banner = document.getElementById('update-banner');
    if (banner) banner.hidden = true;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllModals();
    }
  });
}

/**
 * Xử lý phím tắt từ Manifest Shortcuts (?action=add hoặc ?tab=habits).
 */
async function handleInitialUrlShortcuts() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  const action = params.get('action');

  if (tab && TAB_TITLES[tab]) {
    await switchTab(tab);
  } else {
    await switchTab('home');
  }

  if (action === 'add') {
    await TaskModule.openCreateModal();
  }
}

async function bootstrap() {
  try {
    SettingsModule.applyTheme();
    updateNetworkStatus();

    window.addEventListener('online', () => {
      updateNetworkStatus();
      showToast('Đã kết nối lại Internet.', 'success');
    });
    window.addEventListener('offline', () => {
      updateNetworkStatus();
      showToast('Đang ở chế độ Offline. Dữ liệu vẫn lưu cục bộ an toàn.', 'default');
    });

    await registerServiceWorker();
    await db.openDB();
    await db.seedDefaultCategoriesIfEmpty();

    const sharedCallbacks = {
      onOpenCreateTask: (preset) => TaskModule.openCreateModal(preset),
      onEditTask: (taskId) => TaskModule.openEditModal(taskId),
      onToggleTask: (taskId) => TaskModule.toggleTaskCompletion(taskId),
      onNavigate: switchTab,
      onDataChanged: renderActiveView,
      onCheckUpdate: checkForAppUpdate
    };

    TaskModule.init(sharedCallbacks);
    DashboardModule.init(sharedCallbacks);
    CalendarModule.init(sharedCallbacks);
    HabitModule.init(sharedCallbacks);
    NoteModule.init(sharedCallbacks);
    StatisticsModule.init();
    SettingsModule.init(sharedCallbacks);

    bindGlobalEvents();
    await handleInitialUrlShortcuts();
  } catch (error) {
    console.error('Lỗi khởi động MyDay:', error);
    showToast(`Lỗi khởi tạo ứng dụng: ${error.message}`, 'error', 5000);
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
