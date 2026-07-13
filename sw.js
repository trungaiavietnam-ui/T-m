// ============================================================================
// Service Worker - Lịch đa năng (Văn Trung)
// ----------------------------------------------------------------------------
// Chiến lược cache:
//  - Trang HTML (điều hướng): "network-first" — luôn ưu tiên lấy bản mới nhất
//    khi có mạng, chỉ dùng bản cache khi mất mạng (đảm bảo người dùng luôn thấy
//    bản cập nhật mới nhất khi online, nhưng vẫn mở được app khi offline).
//  - Tài nguyên tĩnh cùng gốc (JS/CSS/ảnh...): "cache-first" — vì file build ra
//    có tên kèm hash, nội dung không đổi nên ưu tiên lấy từ cache cho nhanh.
//  - KHÔNG can thiệp/cache các request tới Firebase, Firestore, Google APIs:
//    Firestore SDK đã tự quản lý cache/offline riêng qua IndexedDB
//    (enableIndexedDbPersistence), nếu Service Worker cache chồng lên sẽ dễ gây
//    xung đột dữ liệu hoặc trả về dữ liệu cũ một cách âm thầm. Các request này
//    được để mặc định đi thẳng ra mạng (không gọi event.respondWith).
// ============================================================================

const CACHE_VERSION = 'v1';
const CACHE_NAME = `lich-van-trung-${CACHE_VERSION}`;

// Các domain KHÔNG bao giờ được cache qua Service Worker (Firebase/Google APIs).
// Firestore/Auth SDK tự lo phần offline của riêng nó, cache thêm ở đây chỉ gây hại.
const NEVER_CACHE_HOSTS = [
    'firestore.googleapis.com',
    'firebaseio.com',
    'firebaseapp.com',
    'googleapis.com',
    'gstatic.com',
    'google.com',
];

function isNeverCacheRequest(url) {
    try {
        const { hostname } = new URL(url);
        return NEVER_CACHE_HOSTS.some(host => hostname === host || hostname.endsWith('.' + host));
    } catch (e) {
        return false;
    }
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.add('./')).catch(() => {})
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return; // không cache các request ghi dữ liệu
    if (isNeverCacheRequest(request.url)) return; // để mặc định, không can thiệp

    // Điều hướng trang (mở app / tải lại trang): network-first, fallback cache khi offline
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('./', clone)).catch(() => {});
                    return response;
                })
                .catch(() => caches.match('./').then((cached) => cached || caches.match(request)))
        );
        return;
    }

    // Tài nguyên tĩnh cùng gốc: cache-first, cập nhật cache ngầm khi có mạng
    const sameOrigin = new URL(request.url, self.location.href).origin === self.location.origin;
    if (sameOrigin) {
        event.respondWith(
            caches.match(request).then((cached) => {
                const networkFetch = fetch(request)
                    .then((response) => {
                        if (response && response.ok) {
                            const clone = response.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
                        }
                        return response;
                    })
                    .catch(() => cached);
                return cached || networkFetch;
            })
        );
    }
    // Các request khác (CDN bên thứ 3 như Tailwind...) để mặc định trình duyệt xử lý
});

// ── THÔNG BÁO ĐẨY (PUSH) ────────────────────────────────────────────────────
// Hiển thị thông báo khi máy chủ đẩy dữ liệu tới, kể cả khi app đang đóng.
self.addEventListener('push', (event) => {
    if (!event.data) return;
    let payload = {};
    try { payload = event.data.json(); } catch (e) { payload = { title: 'Nhắc nhở', body: event.data.text() }; }

    const title = payload.title || '🔔 Nhắc nhở';
    const options = {
        body: payload.body || '',
        icon: payload.icon,
        badge: payload.badge,
        tag: payload.tag,
        data: payload.data || {},
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Khi người dùng bấm vào thông báo: mở lại app (hoặc focus tab đang mở sẵn)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
            const existing = clientsArr.find((c) => 'focus' in c);
            if (existing) return existing.focus();
            if (self.clients.openWindow) return self.clients.openWindow('./');
        })
    );
});
