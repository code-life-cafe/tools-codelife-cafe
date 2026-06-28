export type SheetData = { name: string; rows: string[][] };
export type XlsxParseResult = { sheets: SheetData[]; activeSheet: number };

export function isDecompressionStreamSupported(): boolean {
	return typeof DecompressionStream !== 'undefined';
}

export function excelSerialToDate(
	serial: number,
	is1904: boolean = false,
): Date {
	if (is1904) {
		const epoch = Date.UTC(1904, 0, 1);
		return new Date(epoch + Math.round(serial * 86400000));
	}
	let adjusted = serial;
	if (serial > 60) {
		adjusted -= 1;
	}
	const epoch = Date.UTC(1899, 11, 31);
	return new Date(epoch + Math.round(adjusted * 86400000));
}

function formatDateISO(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	const hh = date.getUTCHours();
	const mm = date.getUTCMinutes();
	const ss = date.getUTCSeconds();
	if (hh === 0 && mm === 0 && ss === 0) {
		return `${y}-${m}-${d}`;
	}
	return `${y}-${m}-${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// 軽量 XML Node インターフェース
export interface SimpleXmlNode {
	tagName: string;
	getAttribute(name: string): string | null;
	textContent: string;
	querySelector(selector: string): SimpleXmlNode | null;
	querySelectorAll(selector: string): SimpleXmlNode[];
}

/**
 * 環境に応じた XML パース（DOMParser またはフォールバック）
 */
export function parseXmlString(xmlText: string): SimpleXmlNode {
	if (typeof DOMParser !== 'undefined') {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xmlText, 'text/xml');
		const wrapDomNode = (node: Element): SimpleXmlNode => ({
			tagName: node.tagName,
			getAttribute: (name) => node.getAttribute(name),
			textContent: node.textContent ?? '',
			querySelector: (sel) => {
				const el = node.querySelector(sel);
				return el ? wrapDomNode(el) : null;
			},
			querySelectorAll: (sel) => {
				const els = Array.from(node.querySelectorAll(sel));
				return els.map(wrapDomNode);
			},
		});
		return wrapDomNode(doc.documentElement);
	}

	// 軽量フォールバック XML パーサー (DOMParser が利用できない環境用)
	return createFallbackXmlTree(xmlText);
}

function createFallbackXmlTree(xml: string): SimpleXmlNode {
	// タグを洗出し、簡易なノード木を構築する
	function parseElement(str: string): SimpleXmlNode {
		const tagMatch = str.match(/^<([^\s/>]+)/);
		const tagName = tagMatch ? tagMatch[1] : '';

		const getAttribute = (name: string): string | null => {
			const attrRegex = new RegExp(`${name}=(?:"([^"]*)"|'([^']*)')`);
			const m = str.match(attrRegex);
			if (m) return m[1] ?? m[2] ?? '';
			return null;
		};

		// textContent 抽出
		const textContent = str.replace(/<[^>]+>/g, '').trim();

		const querySelectorAll = (selector: string): SimpleXmlNode[] => {
			const results: SimpleXmlNode[] = [];
			const regex = new RegExp(
				`<${selector}(\\s[^>]*)?>([\\s\\S]*?)</${selector}>|<${selector}(\\s[^>]*)?/>`,
				'g',
			);
			let match: RegExpExecArray | null = null;
			// biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop
			while ((match = regex.exec(str)) !== null) {
				results.push(parseElement(match[0]));
			}
			return results;
		};

		const querySelector = (selector: string): SimpleXmlNode | null => {
			const list = querySelectorAll(selector);
			return list.length > 0 ? list[0] : null;
		};

		return {
			tagName,
			getAttribute,
			textContent,
			querySelector,
			querySelectorAll,
		};
	}

	return parseElement(xml.trim());
}

/**
 * セル参照 (例: "A1", "BC12") を行・列の 0-indexed インデックスに変換
 */

export function cellRefToCoords(ref: string): { row: number; col: number } {
	const match = ref.match(/^([A-Z]+)(\d+)$/);
	if (!match) return { row: 0, col: 0 };
	const colStr = match[1];
	const rowStr = match[2];
	let col = 0;
	for (let i = 0; i < colStr.length; i++) {
		col = col * 26 + (colStr.charCodeAt(i) - 64);
	}
	return { row: Number(rowStr) - 1, col: col - 1 };
}

/**
 * ZIP構造からエントリを取り出して解凍する純TS実装
 */
