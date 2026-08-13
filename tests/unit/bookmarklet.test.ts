// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/bookmarklet.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	beautifyJs,
	buildExternalScriptSnippet,
	decodeBookmarklet,
	detectDirection,
	encodeBookmarklet,
	isValidExternalScriptUrl,
	minifyJs,
	wrapIIFE,
} from '../../src/lib/tools/bookmarklet.ts';

const NO_OPTS = { iife: false, minify: false };

function expectEncodeOk(result: ReturnType<typeof encodeBookmarklet>): {
	output: string;
} {
	assert.ok(result.ok, `ok を期待: ${JSON.stringify(result)}`);
	return result;
}

function expectEncodeError(result: ReturnType<typeof encodeBookmarklet>): {
	error: string;
} {
	assert.ok(!result.ok, `エラーを期待: ${JSON.stringify(result)}`);
	return result;
}

function expectDecodeOk(result: ReturnType<typeof decodeBookmarklet>): {
	output: string;
} {
	assert.ok(result.ok, `ok を期待: ${JSON.stringify(result)}`);
	return result;
}

function expectDecodeError(result: ReturnType<typeof decodeBookmarklet>): {
	error: string;
} {
	assert.ok(!result.ok, `エラーを期待: ${JSON.stringify(result)}`);
	return result;
}

// ---------------------------------------------------------------------------
// detectDirection
// ---------------------------------------------------------------------------

test('detectDirection: javascript: で始まる入力はdecode', () => {
	assert.equal(detectDirection('javascript:alert(1)'), 'decode');
	assert.equal(detectDirection('  javascript:alert(1)'), 'decode');
	assert.equal(detectDirection('JAVASCRIPT:alert(1)'), 'decode');
});

test('detectDirection: それ以外の入力はencode', () => {
	assert.equal(detectDirection('alert(1)'), 'encode');
	assert.equal(detectDirection(''), 'encode');
});

// ---------------------------------------------------------------------------
// isValidExternalScriptUrl
// ---------------------------------------------------------------------------

test('isValidExternalScriptUrl: http(s)スキームのみ許可', () => {
	assert.ok(isValidExternalScriptUrl('https://example.com/a.js'));
	assert.ok(isValidExternalScriptUrl('http://example.com/a.js'));
	assert.ok(!isValidExternalScriptUrl('ftp://example.com/a.js'));
	assert.ok(!isValidExternalScriptUrl('example.com/a.js'));
	assert.ok(!isValidExternalScriptUrl(''));
});

// ---------------------------------------------------------------------------
// wrapIIFE / buildExternalScriptSnippet
// ---------------------------------------------------------------------------

test('wrapIIFE: コードをIIFEでラップする', () => {
	const wrapped = wrapIIFE('alert(1);');
	assert.ok(wrapped.startsWith('(() => {'));
	assert.ok(wrapped.endsWith('})();'));
	assert.ok(wrapped.includes('alert(1);'));
});

test('buildExternalScriptSnippet: script要素生成コードを返す', () => {
	const snippet = buildExternalScriptSnippet('https://example.com/a.js');
	assert.ok(snippet.includes("document.createElement('script')"));
	assert.ok(snippet.includes("s.src='https://example.com/a.js'"));
	assert.ok(snippet.includes('document.body.appendChild(s)'));
});

// ---------------------------------------------------------------------------
// minifyJs
// ---------------------------------------------------------------------------

test('minifyJs: 行コメントを削除する', () => {
	assert.equal(
		minifyJs('alert(1); // コメント\nalert(2);'),
		'alert(1); alert(2);',
	);
});

test('minifyJs: ブロックコメントを削除する', () => {
	assert.equal(
		minifyJs('alert(1); /* コメント\n複数行 */ alert(2);'),
		'alert(1); alert(2);',
	);
});

test('minifyJs: 連続空白を単一空白に圧縮する', () => {
	assert.equal(minifyJs('alert(1);\n\n   alert(2);'), 'alert(1); alert(2);');
});

