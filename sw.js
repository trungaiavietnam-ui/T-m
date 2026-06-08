const CACHE_NAME = 'lich-van-trung-pwa-v14';

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

// ── FALLBACK ẢNH NỀN GRADIENT CSS (dùng khi offline và ảnh Unsplash chưa được cache) ──
const FALLBACK_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#1e3a5f"/>
      <stop offset="40%"  stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
    <radialGradient id="g2" cx="50%" cy="30%" r="80%">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g1)"/>
  <rect width="100%" height="100%" fill="url(#g2)"/>
</svg>`;

const FALLBACK_IMAGE_RESPONSE = new Response(FALLBACK_IMAGE_SVG, {
  headers: { 'Content-Type': 'image/svg+xml' }
});

// Tiện ích quản lý IndexedDB để theo dõi metadata lượt đồng bộ cuối cùng
function openMetaDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('LichVanTrungMetaDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('response_meta')) {
        db.createObjectStore('response_meta', { keyPath: 'url' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

function saveLastResponseMeta(url) {
  openMetaDB().then((db) => {
    const tx = db.transaction('response_meta', 'readwrite');
    const store = tx.objectStore('response_meta');
    store.put({ url: url, timestamp: Date.now() });
  }).catch(err => console.error('[SW] Lỗi lưu IDB Meta:', err));
}

// ── 1. SỰ KIỆN INSTALL ──
self.addEventListener('install', (event) => {
  console.log('[SW] Đang cài đặt phiên bản mới:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Đang nạp đệm trước các tài nguyên cốt lõi bắt buộc...');
        return Promise.all(
          ASSETS_TO_CACHE.map((url) => {
            return cache.add(url).catch((err) => {
              console.error(`[SW] Thất bại khi nạp đệm file bắt buộc: ${url}`, err);
              // Trả về resolve trống để không làm gián đoạn việc tải các file khác
              return Promise.resolve();
            });
          })
        );
      })
      .then(() => self.skipWaiting()) // Buộc SW mới kích hoạt ngay lập tức
  );
});

// ── 2. SỰ KIỆN ACTIVATE ──
self.addEventListener('activate', (event) => {
  console.log('[SW] Đã kích hoạt hoạt động cho:', CACHE_NAME);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Đang xóa bộ nhớ đệm cũ lỗi thời:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // Kiểm soát ngay lập tức toàn bộ client hiện tại
  );
});

// ── 3. SỰ KIỆN FETCH ──
self.addEventListener('fetch', (event) => {
  const requestUrl = event.request.url;

  // Bỏ qua các yêu cầu không dùng phương thức GET (như POST của Firebase Auth/Firestore) hoặc chrome-extension
  if (event.request.method !== 'GET' || !requestUrl.startsWith('http')) {
    return;
  }

  // Khách hàng không cần cache các truy vấn liên quan trực tiếp tới endpoint real-time của Firebase
  if (requestUrl.includes('googleapis.com/v1/projects') || requestUrl.includes('identitytoolkit')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. Có trong cache → trả về ngay
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. Không có → tải mạng, lưu đệm động
      return fetch(event.request).then((networkResponse) => {
        const status = networkResponse.status;

        if (status === 200 || status === 0) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          // Lưu metadata response cuối kèm timestamp
          saveLastResponseMeta(requestUrl);
        }
        return networkResponse;
      }).catch(() => {
        console.warn('[SW] Offline – chưa có cache cho:', requestUrl);

        // Fallback ảnh nền gradient khi Unsplash không tải được
        if (requestUrl.includes('unsplash.com') || requestUrl.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)) {
          return FALLBACK_IMAGE_RESPONSE.clone();
        }

        // Fallback JS nội bộ tránh crash trắng màn hình
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