/**
 * database.js
 * Lớp quản lý cơ sở dữ liệu IndexedDB dùng chung cho toàn bộ ứng dụng MyDay.
 *
 * Cấu trúc 5 Object Stores:
 * 1. Tasks      - Công việc cá nhân
 * 2. Habits     - Danh sách thói quen
 * 3. HabitLogs  - Nhật ký thực hiện thói quen theo ngày
 * 4. Notes      - Ghi chú cá nhân
 * 5. Categories - Danh mục phân loại công việc
 */

import {
  generateUUID,
  getCurrentTimestamp,
  isNonEmptyString,
  isValidDateKey
} from './utils.js';

export const DB_NAME = 'MyDayDB';
export const DB_VERSION = 1;

export const STORES = Object.freeze({
  TASKS: 'Tasks',
  HABITS: 'Habits',
  HABIT_LOGS: 'HabitLogs',
  NOTES: 'Notes',
  CATEGORIES: 'Categories'
});

export const TASK_PRIORITIES = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
});

export const TASK_STATUSES = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  OVERDUE: 'overdue'
});

export const REPEAT_RULES = Object.freeze({
  NONE: 'none',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly'
});

/** Danh mục mặc định khởi tạo một lần duy nhất nếu bảng Categories đang trống */
const DEFAULT_CATEGORIES = [
  { name: 'Cá nhân', color: '#3B82F6' },
  { name: 'Công việc', color: '#111827' },
  { name: 'Học tập', color: '#10B981' },
  { name: 'Sức khỏe', color: '#F59E0B' }
];

let dbInstance = null;
let dbOpenPromise = null;

/**
 * Mở kết nối tới IndexedDB (Singleton).
 * Tự động tạo Object Stores và Indexes khi cài lần đầu hoặc nâng cấp phiên bản.
 * Nguyên tắc nâng cấp: Chỉ bổ sung cấu trúc mới theo oldVersion, KHÔNG xóa dữ liệu người dùng.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (dbOpenPromise) {
    return dbOpenPromise;
  }

  dbOpenPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Trình duyệt hiện tại không hỗ trợ IndexedDB.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      // Migration v0 -> v1: Khởi tạo toàn bộ 5 Object Store và Index
      if (oldVersion < 1) {
        // 1. Store: Tasks
        if (!db.objectStoreNames.contains(STORES.TASKS)) {
          const taskStore = db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
          taskStore.createIndex('status', 'status', { unique: false });
          taskStore.createIndex('priority', 'priority', { unique: false });
          taskStore.createIndex('startDate', 'startDate', { unique: false });
          taskStore.createIndex('dueDate', 'dueDate', { unique: false });
          taskStore.createIndex('categoryId', 'categoryId', { unique: false });
          taskStore.createIndex('createdAt', 'createdAt', { unique: false });
          taskStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 2. Store: Habits
        if (!db.objectStoreNames.contains(STORES.HABITS)) {
          const habitStore = db.createObjectStore(STORES.HABITS, { keyPath: 'id' });
          habitStore.createIndex('isActive', 'isActive', { unique: false });
          habitStore.createIndex('frequency', 'frequency', { unique: false });
          habitStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // 3. Store: HabitLogs
        if (!db.objectStoreNames.contains(STORES.HABIT_LOGS)) {
          const logStore = db.createObjectStore(STORES.HABIT_LOGS, { keyPath: 'id' });
          logStore.createIndex('habitId', 'habitId', { unique: false });
          logStore.createIndex('date', 'date', { unique: false });
          logStore.createIndex('completed', 'completed', { unique: false });
          // Compound unique index: Mỗi thói quen chỉ có tối đa 1 bản ghi cho mỗi ngày
          logStore.createIndex('habitId_date', ['habitId', 'date'], { unique: true });
        }

        // 4. Store: Notes
        if (!db.objectStoreNames.contains(STORES.NOTES)) {
          const noteStore = db.createObjectStore(STORES.NOTES, { keyPath: 'id' });
          noteStore.createIndex('isPinned', 'isPinned', { unique: false });
          noteStore.createIndex('createdAt', 'createdAt', { unique: false });
          noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 5. Store: Categories
        if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
          const categoryStore = db.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
          categoryStore.createIndex('name', 'name', { unique: true });
          categoryStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;

      // Xử lý an toàn nếu có tab khác yêu cầu nâng cấp phiên bản DB
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
        dbOpenPromise = null;
      };

      resolve(dbInstance);
    };

    request.onerror = (event) => {
      dbOpenPromise = null;
      reject(new Error(`Không thể mở IndexedDB: ${event.target.error?.message || 'Lỗi không xác định'}`));
    };

    request.onblocked = () => {
      reject(new Error('Kết nối IndexedDB đang bị chặn bởi một tab khác. Hãy đóng các tab MyDay khác và thử lại.'));
    };
  });

  return dbOpenPromise;
}

/**
 * Helper nội bộ: Thực thi thao tác trong 1 transaction và đợi transaction hoàn tất hoàn toàn.
 * @param {string|string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {(tx: IDBTransaction) => IDBRequest|void} operation
 * @returns {Promise<any>}
 */
