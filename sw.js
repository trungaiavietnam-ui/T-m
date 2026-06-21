// Tên kho lưu trữ bộ nhớ đệm (Cache Name) - Cập nhật phiên bản khi thay đổi mã nguồn
const CACHE_NAME = 'xuanlai-hub-cache-v2';

// Danh sách các tài nguyên tĩnh cần được lưu đệm ngay khi cài đặt PWA
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/lucide@latest',
  'https://esm.sh/react@18.2.0',
  'https://esm.sh/lucide-react@0.263.0'
];

// 1. Sự kiện Cài đặt (Install) - Tự động tải trước và lưu các tài nguyên cốt lõi vào Cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Đang nạp tài nguyên tĩnh vào bộ nhớ đệm...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting()) // Buộc Service Worker mới kích hoạt ngay lập tức
  );
});

// 2. Sự kiện Kích hoạt (Activate) - Dọn dẹp kho bộ nhớ đệm cũ để tránh xung đột dữ liệu
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Đang xóa bộ nhớ đệm cũ:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // Giành quyền kiểm soát tất cả các client ngay lập tức
  );
});

// 3. Sự kiện Đánh chặn yêu cầu mạng (Fetch) - Chiến lược mạng: Network First, Fallback to Cache
// Ưu tiên lấy dữ liệu mới nhất từ Internet, nếu mất mạng sẽ lấy từ Cache (Phù hợp cho đồng bộ Firebase Offline)
self.addEventListener('fetch', (event) => {
  // Chỉ xử lý các yêu cầu HTTP/HTTPS thông thường (Bỏ qua chrome-extension, v.v...)
  if (!event.request.url.startsWith(self.location.origin) && !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Nếu phản hồi hợp lệ, sao chép một bản lưu vào cache để dùng khi ngoại tuyến
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Khi không có mạng kết nối, tìm kiếm tài nguyên trong kho Cache
        console.log('[Service Worker] Mất kết nối. Đang tải tài nguyên từ bộ nhớ đệm Offline...');
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fallback dự phòng nếu tìm không thấy trang nào trong cache khi offline
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// 4. Sự kiện Đồng bộ hóa ngầm (Background Sync) - Phục vụ hàng đợi dữ liệu sync_queue của Thầy
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-firebase-data') {
    console.log('[Service Worker] Đang thực hiện đồng bộ hóa dữ liệu ngầm khi có mạng mạng lại...');
    // Gọi hàm xử lý đẩy dữ liệu từ IndexedDB / LocalStorage lên hệ thống quản lý tại đây
    // event.waitUntil(doDataSynchronization());
  }
});
