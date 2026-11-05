import { exceedsMaxCharacters } from '../string-length.ts';
/**
 * Mermaidレンダリング・エクスポート共通ロジック
 * 完全クライアントサイド・securityLevel: 'strict' で動作
 */

export const MAX_INPUT_LENGTH = 100_000;

export const SAMPLE_MERMAID_CODES: Record<
	string,
	{ label: string; code: string }
> = {
	flowchart: {
		label: 'フローチャート',
		code: `flowchart TD
    A[ユーザー登録申請] --> B{入力検証}
    B -->|OK| C[認証コード送信]
    B -->|NG| D[エラーメッセージ表示]
    C --> E[本登録完了]`,
	},
	sequence: {
		label: 'シーケンス図',
		code: `sequenceDiagram
    actor ユーザー
    participant ブラウザ
    participant サーバー
    ユーザー->>ブラウザ: ログインボタン押下
    ブラウザ->>サーバー: 認証リクエスト
    サーバー-->>ブラウザ: トークン発行
    ブラウザ-->>ユーザー: ダッシュボード表示`,
	},
	classDiagram: {
		label: 'クラス図',
		code: `classDiagram
    class ユーザー {
        +String 氏名
        +String メールアドレス
        +ログイン() boolean
    }
    class 注文 {
        +int 注文番号
        +Date 注文日時
        +決済処理()
    }
    ユーザー "1" --> "*" 注文 : 発注する`,
	},
	stateDiagram: {
		label: 'ステート図',
		code: `stateDiagram-v2
    [*] --> 申請中
    申請中 --> 審査中 : 書類受理
    審査中 --> 承認 : 合格
    審査中 --> 却下 : 不備
    承認 --> [*]
    却下 --> [*]`,
	},
	erDiagram: {
		label: 'ER図',
		code: `erDiagram
    CUSTOMER ||--o{ ORDER : "注文する"
    ORDER ||--|{ ORDER_ITEM : "含む"
    PRODUCT ||--o{ ORDER_ITEM : "参照される"`,
	},
	gantt: {
		label: 'ガントチャート',
		code: `gantt
    title 開発マイルストーン
    dateFormat YYYY-MM-DD
    section 企画
    要件定義 :done, des1, 2026-03-01, 2026-03-10
    UI設計   :active, des2, 2026-03-11, 2026-03-20
    section 実装
    機能開発 :crit, dev1, 2026-03-21, 2026-04-10
    テスト   :test1, 2026-04-11, 10d`,
	},
};

/**
 * モノクロテーマ（ライト/ダーク）用の Mermaid テーマ変数。
 * サイトのライト/ダークモードに追従させるため 'base' テーマへ上書き適用する。
 */
export const MONO_THEME_VARIABLES = {
	light: {
		background: '#ffffff',
		primaryColor: '#f5f5f5',
		primaryTextColor: '#171717',
		primaryBorderColor: '#262626',
		lineColor: '#404040',
		secondaryColor: '#e5e5e5',
		tertiaryColor: '#d4d4d4',
		textColor: '#171717',
		mainBkg: '#f5f5f5',
		nodeTextColor: '#171717',
		clusterBkg: '#e5e5e5',
		clusterBorder: '#737373',
		edgeLabelBackground: '#ffffff',
		actorBkg: '#f5f5f5',
		actorBorder: '#262626',
		actorTextColor: '#171717',
		actorLineColor: '#404040',
		signalColor: '#262626',
		signalTextColor: '#171717',
		labelBoxBkgColor: '#f5f5f5',
		labelBoxBorderColor: '#262626',
		labelTextColor: '#171717',
		noteBkgColor: '#e5e5e5',
		noteBorderColor: '#737373',
		noteTextColor: '#171717',
	},
	dark: {
		background: '#171717',
		primaryColor: '#262626',
		primaryTextColor: '#f5f5f5',
		primaryBorderColor: '#a3a3a3',
		lineColor: '#a3a3a3',
		secondaryColor: '#404040',
		tertiaryColor: '#525252',
		textColor: '#f5f5f5',
		mainBkg: '#262626',
		nodeTextColor: '#f5f5f5',
		clusterBkg: '#404040',
		clusterBorder: '#a3a3a3',
		edgeLabelBackground: '#171717',
		actorBkg: '#262626',
		actorBorder: '#a3a3a3',
		actorTextColor: '#f5f5f5',
		actorLineColor: '#a3a3a3',
		signalColor: '#d4d4d4',
		signalTextColor: '#f5f5f5',
		labelBoxBkgColor: '#262626',
		labelBoxBorderColor: '#a3a3a3',
		labelTextColor: '#f5f5f5',
		noteBkgColor: '#404040',
		noteBorderColor: '#a3a3a3',
		noteTextColor: '#f5f5f5',
	},
} as const;

/** Mermaid 11.17.2 の src/preprocess.ts の cleanupText と同じ順序で正規化する。 */
function normalizeMermaidText(code: string): string {
	return code
		.replace(/\r\n?/g, '\n')
		.replace(
			/<(\w+)([^>]*)>/g,
			(_match, tag: string, attributes: string) =>
				`<${tag}${attributes.replace(/="([^"]*)"/g, "='$1'")}>`,
		);
}

