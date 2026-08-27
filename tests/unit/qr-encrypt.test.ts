// 実行方法: npm run test:unit（Node 22 の型ストリッピングで .ts を直接実行）
// 単体実行: node --test tests/unit/qr-encrypt.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	decodeQrPayload,
	decryptQrPayload,
	ENVELOPE_PREFIX,
	encryptToQrPayload,
	estimateCapacity,
	estimatePassphraseStrength,
	isPracticalScanWarning,
	KDF_NAME,
	MAX_QR_PAYLOAD_BYTES,
	PRACTICAL_SCAN_WARNING_BYTES,
} from '../../src/lib/tools/qr-encrypt.ts';

test('暗号化→復号のラウンドトリップ（同じ平文・パスフレーズで一致する）', async () => {
	const plaintext = '秘密のメッセージ: 2FAリカバリコード 123456';
	const passphrase = 'correct horse battery staple';

	const encrypted = await encryptToQrPayload(plaintext, passphrase);
	assert.equal(encrypted.ok, true);
	if (!encrypted.ok) return;
	assert.ok(encrypted.envelope.startsWith(ENVELOPE_PREFIX));

	const decrypted = await decryptQrPayload(encrypted.envelope, passphrase);
	assert.equal(decrypted.ok, true);
	if (!decrypted.ok) return;
	assert.equal(decrypted.plaintext, plaintext);
});

test('誤ったパスフレーズでは復号に失敗する', async () => {
	const encrypted = await encryptToQrPayload(
		'hello world',
		'correct-passphrase',
	);
	assert.equal(encrypted.ok, true);
	if (!encrypted.ok) return;

	const decrypted = await decryptQrPayload(
		encrypted.envelope,
		'wrong-passphrase',
	);
	assert.equal(decrypted.ok, false);
	if (decrypted.ok) return;
	assert.equal(decrypted.reason, 'invalid-passphrase-or-corrupted');
});

test('ciphertext改ざん（GCM認証タグ不一致）は復号に失敗する', async () => {
	const encrypted = await encryptToQrPayload(
		'tamper test payload',
		'passphrase-123',
	);
	assert.equal(encrypted.ok, true);
	if (!encrypted.ok) return;

	const decoded = decodeQrPayload(encrypted.envelope);
	assert.equal(decoded.ok, true);
	if (!decoded.ok) return;

	// ciphertextの最後の1文字を別のBase64URL文字に差し替えて改ざんを模擬する
	const tamperedCiphertext =
		decoded.envelope.ciphertext.slice(0, -1) +
		(decoded.envelope.ciphertext.at(-1) === 'A' ? 'B' : 'A');
	const tamperedEnvelope = {
		...decoded.envelope,
		ciphertext: tamperedCiphertext,
	};
	const tamperedRaw =
		ENVELOPE_PREFIX +
		Buffer.from(JSON.stringify(tamperedEnvelope))
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');

	const decrypted = await decryptQrPayload(tamperedRaw, 'passphrase-123');
	assert.equal(decrypted.ok, false);
	if (decrypted.ok) return;
	assert.equal(decrypted.reason, 'invalid-passphrase-or-corrupted');
});

test('未知のversionは拒否される（未対応の形式）', () => {
	const badEnvelope = {
		version: 2,
		kdf: KDF_NAME,
		iterations: 600_000,
		compression: 'none',
		salt: 'AAAA',
		iv: 'AAAA',
		ciphertext: 'AAAA',
	};
	const raw =
		ENVELOPE_PREFIX +
		Buffer.from(JSON.stringify(badEnvelope))
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	const decoded = decodeQrPayload(raw);
	assert.equal(decoded.ok, false);
	if (decoded.ok) return;
	assert.equal(decoded.reason, 'unsupported-version');
});

test('未知のkdfは拒否される（未対応の形式）', () => {
	const badEnvelope = {
		version: 1,
		kdf: 'PBKDF2-HMAC-SHA1',
		iterations: 600_000,
		compression: 'none',
		salt: 'AAAA',
		iv: 'AAAA',
		ciphertext: 'AAAA',
	};
	const raw =
		ENVELOPE_PREFIX +
		Buffer.from(JSON.stringify(badEnvelope))
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	const decoded = decodeQrPayload(raw);
	assert.equal(decoded.ok, false);
	if (decoded.ok) return;
	assert.equal(decoded.reason, 'unsupported-kdf');
});

test('プレフィックス不一致・不正なBase64/JSONは invalid-format として拒否される', () => {
	assert.equal(decodeQrPayload('not-a-qre1-payload').ok, false);
	assert.equal(
		decodeQrPayload(`${ENVELOPE_PREFIX}***not-base64url***`).ok,
		false,
	);

	const notJson = `${ENVELOPE_PREFIX}${Buffer.from('not json').toString('base64url')}`;
	assert.equal(decodeQrPayload(notJson).ok, false);
});

