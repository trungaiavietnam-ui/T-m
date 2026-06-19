const CACHE_NAME = 'lich-van-trung-pwa-v11'; // Phiên bản v11 dọn dẹp các cache lỗi thời và kích hoạt tính năng thông báo ngầm mới

// Danh sách các tài nguyên tĩnh nội bộ bắt buộc phải nạp đệm thành công để chạy Offline hoàn toàn
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './libs/tailwind.js',
  './libs/babel.min.js',
  './libs/react-toastify.min.css',
  './libs/react.production.min.js',
  './libs/react-dom.production.min.js',
  './libs/lucide.min.js',
  './libs/firebase-app.js',
  './libs/firebase-auth.js',
  './libs/firebase-firestore.js',
  './libs/react-toastify.js'
];

// Nhập trực tiếp các module Firebase cần thiết cho Background Sync trong SW
importScripts('./libs/firebase-app.js');
importScripts('./libs/firebase-firestore.js');

// Khởi chạy ứng dụng Firebase ngầm trong Service Worker để xử lý đồng bộ
const MANUAL_CONFIG = {
    apiKey: "AIzaSyBEgbs4brFEVbBhf7KaEhw8FekAJTUBFZ0",
    authDomain: "lich-van-trung.firebaseapp.com",
    projectId: "lich-van-trung",
    storageBucket: "lich-van-trung.firebasestorage.app",
    messagingSenderId: "527946274728",
    appId: "1:527946274728:web:d74503548b1b799c0caf9d"
};

// Khởi tạo thực thể Firebase
firebase.initializeApp(MANUAL_CONFIG);
const db = firebase.firestore();

// ── FALLBACK ẢNH NỀN GRADIENT CSS (dùng khi offline và ảnh Unsplash chưa được cache) ──
const FALLBACK_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#1e3a5f"/>
      <stop offset="40%"  stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
    <radialGradient id="g2" cx="50%" cy="30%" r="80%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.15)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g1)"/>
  <rect width="100%" height="100%" fill="url(#g2)"/>
  <circle cx="400" cy="200" r="80" fill="rgba(255,255,255,0.03)" filter="blur(10px)"/>