async function runTransaction(storeNames, mode, operation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let resultValue;
    let lastRequestError = null;

    tx.oncomplete = () => resolve(resultValue);
    tx.onerror = () => reject(tx.error || lastRequestError || new Error('Lỗi thực thi transaction IndexedDB.'));
    tx.onabort = () => reject(tx.error || lastRequestError || new Error('Transaction IndexedDB đã bị hủy (abort).'));

    try {
      const request = operation(tx);
      if (request && typeof request === 'object' && 'onsuccess' in request) {
        request.onsuccess = (e) => {
          resultValue = e.target.result;
        };
        request.onerror = (e) => {
          // Lưu lại lỗi cụ thể cho Safari/WebKit (không gọi preventDefault để transaction tự rollback)
          lastRequestError = e.target.error;
        };
      }
    } catch (error) {
      lastRequestError = error;
      try {
        tx.abort();
      } catch {
        // Bỏ qua nếu transaction đã kết thúc trước đó
      }
      reject(error);
    }
  });
}

/* ============================================================================
 * CÁC HÀM CRUD CƠ BẢN (DÙNG CHUNG CHO MỌI OBJECT STORE)
 * ============================================================================ */

/**
 * Thêm mới một bản ghi (báo lỗi nếu trùng khóa chính id hoặc unique index).
 * @param {string} storeName
 * @param {object} record
 * @returns {Promise<object>}
 */
export async function addRecord(storeName, record) {
  await runTransaction(storeName, 'readwrite', (tx) => {
    return tx.objectStore(storeName).add(record);
  });
  return record;
}

/**
 * Thêm mới hoặc cập nhật bản ghi theo khóa chính id.
 * @param {string} storeName
 * @param {object} record
 * @returns {Promise<object>}
 */
export async function putRecord(storeName, record) {
  await runTransaction(storeName, 'readwrite', (tx) => {
    return tx.objectStore(storeName).put(record);
  });
  return record;
}

/**
 * Lấy một bản ghi theo id.
 * @param {string} storeName
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getRecord(storeName, id) {
  return runTransaction(storeName, 'readonly', (tx) => {
    return tx.objectStore(storeName).get(id);
  });
}

/**
 * Lấy toàn bộ bản ghi trong một Object Store.
 * @param {string} storeName
 * @returns {Promise<object[]>}
 */
export async function getAllRecords(storeName) {
  return runTransaction(storeName, 'readonly', (tx) => {
    return tx.objectStore(storeName).getAll();
  });
}

/**
 * Truy vấn các bản ghi theo một Index cụ thể.
 * @param {string} storeName
 * @param {string} indexName
 * @param {IDBValidKey|IDBKeyRange} query
 * @returns {Promise<object[]>}
 */
export async function getByIndex(storeName, indexName, query) {
  return runTransaction(storeName, 'readonly', (tx) => {
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    return index.getAll(query);
  });
}

/**
 * Lấy duy nhất 1 bản ghi theo Index (ví dụ: tìm HabitLog theo ['habitId', 'date']).
 * @param {string} storeName
 * @param {string} indexName
 * @param {IDBValidKey} query
 * @returns {Promise<object|undefined>}
 */
export async function getOneByIndex(storeName, indexName, query) {
  return runTransaction(storeName, 'readonly', (tx) => {
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    return index.get(query);
  });
}

/**
 * Xóa một bản ghi theo id.
 * @param {string} storeName
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteRecord(storeName, id) {
  await runTransaction(storeName, 'readwrite', (tx) => {
    return tx.objectStore(storeName).delete(id);
  });
}

/**
 * Đếm tổng số bản ghi trong một Object Store.
 * @param {string} storeName
 * @returns {Promise<number>}
 */
export async function countRecords(storeName) {
  return runTransaction(storeName, 'readonly', (tx) => {
    return tx.objectStore(storeName).count();
  });
}