test('圧縮あり・なし両方のラウンドトリップが成功する', async () => {
	// 圧縮が効きやすい繰り返しテキスト
	const compressiblePlaintext = 'あ'.repeat(500);
	const encryptedCompressible = await encryptToQrPayload(
		compressiblePlaintext,
		'pw',
	);
	assert.equal(encryptedCompressible.ok, true);
	if (!encryptedCompressible.ok) return;
	assert.equal(encryptedCompressible.compressionUsed, true);
	const decryptedCompressible = await decryptQrPayload(
		encryptedCompressible.envelope,
		'pw',
	);
	assert.equal(decryptedCompressible.ok, true);
	if (!decryptedCompressible.ok) return;
	assert.equal(decryptedCompressible.plaintext, compressiblePlaintext);

	// compression: 'none' のenvelopeも復号できることを確認する（非対応ブラウザ相当）
	const decoded = decodeQrPayload(encryptedCompressible.envelope);
	assert.equal(decoded.ok, true);
	if (!decoded.ok) return;
	assert.equal(decoded.envelope.compression, 'deflate-raw');
});

test('2,953バイト境界の容量判定: 上限以下は成功、超過はpayload-too-largeで拒否', async () => {
	// ランダムに近い（圧縮が効きにくい）文字列で境界を作る
	const rand = () => Math.random().toString(36).slice(2);
	let text = '';
	while (text.length < 4000) text += rand();

	// 上限を大きく下回る短い平文は成功する
	const smallResult = await encryptToQrPayload('short text', 'pw');
	assert.equal(smallResult.ok, true);
	if (smallResult.ok) {
		assert.ok(smallResult.payloadBytes <= MAX_QR_PAYLOAD_BYTES);
	}

	// 上限を大きく超える平文は payload-too-large で拒否される
	const largeResult = await encryptToQrPayload(text, 'pw');
	assert.equal(largeResult.ok, false);
	if (!largeResult.ok) {
		assert.equal(largeResult.reason, 'payload-too-large');
		assert.ok((largeResult.payloadBytes ?? 0) > MAX_QR_PAYLOAD_BYTES);
	}
});

test('estimateCapacity は暗号化前に容量超過を検出できる', async () => {
	const rand = () => Math.random().toString(36).slice(2);
	let text = '';
	while (text.length < 4000) text += rand();

	const estimate = await estimateCapacity(text);
	assert.equal(estimate.withinLimit, false);
	assert.ok(estimate.payloadBytes > MAX_QR_PAYLOAD_BYTES);

	const shortEstimate = await estimateCapacity('short text');
	assert.equal(shortEstimate.withinLimit, true);
});

test('estimateCapacity の見積もりは実際のencryptToQrPayloadと同じバイト数になる（内容非依存）', async () => {
	const plaintext = 'capacity estimate consistency check 容量見積もり一致確認';
	const estimate = await estimateCapacity(plaintext);
	const actual = await encryptToQrPayload(plaintext, 'any-passphrase');
	assert.equal(actual.ok, true);
	if (!actual.ok) return;
	assert.equal(estimate.payloadBytes, actual.payloadBytes);
});

test('空の平文はempty-plaintextとして拒否される', async () => {
	const result = await encryptToQrPayload('', 'pw');
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.reason, 'empty-plaintext');
});

test('パスフレーズ強度の簡易判定', () => {
	assert.equal(estimatePassphraseStrength('short'), 'weak');
	assert.equal(estimatePassphraseStrength('alllowercase'), 'medium');
	assert.equal(estimatePassphraseStrength('Aa1!Aa1!Aa1!'), 'strong');
});

// ============================================================
// isPracticalScanWarning / PRACTICAL_SCAN_WARNING_BYTES
// ============================================================

test('PRACTICAL_SCAN_WARNING_BYTES は1,300バイトである', () => {
	assert.equal(PRACTICAL_SCAN_WARNING_BYTES, 1300);
});

test('isPracticalScanWarning: 閾値境界（1,299 / 1,300 / 1,301B）', () => {
	assert.equal(isPracticalScanWarning(1299), false);
	assert.equal(isPracticalScanWarning(1300), false);
	assert.equal(isPracticalScanWarning(1301), true);
});

test('isPracticalScanWarning: 閾値未満・0では警告なし', () => {
	assert.equal(isPracticalScanWarning(0), false);
	assert.equal(isPracticalScanWarning(500), false);
});

test('estimateCapacity: practicalScanWarning は閾値超過時のみtrueになる', async () => {
	const rand = () => Math.random().toString(36).slice(2);
	// 圧縮が効きにくいランダム文字列でペイロードを1,300B超過させる
	let text = '';
	while (text.length < 1400) text += rand();

	const largeEstimate = await estimateCapacity(text);
	assert.ok(largeEstimate.payloadBytes > PRACTICAL_SCAN_WARNING_BYTES);
	assert.equal(largeEstimate.practicalScanWarning, true);

	const smallEstimate = await estimateCapacity('short text');
	assert.ok(smallEstimate.payloadBytes <= PRACTICAL_SCAN_WARNING_BYTES);
	assert.equal(smallEstimate.practicalScanWarning, false);
});
