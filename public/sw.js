const CACHE_NAME = 'cl-tools-__HASH__';

// インストール時に最低限キャッシュするアセット
const MIN_ASSETS = [
	'/',
	'/offline/',
	'/site.webmanifest',
	'/favicon.ico',
	'/favicon-16x16.png',
	'/favicon-32x32.png',
	'/apple-touch-icon.png',
	'/android-chrome-192x192.png',
	'/android-chrome-512x512.png',
];

// PWA インストール時にプリキャッシュする全ページ（ビルドスクリプトが注入）
const ALL_PAGES = [
	/* __ALL_PAGES__ */
];

// PWA インストール時にプリキャッシュする全アセット（ビルドスクリプトが注入）
const ALL_ASSETS = [
	/* __ALL_ASSETS__ */
];

// redirected:true の Response はナビゲーションへの応答として使えない（ブラウザが拒否する）ため、
// リダイレクトを経由したレスポンスは本体をコピーしてフラグを剥がす
async function stripRedirect(response) {
	if (!response || !response.redirected) return response;
	const body = await response.blob();
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

// fetch して redirected フラグを剥がした上で指定 URL キーでキャッシュに保存する
async function fetchAndCache(cache, url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	await cache.put(url, await stripRedirect(response));
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		Promise.all([
			// 全アセットがハッシュ付きURLで管理されているため、即時アクティベートしても安全
			self.skipWaiting(),
			caches
				.open(CACHE_NAME)
				.then((cache) =>
					Promise.allSettled(MIN_ASSETS.map((url) => fetchAndCache(cache, url))),
				),
		]),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

// PWA インストール時やユーザー操作時に全ページ・全アセットをプリキャッシュ（進捗通知と状態確認に対応）
self.addEventListener('message', (event) => {
	if (event.data?.type === 'PRECACHE_ALL') {
		event.waitUntil(
			(async () => {
				const cache = await caches.open(CACHE_NAME);
				const urls = [...ALL_PAGES, ...ALL_ASSETS];
				const total = urls.length;
				let loaded = 0;

				const sendProgress = () => {
					if (event.source) {
						event.source.postMessage({
							type: 'PRECACHE_PROGRESS',
							loaded,
							total,
							percentage: total > 0 ? Math.round((loaded / total) * 100) : 100,
						});
					}
				};

				// 初期進捗を通知
				sendProgress();

				// 全アセットを個別にキャッシュに追加して進捗をカウント
				const promises = urls.map(async (url) => {
					try {
						const cached = await cache.match(url);
						// 旧バージョンの SW が redirected な Response を保存している可能性があるため再取得する
						if (!cached || cached.redirected) {
							await fetchAndCache(cache, url);
						}
					} catch (err) {
						console.error(`Failed to cache ${url}:`, err);
					} finally {
						loaded++;
						sendProgress();
					}
				});

				await Promise.allSettled(promises);

				if (event.source) {
					event.source.postMessage({
						type: 'PRECACHE_COMPLETE',
						cacheName: CACHE_NAME,
					});
				}
			})(),
		);
	}

	if (event.data?.type === 'CHECK_PRECACHE_STATUS') {
		event.waitUntil(
			(async () => {
				const cache = await caches.open(CACHE_NAME);
				const urls = [...ALL_PAGES, ...ALL_ASSETS];
				let cachedCount = 0;

				for (const url of urls) {
					const matched = await cache.match(url);
					// redirected な古いエントリはオフライン時に使えないため未キャッシュ扱い
					if (matched && !matched.redirected) {
						cachedCount++;
					}
				}

				if (event.source) {
					event.source.postMessage({
						type: 'PRECACHE_STATUS_RESULT',
						isComplete: cachedCount === urls.length && urls.length > 0,
						cachedCount,
						totalCount: urls.length,
						cacheName: CACHE_NAME,
					});
				}
			})(),
		);
	}
});

self.addEventListener('fetch', (event) => {
	if (!event.request.url.startsWith(self.location.origin)) return;

	const reqUrl = event.request.url;
	const url = new URL(reqUrl);

	// 静的アセット: Cache First
	if (
		url.pathname.startsWith('/_astro/') ||
		url.pathname.match(
			/\.(svg|png|jpg|jpeg|gif|woff|woff2|css|js|json|webmanifest)$/,
		)
	) {
		event.respondWith(
			caches.open(CACHE_NAME).then(async (cache) => {
				const cached = await cache.match(reqUrl, { ignoreVary: true });
				if (cached) return cached;
				const response = await fetch(event.request);
				if (response.ok) {
					cache.put(reqUrl, response.clone());
				}
				return response;
			}),
		);
		return;
	}

	// ページリクエスト: ブラウザナビゲーション(mode:navigate) または
	// Astro View Transitions の fetch（拡張子なしパス）を同等に処理
	const isPageRequest =
		event.request.mode === 'navigate' ||
		url.pathname.endsWith('/') ||
		!url.pathname.split('/').pop().includes('.');

	if (isPageRequest) {
		event.respondWith(
			fetch(event.request)
				.then((response) => {
					// ナビゲーション時のみキャッシュを更新（View Transitions fetchは除外）
					// 404等のエラーページをキャッシュしないよう response.ok を確認する
					if (event.request.mode === 'navigate' && response.ok) {
						const clone = response.clone();
						caches
							.open(CACHE_NAME)
							.then(async (cache) =>
								cache.put(reqUrl, await stripRedirect(clone)),
							);
					}
					return response;
				})
				.catch(async () => {
					const cache = await caches.open(CACHE_NAME);
					// trailing slash の有無を両方試みる
					const withSlash = reqUrl.endsWith('/') ? reqUrl : reqUrl + '/';
					const withoutSlash = reqUrl.endsWith('/')
						? reqUrl.slice(0, -1)
						: reqUrl;
					const matched =
						(await cache.match(withSlash, { ignoreVary: true })) ||
						(await cache.match(withoutSlash, { ignoreVary: true })) ||
						(await cache.match('/offline/', { ignoreVary: true }));
					return stripRedirect(matched);
				}),
		);
		return;
	}

	// その他: Network First
	event.respondWith(
		fetch(event.request).catch(async () => {
			const cache = await caches.open(CACHE_NAME);
			return cache.match(reqUrl, { ignoreVary: true });
		}),
	);
});
