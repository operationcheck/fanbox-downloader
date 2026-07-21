/**
 * Shared download utilities.
 */
export class DownloadUtils {
	audioExtension = /\.(mp3|m4a|ogg)$/;
	imageExtension = /\.(apng|avif|gif|jpg|jpeg|jfif|pjpeg|pjp|png|svg|webp)$/;
	videoExtension = /\.(mp4|webm|ogv)$/;

	isAudio(fileName: string): boolean {
		return fileName.match(this.audioExtension) != null;
	}

	isImage(fileName: string): boolean {
		return fileName.match(this.imageExtension) != null;
	}

	isVideo(fileName: string): boolean {
		return fileName.match(this.videoExtension) != null;
	}

	httpGetAs<T>(url: string): T {
		const request = new XMLHttpRequest();
		request.open('GET', url, false);
		request.withCredentials = true;
		request.send(null);
		return JSON.parse(request.responseText) as T;
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

	async sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async fetchWithLimit(
		{ url, name }: { url: string; name: string },
		limit: number,
	): Promise<Blob | null> {
		if (limit < 0) return null;
		try {
			const blob = await fetch(url)
				.catch((e: unknown) => {
					throw new Error(String(e));
				})
				.then((r) => (r.ok ? r.blob() : null));
			return blob ?? (await this.fetchWithLimit({ url, name }, limit - 1));
		} catch {
			console.error(`Network error: ${name}, ${url}`);
			await this.sleep(1000);
			return await this.fetchWithLimit({ url, name }, limit - 1);
		}
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
