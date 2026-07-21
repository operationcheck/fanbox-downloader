#!/usr/bin/env node
/**
 * Local Fanbox downloader (Node.js).
 *
 * Usage:
 *   pnpm download path/to/manifest.json
 *   pnpm download --out ./downloads path/to/manifest.json
 *   pnpm download --cookie "FANBOXSESSID=..." path/to/manifest.json
 *   pnpm download --cookie-file scripts/cookie.txt path/to/manifest.json
 *
 * Or paste the bookmarklet JSON into EMBEDDED_JSON / cookie into EMBEDDED_COOKIE
 * (or create scripts/download.json and scripts/cookie.txt), then:
 *   pnpm download
 *
 * Cookie priority:
 *   --cookie > --cookie-file > EMBEDDED_COOKIE > scripts/cookie.txt > FANBOX_COOKIE
 */

import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

/** Paste bookmarklet JSON here when not passing a .json file argument. */
const EMBEDDED_JSON = `
`;

/**
 * Paste the Cookie header value here (same as DevTools → Request Headers → cookie).
 * Example: FANBOXSESSID=...; consents=...
 */
const EMBEDDED_COOKIE = `
`;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JSON = path.join(scriptDir, 'download.json');
const DEFAULT_COOKIE_FILE = path.join(scriptDir, 'cookie.txt');

const fileMinIntervalMs = 1500;
const rateLimitBackoffMs = 60_000;
const transferFailBackoffMs = 30_000;
const transferCircuitBreakerMs = 120_000;
const transferCircuitBreakerThreshold = 2;
const largeFileCoolDownMsPerMiB = 80;
const maxRetries = 5;

let lastFileRequestAt = 0;
let consecutiveTransferFailures = 0;

function usage(exitCode = 0) {
	console.log(`Usage: node scripts/download-local.mjs [options] [manifest.json]

Options:
  --out <dir>          Output directory (default: ./downloads)
  --cookie <value>     Cookie header value
  --cookie-file <path> Read cookie from a text file (default: scripts/cookie.txt)
  --force              Re-download even if the local file already exists
  --help               Show this help

Cookie sources (highest priority first):
  --cookie, --cookie-file, EMBEDDED_COOKIE, scripts/cookie.txt, FANBOX_COOKIE

Manifest sources when no path is given:
  EMBEDDED_JSON, or scripts/download.json
`);
	process.exit(exitCode);
}

function parseArgs(argv) {
	const options = {
		out: path.resolve('downloads'),
		cookie: null,
		cookieFile: null,
		force: false,
		jsonPath: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') usage(0);
		if (arg === '--force') {
			options.force = true;
			continue;
		}
		if (arg === '--out') {
			options.out = path.resolve(argv[++i] ?? '');
			continue;
		}
		if (arg === '--cookie') {
			options.cookie = argv[++i] ?? '';
			continue;
		}
		if (arg === '--cookie-file') {
			options.cookieFile = path.resolve(argv[++i] ?? '');
			continue;
		}
		if (arg.startsWith('-')) {
			console.error(`Unknown option: ${arg}`);
			usage(1);
		}
		options.jsonPath = path.resolve(arg);
	}
	return options;
}

async function exists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function normalizeCookie(value) {
	return value
		.replace(/^\uFEFF/, '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'))
		.join('; ')
		.replace(/;\s*;/g, '; ')
		.trim();
}

async function resolveCookie(options) {
	if (options.cookie != null && options.cookie !== '') {
		return { cookie: normalizeCookie(options.cookie), source: '--cookie' };
	}

	if (options.cookieFile) {
		if (!(await exists(options.cookieFile))) {
			throw new Error(`Cookie file not found: ${options.cookieFile}`);
		}
		const text = await readFile(options.cookieFile, 'utf8');
		return { cookie: normalizeCookie(text), source: options.cookieFile };
	}

	const embedded = normalizeCookie(EMBEDDED_COOKIE);
	if (embedded) {
		return { cookie: embedded, source: 'EMBEDDED_COOKIE' };
	}

	if (await exists(DEFAULT_COOKIE_FILE)) {
		const text = await readFile(DEFAULT_COOKIE_FILE, 'utf8');
		const cookie = normalizeCookie(text);
		if (cookie) {
			return { cookie, source: DEFAULT_COOKIE_FILE };
		}
	}

	const fromEnv = normalizeCookie(process.env.FANBOX_COOKIE || '');
	if (fromEnv) {
		return { cookie: fromEnv, source: 'FANBOX_COOKIE' };
	}

	return { cookie: '', source: 'none' };
}

