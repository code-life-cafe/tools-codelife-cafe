import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyTrafficType } from '../../functions/lib/traffic-type.ts';

test('UAが空・未指定の場合はunknownを返す', () => {
	assert.strictEqual(classifyTrafficType(null, undefined), 'unknown');
	assert.strictEqual(classifyTrafficType('', undefined), 'unknown');
});

test('既知のAIエージェント・クローラーUAはai_agentと判定する', () => {
	assert.strictEqual(classifyTrafficType('GPTBot/1.0', undefined), 'ai_agent');
	assert.strictEqual(
		classifyTrafficType('Mozilla/5.0 (compatible; ClaudeBot/1.0)', undefined),
		'ai_agent',
	);
	assert.strictEqual(
		classifyTrafficType('PerplexityBot/1.0', undefined),
		'ai_agent',
	);
});

test('既知の検索クローラーUAはcrawlerと判定する', () => {
	assert.strictEqual(
		classifyTrafficType('Mozilla/5.0 (compatible; Googlebot/2.1)', undefined),
		'crawler',
	);
	assert.strictEqual(classifyTrafficType('bingbot/2.0', undefined), 'crawler');
	assert.strictEqual(classifyTrafficType('CCBot/2.0', undefined), 'crawler');
});

test('未登録の汎用bot/スクレイパー系キーワードはcrawlerと判定する', () => {
	assert.strictEqual(classifyTrafficType('curl/8.0', undefined), 'crawler');
	assert.strictEqual(
		classifyTrafficType('python-requests/2.31', undefined),
		'crawler',
	);
});

test('通常ブラウザUAかつwebdriver未検知はhumanと判定する', () => {
	assert.strictEqual(
		classifyTrafficType(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
			false,
		),
		'human',
	);
});

test('通常ブラウザUAでもnavigator.webdriver=trueならunknownと判定する', () => {
	assert.strictEqual(
		classifyTrafficType(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
			true,
		),
		'unknown',
	);
});

test('大文字小文字を区別せず判定する', () => {
	assert.strictEqual(
		classifyTrafficType('GOOGLEBOT/2.1', undefined),
		'crawler',
	);
});
