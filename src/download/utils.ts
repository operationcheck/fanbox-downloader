/**
 * Shared download utilities with request pacing and rate-limit retries.
 */
export class DownloadUtils {
	audioExtension = /\.(mp3|m4a|ogg)$/;
	imageExtension = /\.(apng|avif|gif|jpg|jpeg|jfif|pjpeg|pjp|png|svg|webp)$/;
	videoExtension = /\.(mp4|webm|ogv)$/;

	/** Minimum gap between Fanbox API requests */
	apiMinIntervalMs = 1500;

	/** Minimum gap between file download requests */
	fileMinIntervalMs = 1500;

	/** Base wait when receiving HTTP 429 / 503 */
	rateLimitBackoffMs = 60_000;

	/** Base wait when a transfer aborts mid-body (net::ERR_FAILED etc.) */
	transferFailBackoffMs = 30_000;

	/** Cool-down after several consecutive transfer failures */
	transferCircuitBreakerMs = 120_000;

	/** Consecutive transfer failures before applying the circuit-breaker cool-down */
	transferCircuitBreakerThreshold = 2;

	/** Extra pause after large successful downloads (ms per MiB, capped) */
	largeFileCoolDownMsPerMiB = 80;

	/** Max retries after rate-limit / transient failures */
	maxRetries = 5;

	private lastApiRequestAt = 0;
	private lastFileRequestAt = 0;
	private consecutiveTransferFailures = 0;

	isAudio(fileName: string): boolean {
		return fileName.match(this.audioExtension) != null;
	}

	isImage(fileName: string): boolean {
		return fileName.match(this.imageExtension) != null;
	}

	isVideo(fileName: string): boolean {
		return fileName.match(this.videoExtension) != null;
	}

	async sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async pace(kind: 'api' | 'file') {
		const minInterval = kind === 'api' ? this.apiMinIntervalMs : this.fileMinIntervalMs;
		const lastAt = kind === 'api' ? this.lastApiRequestAt : this.lastFileRequestAt;
		const waitMs = lastAt + minInterval - Date.now();
		if (waitMs > 0) {
			await this.sleep(waitMs);
		}
		if (kind === 'api') {
			this.lastApiRequestAt = Date.now();
		} else {
			this.lastFileRequestAt = Date.now();
		}
	}

	private parseRetryAfterMs(response: Response, attempt: number): number {
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
		return this.rateLimitBackoffMs * 2 ** attempt;
	}

