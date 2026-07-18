// 既知のAI関連クローラー・エージェントのUser-Agent識別子（部分一致・小文字比較）。
// 追加・更新はこのリストのみで完結させる。
export const AI_AGENT_USER_AGENTS = [
	'gptbot',
	'oai-searchbot',
	'chatgpt-user',
	'claudebot',
	'claude-user',
	'claude-searchbot',
	'anthropic-ai',
	'perplexitybot',
	'perplexity-user',
	'google-extended',
	'applebot-extended',
	'bytespider',
	'amazonbot',
	'cohere-ai',
	'meta-externalagent',
	'diffbot',
];

// 既知の検索エンジン・アーカイブ用クローラーのUser-Agent識別子（AI用途ではないもの）。
export const CRAWLER_USER_AGENTS = [
	'googlebot',
	'bingbot',
	'duckduckbot',
	'baiduspider',
	'yandexbot',
	'slurp',
	'ccbot',
	'facebookexternalhit',
	'twitterbot',
	'linkedinbot',
	'archive.org_bot',
];

// AI/検索クローラーとして未登録だが、自動化・スクレイピングを示唆する一般的なキーワード。
export const GENERIC_BOT_KEYWORDS = [
	'bot',
	'spider',
	'crawler',
	'curl',
	'wget',
	'python-requests',
	'scrapy',
	'headlesschrome',
	'phantomjs',
	'axios',
	'go-http-client',
];
