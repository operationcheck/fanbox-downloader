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
	fileMinIntervalMs = 500;

	/** Base wait when receiving HTTP 429 / 503 */
	rateLimitBackoffMs = 60_000;

	/** Max retries after rate-limit / transient failures */
	maxRetries = 5;

	private lastApiRequestAt = 0;
	private lastFileRequestAt = 0;

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

	async fetchWithLimit(
		{ url, name }: { url: string; name: string },
		limit: number,
	): Promise<Blob | null> {
		if (limit < 0) return null;

		for (let attempt = 0; attempt <= limit; attempt++) {
			await this.pace('file');
			try {
				const response = await fetch(url, { credentials: 'include' });
				if (response.status === 429 || response.status === 503) {
					const waitMs = this.parseRetryAfterMs(response, attempt);
					console.warn(`Rate limited downloading ${name}, waiting ${waitMs}ms`);
					await this.sleep(waitMs);
					continue;
				}
				if (!response.ok) {
					console.error(`Failed to download ${name}: HTTP ${response.status}`);
					await this.sleep(1000);
					continue;
				}
				return await response.blob();
			} catch (e) {
				console.error(`Network error: ${name}, ${url}`, e);
				await this.sleep(1000 * 2 ** attempt);
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