test('minifyJs: 文字列内のコメント記号・空白は保持する', () => {
	assert.equal(
		minifyJs("alert('a // not a comment   b');"),
		"alert('a // not a comment   b');",
	);
	assert.equal(
		minifyJs('alert("a /* not a comment */ b");'),
		'alert("a /* not a comment */ b");',
	);
});

// ---------------------------------------------------------------------------
// beautifyJs
// ---------------------------------------------------------------------------

test('beautifyJs: セミコロンの後に改行を挿入する', () => {
	assert.equal(beautifyJs('alert(1);alert(2);'), 'alert(1);\nalert(2);');
});

test('beautifyJs: 波括弧の深さに応じてインデントする', () => {
	assert.equal(beautifyJs('if(a){b;c;}'), 'if(a){\n  b;\n  c;\n}');
});

test('beautifyJs: ネストした波括弧を2段インデントする', () => {
	assert.equal(
		beautifyJs('if(a){if(b){c;}}'),
		'if(a){\n  if(b){\n    c;\n  }\n}',
	);
});

// ---------------------------------------------------------------------------
// encodeBookmarklet
// ---------------------------------------------------------------------------

test('encodeBookmarklet: 空入力はエラー', () => {
	const result = expectEncodeError(encodeBookmarklet('   ', NO_OPTS));
	assert.ok(result.error.includes('入力してください'));
});

test('encodeBookmarklet: javascript:プレフィックスとURIエンコードを付与する', () => {
	const result = expectEncodeOk(encodeBookmarklet("alert('hello')", NO_OPTS));
	assert.equal(
		result.output,
		`javascript:${encodeURIComponent("alert('hello')")}`,
	);
});

test('encodeBookmarklet: iife=trueでIIFEラップされる', () => {
	const result = expectEncodeOk(
		encodeBookmarklet('alert(1)', { iife: true, minify: false }),
	);
	const decoded = decodeURIComponent(result.output.replace('javascript:', ''));
	assert.ok(decoded.startsWith('(() => {'));
});

test('encodeBookmarklet: iife=falseではラップされない', () => {
	const result = expectEncodeOk(
		encodeBookmarklet('alert(1)', { iife: false, minify: false }),
	);
	const decoded = decodeURIComponent(result.output.replace('javascript:', ''));
	assert.equal(decoded, 'alert(1)');
});

test('encodeBookmarklet: minify=trueでコメント・空白が圧縮される', () => {
	const result = expectEncodeOk(
		encodeBookmarklet('alert(1); // c\nalert(2);', {
			iife: false,
			minify: true,
		}),
	);
	const decoded = decodeURIComponent(result.output.replace('javascript:', ''));
	assert.equal(decoded, 'alert(1); alert(2);');
});

test('encodeBookmarklet: minify=falseでは元の書式のまま', () => {
	const result = expectEncodeOk(
		encodeBookmarklet('alert(1); // c', { iife: false, minify: false }),
	);
	const decoded = decodeURIComponent(result.output.replace('javascript:', ''));
	assert.equal(decoded, 'alert(1); // c');
});

test('encodeBookmarklet: 外部スクリプトURL指定時はユーザーコードの前に挿入される', () => {
	const result = expectEncodeOk(
		encodeBookmarklet('alert(1)', {
			iife: false,
			minify: false,
			externalScriptUrl: 'https://example.com/a.js',
		}),
	);
	const decoded = decodeURIComponent(result.output.replace('javascript:', ''));
	assert.ok(decoded.startsWith("var s=document.createElement('script')"));
	assert.ok(decoded.endsWith('alert(1)'));
});

test('encodeBookmarklet: 外部スクリプトURLが不正な場合はエラー', () => {
	const result = expectEncodeError(
		encodeBookmarklet('alert(1)', {
			iife: false,
			minify: false,
			externalScriptUrl: 'ftp://example.com/a.js',
		}),
	);
	assert.ok(result.error.includes('http'));
});