async function unzipXlsx(buffer: ArrayBuffer): Promise<Map<string, string>> {
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	const len = buffer.byteLength;

	// EOCD (End of Central Directory) 検索
	let eocdOffset = -1;
	for (let i = len - 22; i >= 0; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset === -1) {
		throw new Error(
			'ファイルが破損しているか、有効な .xlsx (ZIP) ファイルではありません。',
		);
	}

	const cdRecords = view.getUint16(eocdOffset + 10, true);
	const cdOffset = view.getUint32(eocdOffset + 16, true);

	const entries = new Map<string, string>();
	const textDecoder = new TextDecoder('utf-8');

	let currCd = cdOffset;
	for (let i = 0; i < cdRecords; i++) {
		if (currCd + 46 > len || view.getUint32(currCd, true) !== 0x02014b50) {
			break;
		}
		const method = view.getUint16(currCd + 10, true);
		const compSize = view.getUint32(currCd + 20, true);
		const nameLen = view.getUint16(currCd + 28, true);
		const extraLen = view.getUint16(currCd + 30, true);
		const commentLen = view.getUint16(currCd + 32, true);
		const localOffset = view.getUint32(currCd + 42, true);

		const nameBytes = bytes.subarray(currCd + 46, currCd + 46 + nameLen);
		const fileName = textDecoder.decode(nameBytes);

		currCd += 46 + nameLen + extraLen + commentLen;

		if (
			localOffset + 30 > len ||
			view.getUint32(localOffset, true) !== 0x04034b50
		) {
			continue;
		}

		const localNameLen = view.getUint16(localOffset + 26, true);
		const localExtraLen = view.getUint16(localOffset + 28, true);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;

		const compBytes = bytes.subarray(dataStart, dataStart + compSize);

		let decompressedBytes: Uint8Array;
		if (method === 0) {
			// stored
			decompressedBytes = compBytes;
		} else if (method === 8) {
			// deflate
			if (!isDecompressionStreamSupported()) {
				throw new Error(
					'お使いのブラウザは .xlsx ファイルの直接読み込みに対応していません。Excel で CSV としてエクスポートしてからお試しください。Chrome / Edge / Safari の最新版であれば直接読み込めます。',
				);
			}
			try {
				const ds = new DecompressionStream('deflate-raw');
				const writer = ds.writable.getWriter();
				writer.write(compBytes);
				writer.close();
				const resp = new Response(ds.readable);
				const buf = await resp.arrayBuffer();
				decompressedBytes = new Uint8Array(buf);
			} catch (err) {
				throw new Error(
					`.xlsx ファイルの解凍に失敗しました (${fileName}): ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		} else {
			throw new Error(`未対応の圧縮形式 (${method}) が使用されています。`);
		}

		entries.set(fileName, textDecoder.decode(decompressedBytes));
	}

	return entries;
}

/**
 * ArrayBuffer または File から .xlsx をパースする
 */
export async function parseXlsx(
	file: File | ArrayBuffer,
): Promise<XlsxParseResult> {
	const byteLength = file instanceof File ? file.size : file.byteLength;
	if (byteLength > 20 * 1024 * 1024) {
		throw new Error('ファイルサイズが制限（20MB）を超えています。');
	}

	const buffer = file instanceof File ? await file.arrayBuffer() : file;
	const entries = await unzipXlsx(buffer);

	const workbookXml = entries.get('xl/workbook.xml');
	if (!workbookXml) {
		throw new Error(
			'有効な Excel ファイル構造が見つかりません (xl/workbook.xml 欠落)。',
		);
	}

	const wbDoc = parseXmlString(workbookXml);

	// 日付系設定 (1904)
	const wbPr = wbDoc.querySelector('workbookPr');
	const is1904 =
		wbPr?.getAttribute('date1904') === '1' ||
		wbPr?.getAttribute('date1904') === 'true';

	// シート一覧と rId
	const sheetNodes = wbDoc.querySelectorAll('sheet');
	const sheetList: { name: string; rId: string }[] = [];
	for (const sNode of sheetNodes) {
		const name = sNode.getAttribute('name') ?? 'Sheet';
		const rId = sNode.getAttribute('r:id') ?? sNode.getAttribute('id') ?? '';
		sheetList.push({ name, rId });
	}

	// rId -> sheetPath マッピング (xl/_rels/workbook.xml.rels)
	const relsPathMap = new Map<string, string>();
	const relsXml = entries.get('xl/_rels/workbook.xml.rels');
	if (relsXml) {
		const relsDoc = parseXmlString(relsXml);
		const relNodes = relsDoc.querySelectorAll('Relationship');
		for (const rNode of relNodes) {
			const id = rNode.getAttribute('Id');
			const target = rNode.getAttribute('Target');
			if (id && target) {
				const normalizedTarget = target.replace(/^\//, '');
				const fullPath = normalizedTarget.startsWith('xl/')
					? normalizedTarget
					: `xl/${normalizedTarget}`;
				relsPathMap.set(id, fullPath);
			}
		}
	}

	// Shared Strings 解析 (xl/sharedStrings.xml)
	const sharedStrings: string[] = [];
	const sstXml = entries.get('xl/sharedStrings.xml');
	if (sstXml) {
		const sstDoc = parseXmlString(sstXml);
		const siNodes = sstDoc.querySelectorAll('si');
		for (const si of siNodes) {
			const tNodes = si.querySelectorAll('t');
			const str = tNodes.map((t) => t.textContent).join('');
			sharedStrings.push(str);
		}
	}

	// Styles 解析 (xl/styles.xml) - 日付判定
	const dateStylesSet = new Set<number>();
	const stylesXml = entries.get('xl/styles.xml');
	if (stylesXml) {
		const stylesDoc = parseXmlString(stylesXml);
		const customDateFmts = new Set<number>();
		const numFmtNodes = stylesDoc.querySelectorAll('numFmt');
		for (const nf of numFmtNodes) {
			const id = Number(nf.getAttribute('numFmtId'));
			const code = (nf.getAttribute('formatCode') ?? '').toLowerCase();
			if (code && /[ymdhs年日月]/.test(code)) {
				customDateFmts.add(id);
			}
		}

		const cellXfsNode = stylesDoc.querySelector('cellXfs');
		const xfNodes = cellXfsNode ? cellXfsNode.querySelectorAll('xf') : [];
		let styleIdx = 0;
		for (const xf of xfNodes) {
			const numFmtId = Number(xf.getAttribute('numFmtId') ?? 0);
			const isBuiltInDate =
				(numFmtId >= 14 && numFmtId <= 22) ||
				(numFmtId >= 45 && numFmtId <= 47);
			if (isBuiltInDate || customDateFmts.has(numFmtId)) {
				dateStylesSet.add(styleIdx);
			}
			styleIdx++;
		}
	}

	// 各シートのパース
	const sheets: SheetData[] = [];
	for (let idx = 0; idx < sheetList.length; idx++) {
		const info = sheetList[idx];
		const sheetPath =
			relsPathMap.get(info.rId) ?? `xl/worksheets/sheet${idx + 1}.xml`;
		const sheetXml = entries.get(sheetPath);

		if (!sheetXml) {
			sheets.push({ name: info.name, rows: [] });
			continue;
		}

		const sheetDoc = parseXmlString(sheetXml);
		const cNodes = sheetDoc.querySelectorAll('c');

		let maxRow = 0;
		let maxCol = 0;
		const cellMap = new Map<string, string>();

		for (const cNode of cNodes) {
			const ref = cNode.getAttribute('r');
			if (!ref) continue;
			const { row, col } = cellRefToCoords(ref);
			if (row > maxRow) maxRow = row;
			if (col > maxCol) maxCol = col;

			const type = cNode.getAttribute('t');
			const styleIdx = Number(cNode.getAttribute('s') ?? -1);
			const vNode = cNode.querySelector('v');
			const rawVal = vNode ? vNode.textContent : '';

			let cellVal = '';
			if (type === 's') {
				const ssIdx = Number(rawVal);
				cellVal = sharedStrings[ssIdx] ?? '';
			} else if (type === 'inlineStr') {
				const tNodes = cNode.querySelectorAll('t');
				cellVal = tNodes.map((t) => t.textContent).join('');
			} else if (type === 'b') {
				cellVal = rawVal === '1' ? 'TRUE' : 'FALSE';
			} else if (type === 'str' || type === 'e') {
				cellVal = rawVal;
			} else {
				// 数値または日付
				if (rawVal !== '') {
					const num = Number(rawVal);
					if (!Number.isNaN(num) && dateStylesSet.has(styleIdx)) {
						cellVal = formatDateISO(excelSerialToDate(num, is1904));
					} else {
						cellVal = rawVal;
					}
				}
			}

			cellMap.set(`${row},${col}`, cellVal);
		}

		const rows: string[][] = [];
		for (let r = 0; r <= maxRow; r++) {
			const rowData: string[] = [];
			for (let c = 0; c <= maxCol; c++) {
				rowData.push(cellMap.get(`${r},${c}`) ?? '');
			}
			rows.push(rowData);
		}

		sheets.push({ name: info.name, rows });
	}

	return {
		sheets,
		activeSheet: 0,
	};
}
