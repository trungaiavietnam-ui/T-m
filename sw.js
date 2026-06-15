// Tên bộ nhớ đệm phục vụ cho chiến lược Offline của PWA
const CACHE_NAME = 'xuanlai-hub-cache-v2';
const urlsToCache = [
  '/',
  '/index.html',
  'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://unpkg.com/lucide@latest'
];

// Cài đặt và lưu cache các file tĩnh cốt lõi
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// Kích hoạt SW và dọn dẹp các cache cũ không cần thiết
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Chiến lược phản hồi tài nguyên mạng kết hợp Cache (Network First / Cache Fallback)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

// --- PHẦN 1: TÍCH HỢP BACKGROUND SYNC (ĐỒNG BỘ NGẦM) ---
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-xuanlai-data') {
    event.waitUntil(syncDataWithFirebase());
  }
});

// Hàm kết nối IndexedDB để rút dữ liệu pending đẩy lên Firebase
function syncDataWithFirebase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("XuanLaiHubDB", 2);
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction("sync_store", "readwrite");
      const store = tx.objectStore("sync_store");
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const records = getAllRequest.result;
        if (records.length === 0) return resolve();

        // Tiến hành duyệt qua các bản ghi ngoại tuyến để bắn lên Firebase API
        Promise.all(records.map(record => {
          return fetch('https://firestore.googleapis.com/v1/projects/YOUR_PROJECT_ID/databases/(default)/documents/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                text: { stringValue: record.data.text },
                date: { stringValue: record.data.date },
                completed: { booleanValue: record.data.completed }
              }
            })
          }).then(res => {
            if (res.ok) {
              // Gửi thành công thì xóa khỏi hàng đợi IndexedDB nội bộ
              const deleteTx = db.transaction("sync_store", "readwrite");
              deleteTx.objectStore("sync_store").delete(record.id);
            }
          });
        })).then(() => resolve()).catch(err => reject(err));
      };
    };
    request.onerror = () => reject(request.error);
  });
}

// --- PHẦN 2: TÍCH HỢP PUSH NOTIFICATION (THÔNG BÁO ĐẨY HỆ THỐNG) ---
// Định kỳ hệ thống hoặc trình duyệt kích hoạt kiểm tra dữ liệu ngầm để báo cáo
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'triggerNotificationCheck') {
    checkAndTriggerNotifications();
  }
});

// Tự động kiểm tra định kỳ thông báo dựa trên dữ liệu IndexedDB của ứng dụng
function checkAndTriggerNotifications() {
  const request = indexedDB.open("XuanLaiHubDB", 2);
  request.onsuccess = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains("notification_tasks")) return;
    
    const tx = db.transaction("notification_tasks", "readonly");
    const store = tx.objectStore("notification_tasks");
    const getRequest = store.get("current_data");

    getRequest.onsuccess = () => {
      const data = getRequest.result;
      if (!data) return;

      const todayStr = new Date().toISOString().split('T')[0]; // Định dạng YYYY-MM-DD
      const todayMd = todayStr.substring(5); // Định dạng MM-DD phục vụ sinh nhật

      // 1. Lọc kiểm tra Sinh nhật hôm nay
      data.birthdays.forEach(b => {
        if (b.date === todayMd) {
          showNotification(`🎂 Hôm nay có Sinh nhật!`, `Chúc mừng sinh nhật: ${b.name}. Hãy gửi lời chúc ngay!`);
        }
      });

      // 2. Lọc kiểm tra Việc cần làm hôm nay + Việc quá khứ chưa tích hoàn thành
      data.todos.forEach(t => {
        if (t.date === todayStr && !t.completed) {
          showNotification(`📝 Việc cần làm hôm nay`, `Nhiệm vụ: ${t.text} đang chờ bạn xử lý.`);
        } else if (t.date < todayStr && !t.completed) {
          showNotification(`⏳ Nhiệm vụ quá hạn chưa xong!`, `Nhắc nhở: Bạn có việc "${t.text}" từ ngày ${t.date} chưa tích hoàn thành.`);
        }
      });

      // 3. Lọc kiểm tra Sự kiện hôm nay + Sự kiện quá khứ chưa tích hoàn thành
      data.events.forEach(ev => {
        if (ev.date === todayStr && !ev.completed) {
          showNotification(`📌 Sự kiện diễn ra hôm nay`, `Sự kiện: ${ev.title} đang diễn ra.`);
        } else if (ev.date < todayStr && !ev.completed) {
          showNotification(`⚠️ Sự kiện quá khứ chưa hoàn tất!`, `Sự kiện: "${ev.title}" (${ev.date}) chưa hoàn thành tổng kết.`);
        }
      });
    };
  };
}

// Hàm đẩy thông báo nổi lên màn hình thiết bị người dùng
function showNotification(title, body) {
  const options = {
    body: body,
    icon: '/icon-192x192.png', // Đường dẫn Icon mặc định của PWA
    badge: '/badge.png',
    vibrate: [200, 100, 200],
    data: { dateOfArrival: Date.now() }
  };
  
  self.registration.showNotification(title, options);
}

// Tạo trình lắng nghe chu kỳ chạy định kỳ ngầm khi có kết nối hệ thống mạng trở lại
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-reminder') {
    event.waitUntil(checkAndTriggerNotifications());
  }
});