/** 正規化の前後それぞれに適用する、拡張ノードの画像検査。 */
async function assertNoImagesInMermaidSource(code: string): Promise<void> {
	// Mermaid同様、行頭の %% だけを除去し、%%{ ディレクティブは残す。
	// 空行をまたぐ \s* の再探索を避け、コメント除去も線形時間にする。
	const source = code.replace(/^[^\S\r\n\u2028\u2029]*%%(?!{)[^\n]+\n?/gm, '');
	let metadataStart = -1;
	let quoted = false;
	let yamlModule: typeof import('js-yaml') | undefined;
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		// 通常ラベルや引用符内も含め、どの位置の @{ も検査する。
		// 入れ子は解釈が曖昧なため拒否し、同じ末尾を繰り返し探索しない。
		if (char === '@' && source[index + 1] === '{') {
			if (metadataStart !== -1) {
				throw new Error('拡張ノードの構文を確認してください。');
			}
			metadataStart = index + 2;
			quoted = false;
			index++;
			continue;
		}
		if (metadataStart === -1) continue;
		// Mermaidの拡張ノードと同様、二重引用符内の } は終端にしない。
		if (char === '"') quoted = !quoted;
		if (char !== '}' || quoted) continue;
		const metadata = source.slice(metadataStart, index);
		metadataStart = -1;
		// Mermaidのlexerは引用ラベル内の改行を <br/> に正規化する。
		const normalized = metadata.replace(/"[^"]*"/g, (quoted) =>
			quoted.replace(/\n\s*/g, '<br/>'),
		);
		// Mermaidと同じJSON_SCHEMAで、引用キーやエスケープも解釈する。
		const yaml = normalized.includes('\n')
			? `${normalized}\n`
			: `{\n${normalized}\n}`;
		// Mermaidと同じく描画前に遅延ロードし、初期バンドルへ含めない。
		yamlModule ??= await import('js-yaml');
		let node: unknown;
		try {
			node = yamlModule.load(yaml, { schema: yamlModule.JSON_SCHEMA });
		} catch {
			throw new Error('拡張ノードの構文を確認してください。');
		}
		if (node && typeof node === 'object' && 'img' in node) {
			throw new Error(
				'外部リソースの取得を防ぐため、画像構文（img）は利用できません。',
			);
		}
	}
	if (metadataStart !== -1) {
		throw new Error('拡張ノードの構文を確認してください。');
	}
}

/** imgを含む拡張ノードは、描画中にImage.srcへ渡されるため事前に拒否する。 */
export async function assertMermaidNoExternalImages(
	code: string,
): Promise<void> {
	await assertNoImagesInMermaidSource(code);
	// cleanupText はコメント除去・構文解析より前に適用される。
	// 正規化で現れる画像も、逆に隠れる画像も許可しない。
	const normalized = normalizeMermaidText(code);
	if (normalized !== code) await assertNoImagesInMermaidSource(normalized);
}

/**
 * MermaidコードをSVG文字列としてレンダリングする
 */
export async function renderMermaidSvg(
	code: string,
	containerId: string,
	theme: 'default' | 'dark' | 'forest' | 'base' = 'default',
	themeVariables?: Record<string, string>,
	renderLimits?: {
		maxEdges: number;
		maxTextSize: number;
		htmlLabels?: boolean;
	},
): Promise<{ svg: string }> {
	if (exceedsMaxCharacters(code, MAX_INPUT_LENGTH)) {
		throw new Error(
			`入力サイズが上限（${MAX_INPUT_LENGTH.toLocaleString()}文字）を超えています。`,
		);
	}

	await assertMermaidNoExternalImages(code);
	const mermaidModule = await import('mermaid');
	const mermaid = mermaidModule.default;

	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme,
		themeVariables,
		...renderLimits,
		fontFamily:
			'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
	});

	// ユニークなIDでレンダリング
	const renderId = `mermaid-render-${containerId}-${Date.now()}`;
	const { svg } = await mermaid.render(renderId, code);

	return { svg };
}

/**
 * SVG要素をPNG Blobに変換する（オフスクリーンCanvasを使用）
 */
export async function exportSvgToPng(
	svgElement: SVGSVGElement,
	scale = 2,
): Promise<Blob> {
	const svgString = new XMLSerializer().serializeToString(svgElement);
	const svgBlob = new Blob([svgString], {
		type: 'image/svg+xml;charset=utf-8',
	});
	const url = URL.createObjectURL(svgBlob);

	try {
		const img = new Image();
		img.crossOrigin = 'anonymous';

		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('SVG画像の読み込みに失敗しました'));
			img.src = url;
		});

		const rect = svgElement.getBoundingClientRect();
		const width = (rect.width || 800) * scale;
		const height = (rect.height || 600) * scale;

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Canvas 2Dコンテキストの初期化に失敗しました');
		}

		// 背景を白で塗りつぶし
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(img, 0, 0, width, height);

		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('PNG変換に失敗しました'));
				}
			}, 'image/png');
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}
