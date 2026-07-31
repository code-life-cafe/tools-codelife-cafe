import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { copyText } from '../../src/lib/clipboard.ts';

function stubNavigator(clipboard: unknown) {
	Object.defineProperty(globalThis, 'navigator', {
		value: clipboard === undefined ? {} : { clipboard },
		configurable: true,
	});
}

function stubDocument(
	execCommandResult: boolean | 'throw',
	options: { activeElement?: { focus: () => void } } = {},
) {
	const style: Record<string, string> = {};
	const attributes: Record<string, string> = {};
	const selectionRangeCalls: Array<[number, number]> = [];
	const textarea = {
		value: '',
		style,
		select: () => {},
		setAttribute: (name: string, value: string) => {
			attributes[name] = value;
		},
		setSelectionRange: (start: number, end: number) => {
			selectionRangeCalls.push([start, end]);
		},
	};
	const body = {
		appendChild: () => {},
		removeChild: () => {},
	};
	Object.defineProperty(globalThis, 'document', {
		value: {
			createElement: () => textarea,
			body,
			activeElement: options.activeElement ?? null,
			execCommand: () => {
				if (execCommandResult === 'throw') {
					throw new Error('execCommand not supported');
				}
				return execCommandResult;
			},
		},
		configurable: true,
	});
	return { textarea, attributes, selectionRangeCalls };
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

test('execCommand フォールバックは readonly 属性と setSelectionRange で選択範囲を確定する（iOS Safari 対策）', async () => {
	stubNavigator(undefined);
	const { textarea, attributes, selectionRangeCalls } = stubDocument(true);
	textarea.value = 'hello';
	const ok = await copyText('hello');
	assert.equal(ok, true);
	assert.equal(attributes.readonly, '');
	assert.deepEqual(selectionRangeCalls, [[0, 5]]);
});

test('execCommand フォールバックの textarea は position:fixed かつ top/left:0 に配置されスクロール位置が飛ばない', async () => {
	stubNavigator(undefined);
	const { textarea } = stubDocument(true);
	await copyText('hello');
	assert.equal(textarea.style.position, 'fixed');
	assert.equal(textarea.style.top, '0');
	assert.equal(textarea.style.left, '0');
});

test('execCommand フォールバック後、コピー前の activeElement へフォーカスを復元する', async () => {
	stubNavigator(undefined);
	let focusCalled = false;
	const previouslyFocused = {
		focus: () => {
			focusCalled = true;
		},
	};
	stubDocument(true, { activeElement: previouslyFocused });
	await copyText('hello');
	assert.equal(focusCalled, true);
});

test('execCommand フォールバック失敗時も元の activeElement へフォーカスを復元する', async () => {
	stubNavigator(undefined);
	let focusCalled = false;
	const previouslyFocused = {
		focus: () => {
			focusCalled = true;
		},
	};
	stubDocument(false, { activeElement: previouslyFocused });
	const ok = await copyText('hello');
	assert.equal(ok, false);
	assert.equal(focusCalled, true);
});
