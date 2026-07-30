import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { copyText } from '../../src/lib/clipboard.ts';

function stubNavigator(clipboard: unknown) {
	Object.defineProperty(globalThis, 'navigator', {
		value: clipboard === undefined ? {} : { clipboard },
		configurable: true,
	});
}

function stubDocument(execCommandResult: boolean | 'throw') {
	const style: Record<string, string> = {};
	const textarea = {
		value: '',
		style,
		select: () => {},
	};
	const body = {
		appendChild: () => {},
		removeChild: () => {},
	};
	Object.defineProperty(globalThis, 'document', {
		value: {
			createElement: () => textarea,
			body,
			execCommand: () => {
				if (execCommandResult === 'throw') {
					throw new Error('execCommand not supported');
				}
				return execCommandResult;
			},
		},
		configurable: true,
	});
}

function clearDocument() {
	Object.defineProperty(globalThis, 'document', {
		value: undefined,
		configurable: true,
	});
}

afterEach(() => {
	stubNavigator(undefined);
	clearDocument();
});

test('Clipboard API が成功すれば true を返す', async () => {
	stubNavigator({ writeText: async () => {} });
	const ok = await copyText('hello');
	assert.equal(ok, true);
});

test('Clipboard API が拒否されたら execCommand フォールバックの結果を返す（成功）', async () => {
	stubNavigator({
		writeText: async () => {
			throw new Error('permission denied');
		},
	});
	stubDocument(true);
	const ok = await copyText('hello');
	assert.equal(ok, true);
});

test('Clipboard API が拒否されたら execCommand フォールバックの結果を返す（失敗）', async () => {
	stubNavigator({
		writeText: async () => {
			throw new Error('permission denied');
		},
	});
	stubDocument(false);
	const ok = await copyText('hello');
	assert.equal(ok, false);
});

test('非セキュアコンテキストなど navigator.clipboard が存在しない場合は例外を投げず execCommand にフォールバックする', async () => {
	stubNavigator(undefined);
	stubDocument(true);
	const ok = await copyText('hello');
	assert.equal(ok, true);
});

test('execCommand が例外を投げても false を返し呼び出し元に伝播しない', async () => {
	stubNavigator(undefined);
	stubDocument('throw');
	const ok = await copyText('hello');
	assert.equal(ok, false);
});

test('document が存在しない環境では false を返す', async () => {
	stubNavigator(undefined);
	clearDocument();
	const ok = await copyText('hello');
	assert.equal(ok, false);
});