test('encodeBookmarklet: 外部スクリプトURL未指定なら挿入されない', () => {
	const result = expectEncodeOk(
		encodeBookmarklet('alert(1)', { iife: false, minify: false }),
	);
	const decoded = decodeURIComponent(result.output.replace('javascript:', ''));
	assert.equal(decoded, 'alert(1)');
});

// ---------------------------------------------------------------------------
// decodeBookmarklet
// ---------------------------------------------------------------------------

test('decodeBookmarklet: 空入力はエラー', () => {
	const result = expectDecodeError(
		decodeBookmarklet('   ', { beautify: false }),
	);
	assert.ok(result.error.includes('入力してください'));
});

test('decodeBookmarklet: javascript:プレフィックスを除去してデコードする', () => {
	const encoded = encodeURIComponent("alert('hello')");
	const result = expectDecodeOk(
		decodeBookmarklet(`javascript:${encoded}`, { beautify: false }),
	);
	assert.equal(result.output, "alert('hello')");
});

test('decodeBookmarklet: プレフィックスなしのURIエンコード済み文字列もデコードできる', () => {
	const encoded = encodeURIComponent('alert(1)');
	const result = expectDecodeOk(
		decodeBookmarklet(encoded, { beautify: false }),
	);
	assert.equal(result.output, 'alert(1)');
});

test('decodeBookmarklet: 不正なURIエンコードはエラー', () => {
	const result = expectDecodeError(
		decodeBookmarklet('javascript:%E0%A4%A', { beautify: false }),
	);
	assert.ok(result.error.includes('不正'));
});

test('decodeBookmarklet: beautify=trueで整形される', () => {
	const encoded = encodeURIComponent('if(a){alert(1);}');
	const result = expectDecodeOk(
		decodeBookmarklet(`javascript:${encoded}`, { beautify: true }),
	);
	assert.equal(result.output, 'if(a){\n  alert(1);\n}');
});

test('decodeBookmarklet: beautify=falseでは整形されない', () => {
	const encoded = encodeURIComponent('if(a){alert(1);}');
	const result = expectDecodeOk(
		decodeBookmarklet(`javascript:${encoded}`, { beautify: false }),
	);
	assert.equal(result.output, 'if(a){alert(1);}');
});

// ---------------------------------------------------------------------------
// ラウンドトリップ
// ---------------------------------------------------------------------------

test('ラウンドトリップ: encode → decode で元のコードが復元される（iife/minifyなし）', () => {
	const original = "document.title = 'テスト';\nalert(document.title);";
	const encoded = expectEncodeOk(
		encodeBookmarklet(original, { iife: false, minify: false }),
	);
	const decoded = expectDecodeOk(
		decodeBookmarklet(encoded.output, { beautify: false }),
	);
	assert.equal(decoded.output, original);
});

test('ラウンドトリップ: IIFEラップしても元コードの内容がそのまま含まれる', () => {
	const original = 'alert(1);';
	const encoded = expectEncodeOk(
		encodeBookmarklet(original, { iife: true, minify: false }),
	);
	const decoded = expectDecodeOk(
		decodeBookmarklet(encoded.output, { beautify: false }),
	);
	assert.ok(decoded.output.includes(original));
	assert.ok(decoded.output.startsWith('(() => {'));
});

test('ラウンドトリップ: 外部スクリプト挿入時もユーザーコードが末尾に残る', () => {
	const original = 'alert(1)';
	const encoded = expectEncodeOk(
		encodeBookmarklet(original, {
			iife: false,
			minify: false,
			externalScriptUrl: 'https://example.com/a.js',
		}),
	);
	const decoded = expectDecodeOk(
		decodeBookmarklet(encoded.output, { beautify: false }),
	);
	assert.ok(decoded.output.endsWith(original));
});
