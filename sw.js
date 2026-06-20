const CACHE_NAME = 'lich-van-trung-pwa-v14'; // Nâng cấp lên v14 để ép trình duyệt làm mới bộ nhớ đệm và cập nhật tính năng tìm kiếm toàn cục

// Danh sách các tài nguyên tĩnh nội bộ bắt buộc phải nạp đệm thành công để chạy Offline hoàn toàn
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './libs/tailwind.js',
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
    messagingSenderId: "527946894050",
    appId: "1:527946894050:web:4f0bf75fb626d70fb3dfa2"
};

if (!firebase.apps.length) {
    firebase.initializeApp(MANUAL_CONFIG);
}
const db = firebase.firestore();

// SỰ KIỆN CÀI ĐẶT: Nạp tất cả tài nguyên cốt lõi vào bộ nhớ đệm ẩn
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Đang nạp đệm toàn bộ tài nguyên cốt lõi...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      // Ép Service Worker đang chờ trở thành hoạt động ngay lập tức
      return self.skipWaiting();
    })
  );
});

// SỰ KIỆN KÍCH HOẠT: Xóa bỏ các bộ đệm phiên bản cũ để giải phóng không gian dung lượng
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Đang xóa bộ đệm cũ:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// SỰ KIỆN FETCH: Chiến lược tối ưu chạy mạng kết hợp Offline hoàn toàn
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (event.request.method === 'GET' && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        return new Response('Kết nối mạng không khả dụng và tài nguyên chưa được lưu đệm.', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    })
  );
});

// SỰ KIỆN BACKGROUND SYNC: Đồng bộ dữ liệu ngầm tự động từ IndexedDB lên Firestore đám mây khi có mạng trở lại
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-cloud-data') {
        event.waitUntil(processSyncQueue());
    }
});

// XỬ LÝ HÀNG ĐỢI ĐỒNG BỘ: Đọc dữ liệu từ IndexedDB và đẩy lên Firestore
async function processSyncQueue() {
    try {
        const idb = await new Promise((resolve, reject) => {
            const request = indexedDB.open('LichVanTrungOfflineDB', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        const tx = idb.transaction('sync_queue', 'readonly');
        const store = tx.objectStore('sync_queue');
        const records = await new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
        });

        if (!records || records.length === 0) return;

        console.log(`[Sync] Phát hiện ${records.length} thao tác cần đồng bộ lên máy chủ đám mây...`);

        for (const record of records) {
            const { id, collection, action, payload } = record;
            try {
                const targetRef = db.collection(collection);

                if (action === 'add') {
                    const firestoreAdd = { ...payload };
                    if (firestoreAdd.deadlineTime) {
                        firestoreAdd.deadlineTime = firebase.firestore.Timestamp.fromMillis(firestoreAdd.deadlineTime.seconds * 1000);
                    }
                    if (firestoreAdd.date) {
                        firestoreAdd.date = firebase.firestore.Timestamp.fromMillis(firestoreAdd.date.seconds * 1000);
                    }
                    await targetRef.doc(payload.id).set(firestoreAdd);
                } else if (action === 'update') {
                    const docToUpdate = targetRef.doc(payload.id);
                    const firestoreUpdate = { ...payload };
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
