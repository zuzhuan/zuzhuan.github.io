'use strict';
const var_CACHE_NAME = 'szcache';
const var_RESOURCES = [
    //需要联网下载的资源
    [
        "index.html",
        "update.js",
    ],

    //在js里保存到缓存里，仅从缓存里获取的资源
    [
        "manifest.json", //不在安装时缓存，因为此时无法拦截，改为在客户端缓存然后在第一次请求时拦截并处理
        "favicon.png",
        "icon.png"
    ]
];
var var_lastCheckUpdateTime = 0;

/*
每次获取到新的可用节点时，都作为初始节点加密保存到缓存nodes.js里，当使用内置通道获取资源时将优先使用这些节点

doc:
https://zhuanlan.zhihu.com/p/52797705 fetch和更新策略
https://zhuanlan.zhihu.com/p/162870243 生命周期
https://blog.csdn.net/weixin_34223655/article/details/88005283 [译]前端离线指南
*/

function var_getResKey(request) {
    var baseUrl = registration.scope;
    if (!baseUrl) {
        baseUrl = location.origin;
    }
    var key = request.url.substring(baseUrl.length);
    if (key.substring(0, 1) == '/') {
        key = key.substring(1);
    }
    if (key == "" || key == "/" || key.startsWith('#') || key.startsWith('?v=') || key.startsWith('?_=')) {
        key = "index.html";
    }
    return key;
}

//更新所有缓存
async function var_reloadAll() {
    //console.log('[PWA] var_reloadAll()');
    return caches.open(var_CACHE_NAME).then(cache => {
        //每次激活时都先删除旧缓存
        cache.keys().then(function(requests) {
            requests.forEach(function(request, index, array) {
                if (request) {
                    var arr = request.url.split('/'),
                        file = arr.pop();
                    if (var_RESOURCES[1].indexOf(file) === -1) {
                        cache.delete(request);
                    }
                }
            });
        });
        //然后再缓存新的
        var scope = registration.scope;
        /*
        cache.addAll(
            var_RESOURCES[0].map(value => new Request(scope + value, { 'cache': 'default' }))
        );
        */
        var_RESOURCES[0].forEach(key => {
            fetch(scope + key).then(response => {
                cache.put(scope + key, response.clone());
                if (key == 'index.html') {
                    cache.put(scope, response.clone());
                }
            });
        });
    }).catch(error => {
        //console.log('[PWA] Failed to activate pwa: ' + error);
        caches.delete(var_CACHE_NAME);
    });
}

async function var_checkUpdate() {
    //console.log('[PWA] var_checkUpdate');
    try {
        var updateCacheName = registration.scope + 'update.js';
        var response = await fetch(updateCacheName, { cache: 'reload' });
        var newVer = await response.text();
        //console.log('[PWA] newVer = ', newVer);
        if (!newVer || !newVer.match(/^\d+$/)) {
            return;
        }

        var cache = await caches.open(var_CACHE_NAME);
        var response = await cache.match(updateCacheName);
        if (!response) {
            cache.put(updateCacheName, new Response(newVer));
            return;
        }

        var oldVer = await response.text();
        if (oldVer != newVer) {
            //console.log('[PWA] changed update.js >>> ', oldVer, ' > ', newVer);
            //cache.put(updateCacheName, new Response(newVer)); //即将在下行刷新缓存时从新缓存新值，无需手动缓存了
            var_reloadAll();
        }
    } catch (error) {
        //console.log('[PWA] var_checkUpdate error: ' + error);
    }
}

// The fetch handler redirects requests for RESOURCE files to the service worker cache.
self.addEventListener("fetch", event => {
    //console.log('[PWA] fetch event', event.request.url);
    if (event.request.method !== 'GET') {
        return;
    }
    var key = var_getResKey(event.request);

    //仅从缓存获取的资源
    if (var_RESOURCES[1].indexOf(key) !== -1) {
        return var_cacheOnly(event);
    }

    /*
    if (var_RESOURCES[0].indexOf(key) === -1) {
        //console.log('[PWA] fetch event -- skip', key);
        return;
    }
    */

    // If the URL is the /, perform an online-first request.
    if (key == 'index.html') {
        //每1小时检查一次更新
        //console.log('[PWA] var_lastCheckUpdateTime = ', var_lastCheckUpdateTime);
        var now = (+new Date());
        if (now - var_lastCheckUpdateTime > 3600 * 1000) {
            var_lastCheckUpdateTime = now;
            var_checkUpdate();
        }
    }

    return var_cacheFirst(event);
});

self.addEventListener('message', event => {
    // SkipWaiting can be used to immediately activate a waiting service worker.
    // This will also require a page refresh triggered by the main worker.
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
        return;
    }
});

// During install, the PRECACHE_NAME cache is populated with the application shell files.
self.addEventListener("install", event => {
    return event.waitUntil(
        self.skipWaiting()
    );
});

// During activate, the cache is populated with the temp files downloaded in
// install. If this service worker is upgrading from one with a saved
// MANIFEST, then use this to retain unchanged resource files.
self.addEventListener("activate", function(event) {
    //console.log('[PWA] activate event', event);
    return event.waitUntil(async function() {
        //更新所有文件
        await var_reloadAll();
        //表示service worker激活后，立即获得控制权，有时失败
        await self.clients.claim();
    }());
});

function var_cacheOnly(event) {
    //console.log('[PWA] fetch var_cacheOnly()', event.request.url);
    return event.respondWith(
        caches.open(var_CACHE_NAME).then(cache => {
            return cache.match(event.request);
        })
    );
}

function var_cacheFirst(event) {
    //console.log('[PWA] fetch var_cacheFirst()', event.request.url);
    return event.respondWith(
        caches.open(var_CACHE_NAME).then(cache => {
            return cache.match(event.request).then(response => {
                // Either respond with the cached resource, or perform a fetch and lazily populate the cache.
                return response || fetch(event.request).then(response => {
                    cache.put(event.request, response.clone());
                    return response;
                });
            })
        })
    );
}

/*
function networkFirst(event) {
    //console.log('[PWA] fetch networkFirst()', event.request.url);
    return event.respondWith(
        caches.open(var_CACHE_NAME).then(cache => {
            return fetch(event.request).then(response => {
                cache.put(event.request, response.clone());
                return response;
            }).catch(error => {
                return cache.match(event.request).then(response => {
                    if (response != null) {
                        return response;
                    }
                    throw error;
                });
            })
        })
    );
}
*/