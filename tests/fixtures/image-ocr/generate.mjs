// generate.mjs — OCR評価用fixture（正解付き横書き画像）を生成する。
//
// 生成後は画像と truth/*.txt を固定して読み取り専用で使う。誤認識に合わせて正解文を変更しない。
// 実行: node tests/fixtures/image-ocr/generate.mjs
// 描画はローカルのChromium canvas + OSフォント（Meiryo / Yu Mincho / BIZ UDGothic）。個人情報を含まない。

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = dirname(fileURLToPath(import.meta.url));

const FONTS = {
	meiryo: '"Meiryo"',
	mincho: '"Yu Mincho"',
	biz: '"BIZ UDGothic"',
};

// group: clear = 合格基準（清明な活字）/ degraded = 苦手条件の参考測定（合否に含めない）
const CASES = [
	{
		id: '01-meiryo-prose',
		font: 'meiryo',
		size: 28,
		ext: 'png',
		group: 'clear',
		lines: [
			'本日の会議は午後三時から第二会議室で行います。',
			'資料は事前に共有フォルダへ保存してください。',
			'議事録は担当者が翌営業日までにまとめます。',
			'不明な点があれば、遠慮なく質問してください。',
		],
	},
	{
		id: '02-mincho-prose',
		font: 'mincho',
		size: 30,
		ext: 'png',
		group: 'clear',
		lines: [
			'吾輩は猫である。名前はまだ無い。',
			'どこで生れたかとんと見当がつかぬ。',
			'何でも薄暗いじめじめした所で泣いていた事だけは記憶している。',
			'春の夜の夢のごとく、物語はゆっくりと始まった。',
		],
	},
	{
		id: '03-biz-howto',
		font: 'biz',
		size: 26,
		ext: 'png',
		group: 'clear',
		lines: [
			'操作手順',
			'1. 画面左上のメニューを開きます。',
			'2. 「設定」を選び、言語を日本語に変更します。',
			'3. 変更を保存して、アプリを再起動します。',
			'4. 正しく表示されたことを確認してください。',
		],
	},
	{
		id: '04-meiryo-mixed-jpeg',
		font: 'meiryo',
		size: 26,
		ext: 'jpg',
		quality: 0.9,
		group: 'clear',
		lines: [
			'Release Notes 2026年10月版',
			'新機能: 画像からテキストを抽出できるようになりました。',
			'改善: 起動時間を約20%短縮し、メモリ使用量も減らしました。',
			'修正: 一部の環境で保存ボタンが反応しない問題を解消。',
		],
	},
	{
		id: '05-mincho-jpeg',
		font: 'mincho',
		size: 28,
		ext: 'jpg',
		quality: 0.88,
		group: 'clear',
		lines: [
			'東京都千代田区の夏は蒸し暑く、冬は乾燥した晴天が続く。',
			'秋には街路樹が色づき、多くの人が散歩を楽しむ。',
			'春は桜が咲き、公園は花見客でにぎわう。',
			'四季の変化がはっきりしているのがこの地域の魅力だ。',
		],
	},
	{
		id: '06-biz-numbers',
		font: 'biz',
		size: 28,
		ext: 'png',
		group: 'clear',
		lines: [
			'商品名: ノート A5 5冊セット',
			'価格: 1,280円（税込）',
			'発売日: 2026/10/15 10:30',
			'在庫数: 342個 / 注文番号: ORD-20261015-0047',
			'問い合わせ: support@example.com',
		],
	},
	{
		id: '07-meiryo-english',
		font: 'meiryo',
		size: 28,
		ext: 'png',
		group: 'clear',
		lines: [
			'The quick brown fox jumps over the lazy dog.',
			'Static files are served from the same origin.',
			'Please review the report before Friday afternoon.',
			'Version 7.0.0 was released in December 2025.',
		],
	},
	{
		id: '08-mincho-news',
		font: 'mincho',
		size: 26,
		ext: 'png',
		group: 'clear',
		lines: [
			'市は来年度から、図書館の開館時間を一時間延長すると発表した。',
			'利用者からの要望が多かったことを受けた対応で、',
			'平日は午後八時まで、休日は午後六時まで利用できる。',
			'運営には新たに職員三名を配置する予定である。',
		],
	},
	{
		id: '09-biz-small-jpeg',
		font: 'biz',
		size: 22,
		ext: 'jpg',
		quality: 0.85,
		group: 'clear',
		lines: [
			'利用規約（抜粋）',
			'第1条 本サービスは、利用者が自己の責任において利用するものとします。',
			'第2条 運営者は、事前の通知なくサービス内容を変更できるものとします。',
			'第3条 利用者は、法令および公序良俗に反する行為をしてはなりません。',
		],
	},
	{
		id: '10-meiryo-large',
		font: 'meiryo',
		size: 40,
		ext: 'png',
		group: 'clear',
		lines: [
			'定休日のお知らせ',
			'毎週水曜日はお休みです。',
			'営業時間は九時から十八時です。',
		],
	},
	{
		id: '11-mincho-symbols',
		font: 'mincho',
		size: 28,
		ext: 'png',
		group: 'clear',
		lines: [
			'【重要】システム保守のため、10月20日（月）の',
			'午前2:00〜4:00は一時的にご利用いただけません。',
			'ご迷惑をおかけしますが、ご理解のほどお願い申し上げます。',
			'※作業時間は前後する場合があります。',
		],
	},
	{
		id: '12-biz-recipe',
		font: 'biz',
		size: 26,
		ext: 'png',
		group: 'clear',
		lines: [
			'カレーライス（4人分）',
			'材料: 玉ねぎ2個、にんじん1本、じゃがいも3個、豚肉300g',
			'作り方: 具材を一口大に切り、油で炒めてから水800mlで煮込む。',
			'火を止めてルウを溶かし、弱火で10分ほど温める。',
		],
	},
	// ---- 苦手条件（合否に含めない参考測定） ----
	{
		id: 'd1-lowres',
		font: 'meiryo',
		size: 28,
		ext: 'png',
		group: 'degraded',
		scale: 0.4,
		lines: [
			'解像度が低い画像でも読めるかを調べます。',
			'Low resolution sample text 12345',
		],
	},
	{
		id: 'd2-tilt',
		font: 'meiryo',
		size: 28,
		ext: 'png',
		group: 'degraded',
		rotate: 4,
		lines: [
			'この画像は四度ほど傾いています。',
			'Tilted sample text 67890 for testing.',
		],
	},
	{
		id: 'd3-jpeg-q20',
		font: 'mincho',
		size: 28,
		ext: 'jpg',
		quality: 0.2,
		group: 'degraded',
		lines: [
			'圧縮率が高いJPEGでは文字の輪郭が崩れます。',
			'Heavy compression artifacts appear here.',
		],
	},
	{
		id: 'd4-vertical',
		font: 'mincho',
		size: 30,
		ext: 'png',
		group: 'degraded',
		vertical: true,
		lines: ['縦書きの文章は対象外です。', '一行目と二行目に分かれます。'],
	},
];

