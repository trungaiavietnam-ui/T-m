const CACHE_NAME = 'lich-van-trung-pwa-v5'; // Tăng lên v5 để đổi vùng nhớ đệm hoàn toàn

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.jsdelivr.net/npm/react-toastify@9.1.3/dist/ReactToastify.min.css',
  
  'https://cdn.skypack.dev/react@18.2.0',
  'https://cdn.skypack.dev/react-dom@18.2.0/client',
  'https://cdn.skypack.dev/lucide-react@0.294.0',
  'https://cdn.skypack.dev/react-toastify@9.1.3',
  
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Đang tải trước toàn bộ tài nguyên cốt lõi (React & Firebase)...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      // Ép Service Worker mới kích hoạt ngay lập tức mà không cần chờ đợi các tab cũ đóng lại
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
            console.log('[Service Worker] Đang xóa bộ nhớ đệm cũ để giải phóng dung lượng:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      // Giúp Service Worker lập tức kiểm soát toàn bộ các tab đang mở
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Chỉ kiểm soát các tài nguyên tải qua giao thức HTTP/HTTPS ngoại vi
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. Nếu tài nguyên đã tồn tại trong Cache, trả về ngay lập tức để chạy Offline
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. Nếu chưa có trong Cache, tiến hành tải từ mạng Internet
      return fetch(event.request).then((networkResponse) => {
        // Chỉ lưu đệm các phản hồi thành công và tải qua phương thức GET
        if (event.request.method === 'GET' && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Trả về phản hồi thân thiện nếu người dùng đang ngoại tuyến hoàn toàn và tài nguyên chưa được lưu đệm
        return new Response('Kết nối mạng không khả dụng và tài nguyên chưa được lưu ngoại tuyến.', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    })
  );
});
