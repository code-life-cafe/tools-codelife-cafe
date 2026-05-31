import Encoding from 'encoding-japanese';
import fs from 'fs';
import path from 'path';

// Use process.cwd() since __dirname might not exist in ESM
const fixturesDir = path.join(process.cwd(), 'tests', 'e2e', 'fixtures');
if (!fs.existsSync(fixturesDir)) {
	fs.mkdirSync(fixturesDir, { recursive: true });
}

const data = `名前,金額,日付,部署,役職,備考
山田太郎,1000,2026-03-11,営業部,部長,新規顧客開拓に貢献
佐藤花子,2500,2026-03-12,開発部,マネージャー,フロントエンドの再構築を担当
鈴木一郎,1500,2026-03-13,人事部,主任,採用プロセスの改善提案を提出
高橋恵理,3200,2026-03-14,総務部,一般,オフィス環境の整備プロジェクト進行中
田中健太,2100,2026-03-15,経理部,課長,月次決算の早期化を実現
`;

// 1. SJIS
fs.writeFileSync(
	path.join(fixturesDir, 'shift_jis.csv'),
	Buffer.from(
		Encoding.convert(Encoding.stringToCode(data), {
			to: 'SJIS',
			from: 'UNICODE',
			type: 'array',
		}),
	),
);

// 2. UTF-8 (no BOM)
fs.writeFileSync(
	path.join(fixturesDir, 'utf8_no_bom.csv'),
	Buffer.from(data, 'utf8'),
);

// 3. UTF-8 (with BOM)
const utf8Bytes = Array.from(Buffer.from(data, 'utf8'));
const bom = [0xef, 0xbb, 0xbf];
fs.writeFileSync(
	path.join(fixturesDir, 'utf8_bom.csv'),
	Buffer.from([...bom, ...utf8Bytes]),
);

// 4. EUC-JP
fs.writeFileSync(
	path.join(fixturesDir, 'euc_jp.csv'),
	Buffer.from(
		Encoding.convert(Encoding.stringToCode(data), {
			to: 'EUCJP',
			from: 'UNICODE',
			type: 'array',
		}),
	),
);

// 5. Invalid Excel (just a renamed text file)
fs.writeFileSync(
	path.join(fixturesDir, 'invalid.xlsx'),
	Buffer.from('This is not an excel file'),
);

console.log('Fixtures generated successfully.');
