const CACHE_NAME = 'lich-van-trung-pwa-v15'; // Nâng lên v15 để làm mới trình duyệt hoàn toàn

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

importScripts('./libs/firebase-app.js');
importScripts('./libs/firebase-firestore.js');

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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Đang nạp đệm toàn bộ tài nguyên cốt lõi...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

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

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-cloud-data') {
        event.waitUntil(processSyncQueue());
    }
});

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

        console.log(`[Sync] Phát hiện ${records.length} thao tác cần đồng bộ...`);

        for (const record of records) {
            const { id, collection, action, payload } = record;
            try {
                const targetRef = db.collection(collection);

                if (action === 'add') {
                    // Đẩy chuỗi dữ liệu gốc lên Firestore một cách an toàn mà không ép kiểu Timestamp lỗi
                    await targetRef.doc(payload.id).set(payload);
                } else if (action === 'update') {
                    await targetRef.doc(payload.id).update(payload);
                } else if (action === 'delete') {
                    await targetRef.doc(payload.id).delete();
                }

                const deleteTransaction = idb.transaction('sync_queue', 'readwrite');
                const deleteStore = deleteTransaction.objectStore('sync_queue');
                await new Promise((resolve, reject) => {
                    const req = deleteStore.delete(id);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
                console.log(`[Sync] Đã đồng bộ thành công ID: ${id}`);
            } catch (err) {
                console.error('[Sync] Lỗi tại bản ghi:', record, err);
            }
        }
    } catch (e) {
        console.error('[Sync] Lỗi tiến trình đồng bộ:', e);
    }
}