	/**
	 * Fanbox JSON API GET with pacing and 429/503 retries.
	 */
	async httpGetAs<T>(url: string): Promise<T> {
		for (let attempt = 0; ; attempt++) {
			await this.pace('api');
			let response: Response;
			try {
				response = await fetch(url, {
					credentials: 'include',
					headers: {
						Accept: 'application/json, text/plain, */*',
						Origin: window.location.origin.includes('fanbox.cc')
							? window.location.origin
							: 'https://www.fanbox.cc',
						Referer: window.location.origin.includes('fanbox.cc')
							? `${window.location.origin}/`
							: 'https://www.fanbox.cc/',
					},
				});
			} catch (e) {
				if (attempt >= this.maxRetries) {
					throw new Error(`Network error fetching ${url}`, { cause: e });
				}
				const waitMs = this.rateLimitBackoffMs * 2 ** attempt;
				console.warn(`Network error, retrying in ${waitMs}ms: ${url}`, e);
				await this.sleep(waitMs);
				continue;
			}

			if (response.status === 429 || response.status === 503) {
				if (attempt >= this.maxRetries) {
					throw new Error(`Rate limited (${response.status}): ${url}`);
				}
				const waitMs = this.parseRetryAfterMs(response, attempt);
				console.warn(`Rate limited (${response.status}), waiting ${waitMs}ms: ${url}`);
				await this.sleep(waitMs);
				continue;
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} fetching ${url}`);
			}

			return (await response.json()) as T;
		}
	}

	/** Escape characters that are invalid in Windows filenames */
	encodeFileName(name: string): string {
		return name
			.replace(/\//g, '／')
			.replace(/\\/g, '＼')
			.replace(/,/g, '，')
			.replace(/:/g, '：')
			.replace(/\*/g, '＊')
			.replace(/"/g, '“')
			.replace(/</g, '＜')
			.replace(/>/g, '＞')
			.replace(/\|/g, '｜')
			.trimEnd();
	}

	/** Encode a path segment for use in HTML hrefs */
	encodeUri(name: string): string {
		return this.encodeFileName(name).replaceAll(/[;,/?:@&=+$#]/g, encodeURIComponent);
	}

	splitExt(name: string): string[] {
		return name.split(/(?=\.[^.]+$)/);
	}

	getFileName(
		name: string,
		extension: string,
		length: number,
		index: number,
		isAsc: boolean,
	): string {
		if (length <= 1) return `${name}${extension}`;
		return isAsc ? `${name}_${index + 1}${extension}` : `${name}_${length - index}${extension}`;
	}

	toQuoted(value: string): string {
		return `'${value.replaceAll("'", "\\'")}'`;
	}

	createInformationFile(informationText: string): { name: string; content: BlobPart[] } {
		try {
			const json = JSON.stringify(JSON.parse(informationText), null, '\t');
			return { name: 'info.json', content: [json] };
		} catch {
			return { name: 'info.txt', content: [informationText] };
		}
	}

	private async coolDownAfterSuccess(byteLength: number) {
		const miB = byteLength / (1024 * 1024);
		const extraMs = Math.min(45_000, Math.floor(miB * this.largeFileCoolDownMsPerMiB));
		if (extraMs > 0) {
			console.warn(`Cooling down ${extraMs}ms after ${miB.toFixed(1)} MiB download`);
			await this.sleep(extraMs);
		}
	}

	private async coolDownAfterTransferFailure(attempt: number, name: string) {
		this.consecutiveTransferFailures++;
		let waitMs = this.transferFailBackoffMs * 2 ** Math.min(attempt, 3);
		if (this.consecutiveTransferFailures >= this.transferCircuitBreakerThreshold) {
			waitMs = Math.max(waitMs, this.transferCircuitBreakerMs);
			console.warn(
				`Transfer circuit breaker (${this.consecutiveTransferFailures} failures), waiting ${waitMs}ms before retry: ${name}`,
			);
		} else {
			console.warn(`Transfer failed, waiting ${waitMs}ms before retry: ${name}`);
		}
		await this.sleep(waitMs);
	}

	/**
	 * Download a file with pacing, incomplete-body checks, and long backoff on aborts.
	 * Returns null when all retries are exhausted (caller should skip and continue).
	 */
	async fetchWithLimit(
		{ url, name }: { url: string; name: string },
		limit: number = 5,
	): Promise<Blob | null> {
		if (limit < 0) return null;

		for (let attempt = 0; attempt <= limit; attempt++) {
			await this.pace('file');
			try {
				// pximg serves ACAO: *; credentialed fetches are rejected by the browser.
				// same-origin keeps cookies for downloads.fanbox.cc and omits them cross-origin.
				const response = await fetch(url, { credentials: 'same-origin' });
				if (response.status === 429 || response.status === 503) {
					if (attempt >= limit) return null;
					const waitMs = this.parseRetryAfterMs(response, attempt);
					console.warn(`Rate limited downloading ${name}, waiting ${waitMs}ms`);
					await this.sleep(waitMs);
					continue;
				}
				if (!response.ok) {
					console.error(`Failed to download ${name}: HTTP ${response.status}`);
					if (attempt >= limit) return null;
					await this.sleep(2000 * 2 ** attempt);
					continue;
				}

				const expected = Number(response.headers.get('Content-Length'));
				const blob = await response.blob();
				if (Number.isFinite(expected) && expected > 0 && blob.size < expected * 0.98) {
					throw new Error(`Incomplete body for ${name}: got ${blob.size}/${expected} bytes`);
				}

				this.consecutiveTransferFailures = 0;
				await this.coolDownAfterSuccess(blob.size);
				return blob;
			} catch (e) {
				console.error(`Network/transfer error: ${name}, ${url}`, e);
				if (attempt >= limit) break;
				await this.coolDownAfterTransferFailure(attempt, name);
			}
		}
		return null;
	}

	async embedScript(url: string) {
		return new Promise<HTMLScriptElement>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = url;
			script.addEventListener('load', () => resolve(script), { once: true });
			script.addEventListener('error', (e) => reject(e), { once: true });
			document.head.appendChild(script);
		});
	}
}
