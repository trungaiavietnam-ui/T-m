// Cập nhật toàn vẹn file sw.js (Nâng cấp phiên bản v14 kích hoạt tải lại ngay)
const CACHE_NAME = 'lich-van-trung-pwa-v14'; // Nâng cấp lên v14 nhằm ép trình duyệt xóa bộ đệm cũ và giải phóng các tính năng mới nạp đệm

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
    messagingSenderId: "527946288674",
    appId: "1:527946288674:web:86bfb1bbf86e08f237efb9"
};

if (!firebase.apps.length) {
    firebase.initializeApp(MANUAL_CONFIG);
}
const db = firebase.firestore();

// 1. SỰ KIỆN KHỞI TẠO (INSTALL) - TẢI TRƯỚC TÀI NGUYÊN TĨNH VÀO CACHE
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Đang thực hiện lưu đệm bắt buộc các tài nguyên cốt lõi...');
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => {
            // Ép buộc Service Worker mới được kích hoạt ngay lập tức mà không chờ đợi
            return self.skipWaiting();
        })
    );
});

// 2. SỰ KIỆN KÍCH HOẠT (ACTIVATE) - XÓA BỎ BỘ ĐỆM CACHE CŨ LỖI THỜI
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[Service Worker] Đang dọn dẹp bộ đệm phiên bản cũ:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => {
            // Cho phép SW ngay lập tức kiểm soát toàn bộ tất cả các tab đang mở của ứng dụng
            return self.clients.claim();
        })
    );
});

// 3. SỰ KIỆN LẤY DỮ LIỆU (FETCH) - CHIẾN LƯỢC CACHE FIRST CHO OFFLINE
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
                return new Response('Kết nối mạng không khả dụng và tài nguyên chưa được lưu đệm offline.', {
                    status: 503,
                    statusText: 'Service Unavailable'
                });
            });
        })
    );
});

// 4. SỰ KIỆN ĐỒNG BỘ NỀN (BACKGROUND SYNC) KHI CÓ MẠNG TRỞ LẠI
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-pwa-data') {
        console.log('[Sync] Thiết bị đã kết nối mạng trở lại! Đang bắt đầu tiến trình đồng bộ ngầm...');
        event.waitUntil(processIndexedDBSyncQueue());
    }
});

// Tiến hành đọc dữ liệu lưu tạm trong IndexedDB Sync Queue và đẩy dần lên Cloud Firestore
async function processIndexedDBSyncQueue() {
    try {
        const idb = await new Promise((resolve, reject) => {
            const req = indexedDB.open('lich_van_trung_sync', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        const tx = idb.transaction('sync_queue', 'readonly');
        const store = tx.objectStore('sync_queue');
        const records = await new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
        });

        if (!records || records.length === 0) return;

        for (const record of records) {
            const { id, action, collection, payload } = record;
            try {
                const targetRef = db.collection('users_sync_fallback').doc(collection);
                if (action === 'add') {
                    await targetRef.collection('items').add(payload);
                } else if (action === 'update') {
                    const docToUpdate = targetRef.collection('items').doc(payload.id);
                    const firestoreUpdate = { ...payload };
                    delete firestoreUpdate.id;
                    if (firestoreUpdate.deadlineTime) {
                        firestoreUpdate.deadlineTime = firebase.firestore.Timestamp.fromMillis(firestoreUpdate.deadlineTime.seconds * 1000);
                    }
                    if (firestoreUpdate.date) {
                        firestoreUpdate.date = firebase.firestore.Timestamp.fromMillis(firestoreUpdate.date.seconds * 1000);
                    }
                    await docToUpdate.update(firestoreUpdate);
                } else if (action === 'delete') {
                    const docToDelete = targetRef.collection('items').doc(payload.id);
                    await docToDelete.delete();
                } else if (action === 'set') {
                    await targetRef.set(payload, { merge: true });
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
