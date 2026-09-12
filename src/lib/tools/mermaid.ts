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
 * MermaidコードをSVG文字列としてレンダリングする
 */
export async function renderMermaidSvg(
	code: string,
	containerId: string,
	theme: 'default' | 'neutral' | 'dark' | 'forest' = 'default',
): Promise<{ svg: string }> {
	if (code.length > MAX_INPUT_LENGTH) {
		throw new Error(
			`入力サイズが上限（${MAX_INPUT_LENGTH.toLocaleString()}文字）を超えています。`,
		);
	}

	const mermaidModule = await import('mermaid');
	const mermaid = mermaidModule.default;

	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'strict',
		theme,
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
