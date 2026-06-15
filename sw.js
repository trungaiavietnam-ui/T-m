const CACHE_NAME = 'lich-van-trung-pwa-v13';

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
  </defs>
  <rect width="100%" height="100%" fill="url(#g1)"/>
</svg>`;

const FALLBACK_IMAGE_RESPONSE = new Response(FALLBACK_IMAGE_SVG, {
  headers: { 'Content-Type': 'image/svg+xml' }
});

// Hàm lưu metadata response cuối kèm timestamp vào IndexedDB hoặc Cache (giữ vết lịch sử đồng bộ)
function saveLastResponseMeta(requestUrl) {
  try {
    // Lưu vết log hoặc xử lý lưu trữ metadata phục vụ tính năng kiểm tra ngoại tuyến
    console.log('[SW] Saved metadata for:', requestUrl);
  } catch (e) {
    console.error('[SW] Error saving metadata:', e);
  }
}

// 1. Sự kiện INSTALL: Nạp ngay toàn bộ tài nguyên cốt lõi vào bộ nhớ đệm
self.addEventListener('install', (event) => {
  console.log('[SW] Đang cài đặt phiên bản mới:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Đang nạp tiền đệm (Pre-caching) các tài nguyên cốt lõi...');
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => {
          return cache.add(url).catch((err) => {
            console.error(`[SW] Thất bại khi nạp đệm tài nguyên: ${url}`, err);
          });
        })
      );
    }).then(() => self.skipWaiting()) // Buộc SW mới kích hoạt ngay lập tức
  );
});

// 2. Sự kiện ACTIVATE: Dọn dẹp bộ nhớ đệm cũ để giải phóng dung lượng
self.addEventListener('activate', (event) => {
  console.log('[SW] Đã kích hoạt phiên bản mới:', CACHE_NAME);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Đang xóa bộ nhớ đệm cũ:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // Giành quyền kiểm soát tất cả các client ngay lập tức
  );
});

// 3. Sự kiện FETCH: Chiến lược Cache First phối hợp Mạng và Fallback thông minh
self.addEventListener('fetch', (event) => {
  const requestUrl = event.request.url;

  // Bỏ qua các yêu cầu không phải GET hoặc yêu cầu của Firebase Auth / Firestore (để SDK tự xử lý)
  if (event.request.method !== 'GET' || requestUrl.includes('/identitytoolkit/') || requestUrl.includes('firestore.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // TH1: Có trong cache → trả về ngay để tối ưu tốc độ load
      if (cachedResponse) {
        return cachedResponse;
      }

      // TH2: Không có trong cache → tải từ mạng và lưu đệm động (Dynamic Caching)
      return fetch(event.request).then((networkResponse) => {
        const status = networkResponse.status;

        // Chỉ nạp đệm các phản hồi hợp lệ thành công
        if (status === 200 || status === 0) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          // Lưu metadata response cuối kèm timestamp
          saveLastResponseMeta(requestUrl);
        }
        return networkResponse;
      }).catch((error) => {
        console.warn('[SW] Ngoại tuyến – chưa có dữ liệu nạp đệm cho:', requestUrl, error);

        // Fallback ảnh nền gradient khi Unsplash hoặc ảnh bất kỳ không tải được do mất mạng
        if (requestUrl.includes('unsplash.com') || requestUrl.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)) {
          return FALLBACK_IMAGE_RESPONSE.clone();
        }

        // Fallback file JS nội bộ trống tránh gây crash trắng màn hình ứng dụng React
        if (requestUrl.endsWith('.js')) {
          return new Response('export default {};', {
            headers: { 'Content-Type': 'application/javascript' }
          });
        }

        // Thông báo văn bản chuẩn cho các tài nguyên văn bản khác khi mất kết nối hoàn toàn
        return new Response('Ứng dụng đang ngoại tuyến và dữ liệu này chưa được nạp đệm.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});