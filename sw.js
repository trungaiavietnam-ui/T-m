// Tên kho bộ nhớ đệm mới - Thay đổi phiên bản để ép toàn bộ thiết bị cập nhật
const CACHE_NAME = 'lich-van-trung-pwa-v4';

// Danh sách tài nguyên cốt lõi bắt buộc nạp để chạy Offline-First ổn định
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/react-toastify@9.1.3/dist/ReactToastify.min.css',
  'https://esm.sh/react@18.2.0/jsx-runtime',
  'https://esm.sh/react@18.2.0',
  'https://esm.sh/react-dom@18.2.0/client',
  'https://esm.sh/lucide-react@0.294.0',
  'https://esm.sh/react-toastify@9.1.3?external=react,react-dom',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'
];

// 1. Cài đặt Service Worker và lưu trữ các thư viện CDN
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Đang tải trước tài nguyên hệ thống...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// 2. Kích hoạt và dọn dẹp sạch sẽ toàn bộ Cache cũ gây lỗi trắng trang
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Đang dọn kho dữ liệu cũ xung đột:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Cơ chế Đánh chặn thông minh: Network-First (Ưu tiên mạng, lỗi mới dùng cache)
// Tránh lỗi trắng trang do Babel Standalone không tải được mã nguồn
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Nếu lấy dữ liệu trực tuyến thành công, cập nhật ngay vào kho lưu trữ
        if (event.request.method === 'GET' && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Khi mất mạng hoàn toàn, tìm kiếm trong kho đệm Offline
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          
          // Nếu là điều hướng trang chính, nạp lại index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          
          return new Response('Hệ thống đang chạy Offline. Tài nguyên mạng chưa được đồng bộ.', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});
