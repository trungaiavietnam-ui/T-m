const CACHE_NAME = 'lich-van-trung-pwa-v14'; // Nâng cấp lên v14 nhằm giải phóng cache cũ và kích hoạt giao diện Tìm Kiếm Mới

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
    messagingSenderId: "527946115867",
    appId: "1:527946115867:web:7f6d2f9bf8a8ccad22ae0a"
};

if (!firebase.apps.length) {
    firebase.initializeApp(MANUAL_CONFIG);
}
const db = firebase.firestore();

// 1. Sự kiện cài đặt Service Worker (Install Event)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// 2. Sự kiện kích hoạt Service Worker (Activate Event) - Giải phóng tài nguyên cũ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Đang xóa bỏ bộ nhớ đệm lỗi thời hoặc phiên bản cũ:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 3. Sự kiện kiểm soát tải tài nguyên mạng (Fetch Event) để chạy Offline
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
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      });
    })
  );
});

// 4. Sự kiện đồng bộ hóa ngầm trong nền (Background Sync Event)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-cloud-data') {
        event.waitUntil(syncOfflineDataWithCloud());
    }
});

// Mở cơ sở dữ liệu IndexedDB tương thích
function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('lich_van_trung_db', 2);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

// Logic xử lý tiến trình đồng bộ ngầm dữ liệu từ IndexedDB lên Firestore đám mây công cộng
async function syncOfflineDataWithCloud() {
    try {
        const idb = await openIndexedDB();
        const readTransaction = idb.transaction('sync_queue', 'readonly');
        const store = readTransaction.objectStore('sync_queue');
        
        const records = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!records || records.length === 0) return;

        console.log(`[Sync] Tìm thấy ${records.length} tác vụ ngoại tuyến cần đồng bộ.`);

        for (const record of records) {
            const { id, action, collection, payload } = record;
            
            try {
                let targetRef;
                const userUid = payload.uid || 'anon';

                if (collection === 'timetable') {
                    targetRef = db.collection('users').doc(userUid).collection('timetable');
                } else {
                    targetRef = db.collection('users').doc(userUid).collection(collection);
                }

                if (action === 'add') {
                    const firestorePayload = { ...payload };
                    delete firestorePayload.id;
                    delete firestorePayload.uid; 

                    if (firestorePayload.deadlineTime) {
                        firestorePayload.deadlineTime = firebase.firestore.Timestamp.fromMillis(firestorePayload.deadlineTime.seconds * 1000);
                    }
                    if (firestorePayload.date) {
                        firestorePayload.date = firebase.firestore.Timestamp.fromMillis(firestorePayload.date.seconds * 1000);
                    }
                    await targetRef.doc(payload.id).set(firestorePayload);
                } else if (action === 'update') {
                    const firestoreUpdate = { ...payload };
                    delete firestoreUpdate.id;
                    delete firestoreUpdate.uid;

                    if (firestoreUpdate.deadlineTime) {
                        firestoreUpdate.deadlineTime = firebase.firestore.Timestamp.fromMillis(firestoreUpdate.deadlineTime.seconds * 1000);
                    }
                    if (firestoreUpdate.date) {
                        firestoreUpdate.date = firebase.firestore.Timestamp.fromMillis(firestoreUpdate.date.seconds * 1000);
                    }
                    await targetRef.doc(payload.id).update(firestoreUpdate);
                } else if (action === 'delete') {
                    await targetRef.doc(payload.id).delete();
                } else if (action === 'set') {
                    const firestoreSet = { ...payload };
                    delete firestoreSet.uid;
                    await targetRef.doc('weekly').set(firestoreSet, { merge: true });
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