</svg>`;

const FALLBACK_IMAGE_RESPONSE = new Response(FALLBACK_IMAGE_SVG, {
  headers: { 'Content-Type': 'image/svg+xml' }
});

// Hàm hỗ trợ mở IndexedDB trong Service Worker (Hỗ trợ cấu trúc DB nâng cấp phiên bản 2)
const openIndexedDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('lich_van_trung_db', 2);
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('sync_queue')) {
                database.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
            }
            if (!database.objectStoreNames.contains('notification_tasks')) {
                database.createObjectStore('notification_tasks', { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
};

// Cài đặt Service Worker và lưu trữ tài nguyên tĩnh vào Cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Đang nạp đệm dữ liệu tĩnh vào cache');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Kích hoạt Service Worker và dọn dẹp các cache cũ không cần thiết
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Đang dọn dẹp cache cũ:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      // Đóng gói tiến trình kiểm tra thông báo đẩy ngay khi Service Worker kích hoạt thành công
      return Promise.all([
        self.clients.claim(),
        checkAndShowNotifications()
      ]);
    })
  );
});

// Hàm lưu metadata response cuối kèm timestamp
const saveLastResponseMeta = (url) => {
  const meta = {
    url: url,
    timestamp: Date.now()
  };
  caches.open(CACHE_NAME).then((cache) => {
    cache.put('/__last_response_meta__', new Response(JSON.stringify(meta), {
      headers: { 'Content-Type': 'application/json' }
    }));
  });
};

// Xử lý nạp dữ liệu và phản hồi cache
self.addEventListener('fetch', (event) => {
  const requestUrl = event.request.url;

  if (requestUrl.includes('/__last_response_meta__')) {
    event.respondWith(
      caches.match('/__last_response_meta__').then((res) => {
        return res || new Response(JSON.stringify({ timestamp: null }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  if (!requestUrl.startsWith('http')) return;

  // Với mỗi lượt tải trang mới (navigate), đánh thức hệ thống thông báo đẩy chạy ngầm
  if (event.request.mode === 'navigate') {
      event.waitUntil(checkAndShowNotifications());
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        const status = networkResponse.status;

        if (status === 200 || status === 0) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          saveLastResponseMeta(requestUrl);
        }
        return networkResponse;
      }).catch(() => {
        console.warn('[SW] Offline – chưa có cache cho:', requestUrl);

        if (requestUrl.includes('unsplash.com') || requestUrl.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)) {
          return FALLBACK_IMAGE_RESPONSE.clone();
        }

        if (requestUrl.endsWith('.js')) {
          return new Response('export default {};', {
            headers: { 'Content-Type': 'application/javascript' }
          });
        }

        return new Response('Ứng dụng đang ngoại tuyến và dữ liệu này chưa được nạp đệm.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});

// ── TÍCH HỢP ĐỒNG BỘ HÓA NỀN (BACKGROUND SYNC) ──
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-data') {
        event.waitUntil(Promise.all([
            syncPendingData(),
            checkAndShowNotifications()
        ]));
    }
});

// Lắng nghe tín hiệu postMessage từ ứng dụng chính để bắn thông báo lập tức
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'check-notifications') {
        event.waitUntil(checkAndShowNotifications());
    }
});

// ── TIẾN TRÌNH THÔNG BÁO ĐẨY HỆ THỐNG CHẠY NGẦM HOÀN TOÀN ──
async function checkAndShowNotifications() {
    try {
        // Chỉ thực hiện khi người dùng đã cấp quyền thông báo
        if (Notification.permission !== 'granted') return;

        const idb = await openIndexedDB();
        
        // Khởi tạo Transaction đọc ghi
        const transaction = idb.transaction('notification_tasks', 'readwrite');
        const store = transaction.objectStore('notification_tasks');

        const tasks = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!tasks || tasks.length === 0) return;

        console.log(`[SW] Đang kiểm tra thông báo đẩy hệ thống cho ${tasks.length} tác vụ nhắc nhở...`);

        for (const task of tasks) {
            // Chỉ hiển thị đối với những tác vụ chưa được bắn cảnh báo
            if (!task.notified) {
                const title = `🔔 ${task.type === 'Sự kiện' ? 'Sự kiện' : 'Công việc'}: ${task.title}`;
                const options = {
                    body: `Thời gian nhắc: ${task.time || 'Cả ngày'}`,
                    icon: './favicon.ico',
                    badge: './favicon.ico',
                    tag: `task-notification-${task.id}`,
                    requireInteraction: true,
                    data: { id: task.id }
                };

                // Bắn thông báo đẩy hệ thống trực tiếp nổi lên màn hình
                await self.registration.showNotification(title, options);
                
                // Đánh dấu tác vụ đã gửi thông báo thành công vào bộ nhớ IndexedDB
                task.notified = true;
                store.put(task);
            }
        }
    } catch (e) {
        console.error('[SW] Lỗi quy trình kiểm tra thông báo đẩy chạy ngầm:', e);
    }
}

// ── HÀM CHẠY ĐỒNG BỘ ĐÁM MÂY KHI CÓ MẠNG ──
async function syncPendingData() {
    try {
        const idb = await openIndexedDB();
        const transaction = idb.transaction('sync_queue', 'readonly');
        const store = transaction.objectStore('sync_queue');
        
        const records = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (records.length === 0) return;

        console.log(`[Sync] Đang chạy đồng bộ ngầm ${records.length} yêu cầu dữ liệu lên Firebase...`);

        for (const record of records) {
            try {
                const { action, collectionName, payload, userId, id } = record;
                
                let targetRef;
                if (collectionName.startsWith('timetable/')) {
                    const docId = collectionName.split('/')[1];
                    targetRef = db.collection('artifacts').doc(MANUAL_CONFIG.projectId).collection('users').doc(userId).collection('timetable').doc(docId);
                } else {
                    targetRef = db.collection('artifacts').doc(MANUAL_CONFIG.projectId).collection('users').doc(userId).collection(collectionName);
                }

                if (action === 'add') {
                    const firestoreData = { ...payload };
                    if (firestoreData.createdAt) {
                        firestoreData.createdAt = firebase.firestore.Timestamp.fromMillis(Date.now());
                    }
                    if (firestoreData.reminderTime) {
                        firestoreData.reminderTime = firebase.firestore.Timestamp.fromMillis(firestoreData.reminderTime.seconds * 1000);
                    }
                    if (firestoreData.deadlineTime) {
                        firestoreData.deadlineTime = firebase.firestore.Timestamp.fromMillis(firestoreData.deadlineTime.seconds * 1000);
                    }
                    if (firestoreData.date) {
                        firestoreData.date = firebase.firestore.Timestamp.fromMillis(firestoreData.date.seconds * 1000);
                    }
                    await targetRef.add(firestoreData);
                } else if (action === 'update') {
                    const { id: docId, ...updateData } = payload;
                    const docToUpdate = targetRef.doc(docId);
                    
                    const firestoreUpdate = { ...updateData };
                    if (firestoreUpdate.updatedAt) {
                        firestoreUpdate.updatedAt = firebase.firestore.Timestamp.fromMillis(Date.now());
                    }
                    if (firestoreUpdate.reminderTime) {
                        firestoreUpdate.reminderTime = firebase.firestore.Timestamp.fromMillis(firestoreUpdate.reminderTime.seconds * 1000);
                    }
                    if (firestoreUpdate.deadlineTime) {
                        firestoreUpdate.deadlineTime = firebase.firestore.Timestamp.fromMillis(firestoreUpdate.deadlineTime.seconds * 1000);
                    }
                    if (firestoreUpdate.date) {
                        firestoreUpdate.date = firebase.firestore.Timestamp.fromMillis(firestoreUpdate.date.seconds * 1000);
                    }
                    await docToUpdate.update(firestoreUpdate);
                } else if (action === 'delete') {
                    const docToDelete = targetRef.doc(payload.id);
                    await docToDelete.delete();
                } else if (action === 'set') {
                    const firestoreSet = { ...payload };
                    await targetRef.set(firestoreSet, { merge: true });
                }

                const deleteTransaction = idb.transaction('sync_queue', 'readwrite');
                const deleteStore = deleteTransaction.objectStore('sync_queue');
                await new Promise((resolve, reject) => {
                    const req = deleteStore.delete(id);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
                console.log(`[Sync] Đã đồng bộ & xóa bản ghi IndexedDB ID: ${id}`);
            } catch (err) {
                console.error('[Sync] Lỗi đồng bộ hóa bản ghi:', record, err);
            }
        }
    } catch (e) {
        console.error('[Sync] Lỗi tiến trình đồng bộ ngầm:', e);
    }
}