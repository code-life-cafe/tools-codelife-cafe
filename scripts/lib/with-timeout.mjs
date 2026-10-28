// 通信を明示的な上限で打ち切る。fetch本体・本文読取を fn に含めて渡すこと。
// signal を無視する実装（テストのダミー等）でも、タイマーとのraceで必ず期限内に失敗する。
export async function withTimeout(fn, ms, label = 'request') {
	const ac = new AbortController();
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			ac.abort();
			reject(new Error(`${label}が${ms}msでタイムアウト`));
		}, ms);
	});
	try {
		return await Promise.race([fn(ac.signal), timeout]);
	} finally {
		clearTimeout(timer);
	}
}