/**
 * Xóa toàn bộ bản ghi trong một Object Store.
 * @param {string} storeName
 * @returns {Promise<void>}
 */
export async function clearStore(storeName) {
  await runTransaction(storeName, 'readwrite', (tx) => {
    return tx.objectStore(storeName).clear();
  });
}

/* ============================================================================
 * CHUẨN HÓA & KIỂM TRA DỮ LIỆU ĐẦU VÀO (SCHEMA FACTORIES)
 * ============================================================================ */

/**
 * Tạo đối tượng Task hợp lệ theo thiết kế database.
 * @param {object} input
 * @returns {object}
 */
export function buildTaskRecord(input) {
  if (!isNonEmptyString(input?.title)) {
    throw new Error('Tiêu đề công việc không được để trống.');
  }

  const validPriorities = Object.values(TASK_PRIORITIES);
  const validStatuses = Object.values(TASK_STATUSES);
  const validRepeats = Object.values(REPEAT_RULES);

  const priority = validPriorities.includes(input.priority)
    ? input.priority
    : TASK_PRIORITIES.MEDIUM;

  const status = validStatuses.includes(input.status)
    ? input.status
    : TASK_STATUSES.TODO;

  const repeatRule = validRepeats.includes(input.repeatRule)
    ? input.repeatRule
    : REPEAT_RULES.NONE;

  if (input.startDate && input.dueDate && new Date(input.dueDate) < new Date(input.startDate)) {
    throw new Error('Thời gian kết thúc không được nhỏ hơn thời gian bắt đầu.');
  }

  const now = getCurrentTimestamp();
  return {
    id: input.id || generateUUID(),
    title: input.title.trim(),
    description: typeof input.description === 'string' ? input.description.trim() : '',
    startDate: input.startDate || null,
    dueDate: input.dueDate || null,
    priority,
    status,
    categoryId: input.categoryId || null,
    repeatRule,
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

/**
 * Tạo đối tượng Habit hợp lệ theo thiết kế database.
 * @param {object} input
 * @returns {object}
 */
export function buildHabitRecord(input) {
  if (!isNonEmptyString(input?.name)) {
    throw new Error('Tên thói quen không được để trống.');
  }

  return {
    id: input.id || generateUUID(),
    name: input.name.trim(),
    description: typeof input.description === 'string' ? input.description.trim() : '',
    frequency: input.frequency || 'daily',
    createdAt: input.createdAt || getCurrentTimestamp(),
    isActive: typeof input.isActive === 'boolean' ? input.isActive : true
  };
}

/**
 * Tạo đối tượng HabitLog hợp lệ theo thiết kế database.
 * @param {object} input
 * @returns {object}
 */
export function buildHabitLogRecord(input) {
  if (!isNonEmptyString(input?.habitId)) {
    throw new Error('Thiếu mã thói quen (habitId).');
  }
  if (!isValidDateKey(input?.date)) {
    throw new Error('Ngày thực hiện thói quen phải có định dạng YYYY-MM-DD hợp lệ.');
  }

  return {
    id: input.id || generateUUID(),
    habitId: input.habitId,
    date: input.date,
    completed: Boolean(input.completed)
  };
}

/**
 * Tạo đối tượng Note hợp lệ theo thiết kế database.
 * @param {object} input
 * @returns {object}
 */
export function buildNoteRecord(input) {
  if (!isNonEmptyString(input?.title) && !isNonEmptyString(input?.content)) {
    throw new Error('Ghi chú cần có ít nhất tiêu đề hoặc nội dung.');
  }

  const now = getCurrentTimestamp();
  return {
    id: input.id || generateUUID(),
    title: typeof input.title === 'string' ? input.title.trim() : 'Không có tiêu đề',
    content: typeof input.content === 'string' ? input.content.trim() : '',
    isPinned: Boolean(input.isPinned),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

/**
 * Tạo đối tượng Category hợp lệ theo thiết kế database.
 * @param {object} input
 * @returns {object}
 */
export function buildCategoryRecord(input) {
  if (!isNonEmptyString(input?.name)) {
    throw new Error('Tên danh mục không được để trống.');
  }

  return {
    id: input.id || generateUUID(),
    name: input.name.trim(),
    color: typeof input.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(input.color)
      ? input.color
      : '#3B82F6',
    createdAt: input.createdAt || getCurrentTimestamp()
  };
}

/* ============================================================================
 * KHỞI TẠO HỆ THỐNG, SAO LƯU & KHÔI PHỤC TOÀN BỘ DATABASE
 * ============================================================================ */

/**
 * Khởi tạo danh mục mặc định nếu người dùng mở ứng dụng lần đầu (Categories trống).
 * Không tạo dữ liệu giả cho Tasks, Habits hay Notes.
 * @returns {Promise<boolean>} true nếu vừa tạo danh mục mặc định
 */
export async function seedDefaultCategoriesIfEmpty() {
  const existingCount = await countRecords(STORES.CATEGORIES);
  if (existingCount > 0) {
    return false;
  }

  await runTransaction(STORES.CATEGORIES, 'readwrite', (tx) => {
    const store = tx.objectStore(STORES.CATEGORIES);
    for (const cat of DEFAULT_CATEGORIES) {
      store.add(buildCategoryRecord(cat));
    }
  });
  return true;
}

/**
 * Xóa toàn bộ dữ liệu trong tất cả 5 Object Stores trong 1 transaction duy nhất.
 * (Dùng cho chức năng Reset dữ liệu ở Settings sau khi người dùng xác nhận).
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  const allStores = Object.values(STORES);
  await runTransaction(allStores, 'readwrite', (tx) => {
    for (const storeName of allStores) {
      tx.objectStore(storeName).clear();
    }
  });
}

/**
 * Xuất toàn bộ dữ liệu IndexedDB ra đối tượng JSON để sao lưu.
 * @returns {Promise<object>}
 */
export async function exportAllData() {
  const allStores = Object.values(STORES);
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(allStores, 'readonly');
    const data = {};

    tx.oncomplete = () => {
      resolve({
        app: 'MyDay',
        schemaVersion: DB_VERSION,
        exportedAt: getCurrentTimestamp(),
        data
      });
    };
    tx.onerror = () => reject(tx.error || new Error('Lỗi khi xuất dữ liệu sao lưu.'));

    for (const storeName of allStores) {
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = (e) => {
        data[storeName] = e.target.result;
      };
    }
  });
}

/**
 * Khôi phục toàn bộ dữ liệu từ file JSON sao lưu trong 1 transaction nguyên tử (atomic).
 * Nếu có bất kỳ bản ghi nào lỗi, transaction tự động rollback để không làm hỏng dữ liệu cũ.
 * @param {object} backupPayload
 * @returns {Promise<void>}
 */
export async function importAllData(backupPayload) {
  if (!backupPayload || backupPayload.app !== 'MyDay' || typeof backupPayload.data !== 'object') {
    throw new Error('File sao lưu không đúng định dạng của MyDay.');
  }

  const allStores = Object.values(STORES);
  for (const storeName of allStores) {
    if (!Array.isArray(backupPayload.data[storeName])) {
      throw new Error(`File sao lưu thiếu dữ liệu của bảng ${storeName}.`);
    }
  }

  await runTransaction(allStores, 'readwrite', (tx) => {
    for (const storeName of allStores) {
      const store = tx.objectStore(storeName);
      store.clear();
      for (const item of backupPayload.data[storeName]) {
        if (!item || !item.id) {
          throw new Error(`Bản ghi không hợp lệ trong bảng ${storeName} (thiếu id).`);
        }
        store.put(item);
      }
    }
  });
}

/**
 * Trả về thống kê tổng quan cấu trúc DB hiện tại (hữu ích cho kiểm thử Giai đoạn 2).
 * @returns {Promise<object>}
 */
export async function getDatabaseOverview() {
  const db = await openDB();
  const storesSummary = [];

  for (const storeName of Object.values(STORES)) {
    const count = await countRecords(storeName);
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    storesSummary.push({
      name: storeName,
      keyPath: store.keyPath,
      indexes: Array.from(store.indexNames),
      count
    });
  }

  return {
    dbName: db.name,
    version: db.version,
    stores: storesSummary
  };
}

/**
 * Xóa một thói quen cùng toàn bộ lịch sử HabitLogs liên quan trong 1 transaction nguyên tử.
 * @param {string} habitId
 * @returns {Promise<void>}
 */
export async function deleteHabitWithLogs(habitId) {
  const logs = await getByIndex(STORES.HABIT_LOGS, 'habitId', habitId);
  await runTransaction([STORES.HABITS, STORES.HABIT_LOGS], 'readwrite', (tx) => {
    const habitStore = tx.objectStore(STORES.HABITS);
    const logStore = tx.objectStore(STORES.HABIT_LOGS);
    habitStore.delete(habitId);
    for (const log of logs) {
      logStore.delete(log.id);
    }
  });
}