async function loadManifest(jsonPath) {
	if (jsonPath) {
		const text = await readFile(jsonPath, 'utf8');
		return JSON.parse(text);
	}
	const embedded = EMBEDDED_JSON.trim();
	if (embedded) {
		return JSON.parse(embedded);
	}
	if (await exists(DEFAULT_JSON)) {
		const text = await readFile(DEFAULT_JSON, 'utf8');
		return JSON.parse(text);
	}
	console.error(
		'No JSON provided. Pass a .json path, paste into EMBEDDED_JSON, or create scripts/download.json',
	);
	usage(1);
}

function assertManifest(obj) {
	if (typeof obj !== 'object' || obj === null) throw new Error('Manifest must be an object');
	if (typeof obj.id !== 'string') throw new Error('Manifest.id must be a string');
	if (!Array.isArray(obj.posts)) throw new Error('Manifest.posts must be an array');
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace() {
	const waitMs = lastFileRequestAt + fileMinIntervalMs - Date.now();
	if (waitMs > 0) await sleep(waitMs);
	lastFileRequestAt = Date.now();
}

function parseRetryAfterMs(response, attempt) {
	const retryAfter = response.headers.get('Retry-After');
	if (retryAfter) {
		const asSeconds = Number(retryAfter);
		if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
			return Math.max(1000, asSeconds * 1000);
		}
		const asDate = Date.parse(retryAfter);
		if (!Number.isNaN(asDate)) {
			return Math.max(1000, asDate - Date.now());
		}
	}
	return rateLimitBackoffMs * 2 ** attempt;
}

async function coolDownAfterSuccess(byteLength) {
	const miB = byteLength / (1024 * 1024);
	const extraMs = Math.min(45_000, Math.floor(miB * largeFileCoolDownMsPerMiB));
	if (extraMs > 0) {
		console.warn(`  cool-down ${extraMs}ms after ${miB.toFixed(1)} MiB`);
		await sleep(extraMs);
	}
}

async function coolDownAfterTransferFailure(attempt, name) {
	consecutiveTransferFailures++;
	let waitMs = transferFailBackoffMs * 2 ** Math.min(attempt, 3);
	if (consecutiveTransferFailures >= transferCircuitBreakerThreshold) {
		waitMs = Math.max(waitMs, transferCircuitBreakerMs);
		console.warn(
			`  circuit breaker (${consecutiveTransferFailures} failures), waiting ${waitMs}ms: ${name}`,
		);
	} else {
		console.warn(`  transfer failed, waiting ${waitMs}ms: ${name}`);
	}
	await sleep(waitMs);
}

function buildHeaders(url, cookie) {
	const headers = {
		'User-Agent':
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
		Accept: '*/*',
	};
	if (url.includes('pximg.net')) {
		headers.Referer = 'https://www.fanbox.cc/';
	} else {
		headers.Referer = 'https://downloads.fanbox.cc/';
		headers.Origin = 'https://downloads.fanbox.cc';
	}
	if (cookie) headers.Cookie = cookie;
	return headers;
}

async function downloadToFile(url, destPath, { cookie, force }) {
	if (!force && (await exists(destPath))) {
		const local = await stat(destPath);
		if (local.size > 0) {
			console.log(`  skip existing ${path.basename(destPath)} (${local.size} bytes)`);
			return 'skipped';
		}
	}

	await mkdir(path.dirname(destPath), { recursive: true });
	const tmpPath = `${destPath}.part`;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		await pace();
		try {
			const response = await fetch(url, {
				headers: buildHeaders(url, cookie),
				redirect: 'follow',
			});

			if (response.status === 429 || response.status === 503) {
				if (attempt >= maxRetries) return 'failed';
				const waitMs = parseRetryAfterMs(response, attempt);
				console.warn(`  rate limited (${response.status}), waiting ${waitMs}ms`);
				await sleep(waitMs);
				continue;
			}
			if (!response.ok) {
				console.error(`  HTTP ${response.status} for ${url}`);
				if (attempt >= maxRetries) return 'failed';
				await sleep(2000 * 2 ** attempt);
				continue;
			}
			if (!response.body) {
				throw new Error('Response has no body');
			}

			const expected = Number(response.headers.get('Content-Length'));
			await pipeline(Readable.fromWeb(response.body), createWriteStream(tmpPath));
			const written = await stat(tmpPath);
			if (Number.isFinite(expected) && expected > 0 && written.size < expected * 0.98) {
				throw new Error(`Incomplete body: got ${written.size}/${expected} bytes`);
			}

			await rename(tmpPath, destPath);
			consecutiveTransferFailures = 0;
			console.log(`  saved ${path.basename(destPath)} (${written.size} bytes)`);
			await coolDownAfterSuccess(written.size);
			return 'ok';
		} catch (e) {
			console.error(`  error: ${e instanceof Error ? e.message : String(e)}`);
			try {
				await unlink(tmpPath);
			} catch {
				/* ignore */
			}
			if (attempt >= maxRetries) break;
			await coolDownAfterTransferFailure(attempt, path.basename(destPath));
		}
	}
	return 'failed';
}

