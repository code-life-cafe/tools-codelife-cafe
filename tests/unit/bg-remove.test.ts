// 実行方法: npm run test:unit
// 単体実行: node --test tests/unit/bg-remove.test.ts
//
// 実際のAI推論処理（Worker内のTransformers.jsパイプライン）はブラウザ専用のため
// E2E で検証する。ここでは Worker ラッパー（bg-remove.ts）の
// - progress メッセージの id フィルタリング（混信防止）
// - リスナーの確実な解除（上書き・エラー・Worker終了時のメモリリーク防止）
// を、Worker をモックして検証する。
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

// --- Worker のフェイク実装 ---
// addEventListener/removeEventListener/postMessage/terminate の呼び出しを記録し、
// emit() でテストから任意の worker → main メッセージを注入できる。
class FakeWorker {
	static instances: FakeWorker[] = [];
	listeners = new Set<(e: { data: unknown }) => void>();
	posted: unknown[] = [];
	terminated = false;

	constructor() {
		FakeWorker.instances.push(this);
	}

	addEventListener(_type: string, handler: (e: { data: unknown }) => void) {
		this.listeners.add(handler);
	}

	removeEventListener(_type: string, handler: (e: { data: unknown }) => void) {
		this.listeners.delete(handler);
	}

	postMessage(data: unknown) {
		this.posted.push(data);
	}

	terminate() {
		this.terminated = true;
	}

	emit(data: unknown) {
		for (const listener of [...this.listeners]) listener({ data });
	}
}

// bg-remove.ts の `new Worker(...)` が本 Fake を使うようにしてからインポートする
(globalThis as unknown as { Worker: typeof FakeWorker }).Worker = FakeWorker;

const { removeBackground, terminateWorker } = await import(
	'../../src/lib/tools/bg-remove.ts'
);

afterEach(() => {
	// 各テスト後に Worker シングルトンをリセットし、次のテストで新しい FakeWorker を使う
	terminateWorker();
});

function lastWorker(): FakeWorker {
	const w = FakeWorker.instances.at(-1);
	assert.ok(w, 'FakeWorker が生成されていません');
	return w;
}

function lastRequestId(w: FakeWorker): string {
	const req = w.posted.at(-1) as { id: string } | undefined;
	assert.ok(req, 'Worker へリクエストが送信されていません');
	return req.id;
}

test('removeBackground: 自分の処理idに一致する progress のみ onProgress に通知される', async () => {
	const events: unknown[] = [];
	const file = new Blob(['dummy'], { type: 'image/png' });
	const promise = removeBackground(file, 'fast', (info) => events.push(info));

	// arrayBuffer() 解決後の postMessage を待つ
	await new Promise((r) => setTimeout(r, 0));
	const w = lastWorker();
	const id = lastRequestId(w);

	// 自分宛て以外（preload や並行処理）の progress は無視される
	w.emit({
		type: 'progress',
		id: 'other-call-id',
		payload: { status: 'initiate' },
	});
	assert.equal(events.length, 0);

	// 自分の id の progress は通知される
	w.emit({
		type: 'progress',
		id,
		payload: { status: 'download', progress: 50 },
	});
	assert.equal(events.length, 1);
	assert.deepEqual(events[0], {
		status: 'download',
		progress: 50,
		loaded: undefined,
		total: undefined,
		file: undefined,
	});

	// 後片付け（Promise を宙に浮かせない）
	w.emit({ type: 'error', id, message: 'cleanup' });
	await assert.rejects(promise);
});

test('removeBackground: 完了・エラー後にリスナーが解除され、連続実行でも増加しない', async () => {
	for (let i = 0; i < 3; i++) {
		const file = new Blob(['x'], { type: 'image/png' });
		const promise = removeBackground(file, 'fast');
		await new Promise((r) => setTimeout(r, 0));

		const w = lastWorker();
		const id = lastRequestId(w);
		assert.equal(w.listeners.size, 1, `${i}回目: リスナーが1件登録されている`);

		w.emit({ type: 'error', id, message: `boom-${i}` });
		await assert.rejects(promise);
		assert.equal(
			w.listeners.size,
			0,
			`${i}回目: エラー後にリスナーが解除される`,
		);
	}
});

test('removeBackground: 新しい呼び出しで前回のリスナーが解除され、前回の Promise は reject される', async () => {
	const file1 = new Blob(['a'], { type: 'image/png' });
	const p1 = removeBackground(file1, 'fast');
	await new Promise((r) => setTimeout(r, 0));

	const w = lastWorker();
	assert.equal(w.listeners.size, 1);

	// 上書き: 別画像で2回目の呼び出し（旧リスナーは解除され、旧 Promise は reject される）
	// p1 は removeBackground(file2, ...) の呼び出し中に同期的に reject されるため、
	// マクロタスク境界（setTimeout）を挟む前にハンドラを付けて unhandledRejection を防ぐ。
	const file2 = new Blob(['b'], { type: 'image/png' });
	const p2 = removeBackground(file2, 'fast');
	await assert.rejects(p1, /上書き/);

	await new Promise((r) => setTimeout(r, 0));
	assert.equal(
		w.listeners.size,
		1,
		'古いリスナーが残っていない（上書き後も1件のみ）',
	);

	// 2件目を正常終了させて後片付け
	const id2 = lastRequestId(w);
	w.emit({ type: 'error', id: id2, message: 'cleanup' });
	await assert.rejects(p2);
	assert.equal(w.listeners.size, 0);
});

test('terminateWorker: 未解決の呼び出しを reject してから Worker を終了する', async () => {
	const file = new Blob(['x'], { type: 'image/png' });
	const promise = removeBackground(file, 'fast');
	await new Promise((r) => setTimeout(r, 0));

	const w = lastWorker();
	terminateWorker();

	await assert.rejects(promise);
	assert.equal(w.terminated, true);
});