// 約3MP級の性能測定用（正解付き。誤り率も記録する）
const PERF_LINES = [
	'本日の会議は午後三時から第二会議室で行います。',
	'資料は事前に共有フォルダへ保存してください。',
	'議事録は担当者が翌営業日までにまとめます。',
	'操作手順は画面左上のメニューから設定を開きます。',
	'The quick brown fox jumps over the lazy dog.',
	'価格: 1,280円（税込） 発売日: 2026/10/15 10:30',
	'四季の変化がはっきりしているのがこの地域の魅力だ。',
	'火を止めてルウを溶かし、弱火で10分ほど温める。',
];
CASES.push({
	id: 'p1-3mp',
	font: 'meiryo',
	size: 36,
	ext: 'png',
	group: 'perf',
	fixedSize: [2048, 1536],
	lines: Array.from(
		{ length: 28 },
		(_, i) => PERF_LINES[i % PERF_LINES.length],
	),
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

async function render(c) {
	return page.evaluate(
		({ c, fonts }) => {
			const cv = document.getElementById('c');
			const ctx = cv.getContext('2d');
			const font = `${c.size}px ${fonts[c.font]}, sans-serif`;
			const lh = Math.round(c.size * 1.6);
			const pad = 32;
			ctx.font = font;
			let w;
			let h;
			if (c.vertical) {
				h = Math.max(...c.lines.map((l) => [...l].length)) * c.size + pad * 2;
				w = c.lines.length * lh + pad * 2;
			} else {
				w =
					Math.ceil(Math.max(...c.lines.map((l) => ctx.measureText(l).width))) +
					pad * 2;
				h = c.lines.length * lh + pad * 2;
			}
			if (c.fixedSize) [w, h] = c.fixedSize;
			cv.width = w;
			cv.height = h;
			ctx.fillStyle = '#fff';
			ctx.fillRect(0, 0, w, h);
			ctx.fillStyle = '#111';
			ctx.font = font;
			ctx.textBaseline = 'top';
			if (c.vertical) {
				c.lines.forEach((line, i) => {
					const x = w - pad - (i + 1) * lh + (lh - c.size) / 2;
					[...line].forEach((ch, j) => {
						ctx.fillText(ch, x, pad + j * c.size);
					});
				});
			} else {
				c.lines.forEach((line, i) => {
					ctx.fillText(line, pad, pad + i * lh + (lh - c.size) / 2);
				});
			}
			let out = cv;
			if (c.rotate || c.scale) {
				const o = document.createElement('canvas');
				const s = c.scale ?? 1;
				const r = ((c.rotate ?? 0) * Math.PI) / 180;
				const bw = Math.ceil(
					(w * Math.cos(Math.abs(r)) + h * Math.sin(Math.abs(r))) * s,
				);
				const bh = Math.ceil(
					(h * Math.cos(Math.abs(r)) + w * Math.sin(Math.abs(r))) * s,
				);
				o.width = bw;
				o.height = bh;
				const octx = o.getContext('2d');
				octx.fillStyle = '#fff';
				octx.fillRect(0, 0, bw, bh);
				octx.translate(bw / 2, bh / 2);
				octx.rotate(r);
				octx.scale(s, s);
				octx.drawImage(cv, -w / 2, -h / 2);
				out = o;
			}
			const mime = c.ext === 'jpg' ? 'image/jpeg' : 'image/png';
			return out.toDataURL(mime, c.quality ?? 0.92).split(',')[1];
		},
		{ c, fonts: FONTS },
	);
}

await mkdir(join(OUT, 'truth'), { recursive: true });
const manifest = [];
for (const c of CASES) {
	const dir = join(OUT, c.group);
	await mkdir(dir, { recursive: true });
	const buf = Buffer.from(await render(c), 'base64');
	await writeFile(join(dir, `${c.id}.${c.ext}`), buf);
	const truth = c.lines.join('\n');
	await writeFile(join(OUT, 'truth', `${c.id}.txt`), `${truth}\n`);
	manifest.push({
		id: c.id,
		group: c.group,
		file: `${c.group}/${c.id}.${c.ext}`,
		font: c.font,
		size: c.size,
		chars: [...truth.replace(/\n/g, '')].length,
	});
}
await writeFile(
	join(OUT, 'manifest.json'),
	`${JSON.stringify(manifest, null, '\t')}\n`,
);
await browser.close();
const clear = manifest.filter((m) => m.group === 'clear');
console.log(
	`clear: ${clear.length}枚 / ${clear.reduce((n, m) => n + m.chars, 0)}文字`,
);