function formatInfo(informationText) {
	try {
		return {
			name: 'info.json',
			content: `${JSON.stringify(JSON.parse(informationText), null, '\t')}\n`,
		};
	} catch {
		return { name: 'info.txt', content: informationText };
	}
}

function postHtml(title, body) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
</head>
<body>
${body}
</body>
</html>
`;
}

function escapeHtml(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const manifest = await loadManifest(options.jsonPath);
	assertManifest(manifest);

	const { cookie, source: cookieSource } = await resolveCookie(options);
	options.cookie = cookie;
	if (cookie) {
		console.log(`Cookie: loaded from ${cookieSource} (${cookie.length} chars)`);
	} else {
		console.warn(
			'Cookie: not set. Member-only files on downloads.fanbox.cc will likely fail.\n' +
				'Set via --cookie, --cookie-file, EMBEDDED_COOKIE, scripts/cookie.txt, or FANBOX_COOKIE.',
		);
	}

	const root = path.join(options.out, manifest.id);
	await mkdir(root, { recursive: true });
	console.log(`Output: ${root}`);
	console.log(`Posts: ${manifest.postCount ?? manifest.posts.length}`);
	console.log(`Files: ${manifest.fileCount ?? '?'}`);

	const failed = [];
	let done = 0;
	const total =
		manifest.fileCount ??
		manifest.posts.reduce((n, p) => n + p.files.length + (p.cover ? 1 : 0), 0);

	for (const [index, post] of manifest.posts.entries()) {
		const postDir = path.join(root, post.encodedName);
		await mkdir(postDir, { recursive: true });
		console.log(`\n[${index + 1}/${manifest.posts.length}] ${post.originalName}`);

		const info = formatInfo(post.informationText);
		await writeFile(path.join(postDir, info.name), info.content, 'utf8');
		await writeFile(
			path.join(postDir, 'index.html'),
			postHtml(post.originalName, post.htmlText),
			'utf8',
		);

		if (post.cover) {
			const dest = path.join(postDir, post.cover.name);
			console.log(`cover ${post.cover.name}`);
			const result = await downloadToFile(post.cover.url, dest, options);
			if (result === 'failed') failed.push({ url: post.cover.url, dest, name: post.cover.name });
			done++;
			console.log(`progress ${done}/${total}`);
		}

		for (const [fileIndex, file] of post.files.entries()) {
			const dest = path.join(postDir, file.encodedName);
			console.log(`file ${file.encodedName} (${fileIndex + 1}/${post.files.length})`);
			const result = await downloadToFile(file.url, dest, options);
			if (result === 'failed') {
				failed.push({ url: file.url, dest, name: file.encodedName });
			}
			done++;
			console.log(`progress ${done}/${total}`);
		}
	}

	if (failed.length > 0) {
		console.log(
			`\nCooling down ${transferCircuitBreakerMs / 1000}s then retrying ${failed.length} failed file(s)...`,
		);
		await sleep(transferCircuitBreakerMs);
		const stillFailed = [];
		for (const item of failed) {
			console.log(`retry ${item.name}`);
			const result = await downloadToFile(item.url, item.dest, { ...options, force: true });
			if (result === 'failed') stillFailed.push(item.name);
		}
		if (stillFailed.length > 0) {
			console.error(`\nStill missing ${stillFailed.length} file(s):`);
			for (const name of stillFailed) console.error(`  - ${name}`);
			process.exitCode = 1;
		} else {
			console.log('\nAll previously failed files recovered.');
		}
	} else {
		console.log('\nDone.');
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
