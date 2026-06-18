const CACHE_NAME = 'lich-van-trung-pwa-v7'; // Nâng lên v7 để xóa hoàn toàn tệp tin lỗi cũ ra khỏi bộ nhớ trình duyệt

// Danh sách tệp cần tải lưu trữ phục vụ việc chạy ngoại tuyến độc lập
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/react-toastify@9.1.3/dist/ReactToastify.min.css',
  
  // Toàn bộ hệ sinh thái lõi bản phân phối tĩnh UMD
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://unpkg.com/lucide@0.294.0/dist/umd/lucide.min.js',
  'https://unpkg.com/lucide-react@0.294.0/dist/umd/lucide-react.min.js',
  'https://unpkg.com/react-toastify@9.1.3/dist/react-toastify.umd.js',
  
  // Bộ thư viện tương thích Firebase đám mây
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js'
];

// Khởi tạo tiến trình cài đặt Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Tiến trình kích hoạt và làm sạch bộ nhớ đệm phiên bản cũ độc hại
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Đang xóa bộ nhớ đệm kẹt cũ:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Cơ chế phản hồi và định tuyến truy vấn khi chạy Offline
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
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
