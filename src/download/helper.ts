import type { DownloadJsonObj } from './types';
import { DownloadUtils } from './utils';

declare const streamSaver: {
	createWriteStream: (
		fileName: string,
		options?: {
			size: null;
			pathname: null;
			writableStrategy: undefined;
			readableStrategy: undefined;
		},
	) => WritableStream;
};

declare const createWriter: new (underlyingSource: {
	pull: (ctrl: { enqueue: (file: File) => void; close: () => void }) => Promise<void>;
}) => ReadableStream & { pull: () => void };

function preventUnloadWhileDownloading(event: BeforeUnloadEvent) {
	event.returnValue = 'downloading';
}

/**
 * Download UI and ZIP packaging.
 */
export class DownloadHelper {
	private readonly utils: DownloadUtils;

	constructor(utils: DownloadUtils) {
		this.utils = utils;
	}

	bootCSS = {
		href: 'https://cdn.jsdelivr.net/npm/bootstrap@5.0.0-beta1/dist/css/bootstrap.min.css',
		integrity: 'sha384-giJF6kkoqNQ00vy+HMDP7azOuL0xtbfIcaT9wjKHr8RbDVddVHyTfAAsrekwKmP1',
	};

	bootJS = {
		src: 'https://cdn.jsdelivr.net/npm/bootstrap@5.0.0-beta1/dist/js/bootstrap.bundle.min.js',
		integrity: 'sha384-ygbV9kiqUc6oa4msXn9868pTtWMgiQaeYH7/t7LECLbyPA2x65Kgf80OJFdroafW',
	};

	vueJS = {
		src: 'https://unpkg.com/vue@3.2.28/dist/vue.global.js',
	};

	async createDownloadUI(title: string) {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
		document.getElementsByTagName('html')[0].style.height = '100%';
		document.body.style.height = '100%';
		document.body.style.margin = '0';
		document.title = title;

		const bootLink = document.createElement('link');
		bootLink.href = this.bootCSS.href;
		bootLink.rel = 'stylesheet';
		bootLink.integrity = this.bootCSS.integrity;
		bootLink.crossOrigin = 'anonymous';
		document.head.appendChild(bootLink);

		const bodyDiv = document.createElement('div');
		bodyDiv.style.display = 'flex';
		bodyDiv.style.alignItems = 'center';
		bodyDiv.style.justifyContent = 'center';
		bodyDiv.style.flexDirection = 'column';
		bodyDiv.style.height = '100%';

		const inputDiv = document.createElement('div');
		inputDiv.className = 'input-group mb-2';
		inputDiv.style.width = '400px';

		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'form-control';
		input.placeholder = 'Paste JSON here';
		inputDiv.appendChild(input);

		const buttonDiv = document.createElement('div');
		buttonDiv.className = 'input-group-append';
		const button = document.createElement('button');
		button.className = 'btn btn-outline-secondary btn-labeled';
		button.type = 'button';
		button.innerText = 'Download';
		buttonDiv.appendChild(button);
		inputDiv.appendChild(buttonDiv);
		bodyDiv.appendChild(inputDiv);

		const progressDiv = document.createElement('div');
		progressDiv.className = 'progress mb-3';
		progressDiv.style.width = '400px';
		const progress = document.createElement('div');
		progress.className = 'progress-bar';
		progress.setAttribute('role', 'progressbar');
		progress.setAttribute('aria-valuemin', '0');
		progress.setAttribute('aria-valuemax', '100');
		progress.setAttribute('aria-valuenow', '0');
		progress.style.width = '0%';
		progress.innerText = '0%';
		const setProgress = (n: number) => {
			progress.setAttribute('aria-valuenow', `${n}`);
			progress.style.width = `${n}%`;
			progress.innerText = `${n}%`;
		};
		progressDiv.appendChild(progress);
		bodyDiv.appendChild(progressDiv);

		const infoDiv = document.createElement('div');
		infoDiv.style.width = '350px';
		const checkBoxDiv = document.createElement('div');
		checkBoxDiv.className = 'form-check float-start';
		const checkBox = document.createElement('input');
		checkBox.className = 'form-check-input';
		checkBox.type = 'checkbox';
		checkBox.id = 'LogCheck';
		checkBox.checked = true;
		checkBoxDiv.appendChild(checkBox);
		const checkBoxLabel = document.createElement('label');
		checkBoxLabel.className = 'form-check-label';
		checkBoxLabel.htmlFor = 'LogCheck';
		checkBoxLabel.innerText = 'Auto-scroll log';
		checkBoxDiv.appendChild(checkBoxLabel);
		infoDiv.appendChild(checkBoxDiv);

		const remainTimeDiv = document.createElement('div');
		remainTimeDiv.className = 'float-end';
		remainTimeDiv.innerText = 'ETA -:--';
		const setRemainTime = (r: string) => {
			remainTimeDiv.innerText = `ETA ${r}`;
		};
		infoDiv.appendChild(remainTimeDiv);
		bodyDiv.appendChild(infoDiv);

		const textarea = document.createElement('textarea');
		textarea.className = 'form-control';
		textarea.readOnly = true;
		textarea.style.resize = 'both';
		textarea.style.width = '500px';
		textarea.style.height = '80px';
		const textLog = (t: string) => {
			textarea.value += `${t}\n`;
			if (checkBox.checked) {
				textarea.scrollTop = textarea.scrollHeight;
			}
		};
		bodyDiv.appendChild(textarea);
		document.body.appendChild(bodyDiv);

		const bootScript = document.createElement('script');
		bootScript.src = this.bootJS.src;
		bootScript.integrity = this.bootJS.integrity;
		bootScript.crossOrigin = 'anonymous';
		document.body.appendChild(bootScript);

		const downloadFun = this.downloadZip.bind(this);
		button.addEventListener('click', async () => {
			button.disabled = true;
			window.addEventListener('beforeunload', preventUnloadWhileDownloading);
			try {
				await downloadFun(JSON.parse(input.value), setProgress, textLog, setRemainTime);
			} catch (e) {
				textLog('An error occurred');
				console.error(e);
			} finally {
				window.removeEventListener('beforeunload', preventUnloadWhileDownloading);
			}
		});
	}

	async downloadZip(
		downloadObj: unknown,
		progress: (n: number) => void,
		log: (s: string) => void,
		remainTime: (r: string) => void,
	) {
		if (!this.isDownloadJsonObj(downloadObj)) {
			throw new Error('Invalid download object shape');
		}
		const utils = this.utils;
		await utils.embedScript(
			'https://cdn.jsdelivr.net/npm/web-streams-polyfill@2.0.2/dist/ponyfill.min.js',
		);
		await utils.embedScript('https://cdn.jsdelivr.net/npm/streamsaver@2.0.3/StreamSaver.js');
		await utils.embedScript(
			'https://cdn.jsdelivr.net/npm/streamsaver@2.0.3/examples/zip-stream.js',
		);
		const encodedId = utils.encodeFileName(downloadObj.id);
		const fileStream = streamSaver.createWriteStream(`${encodedId}.zip`);
		const createRootHtml = () => this.createRootHtmlFromPosts(downloadObj);
		const createPostHtml = (title: string, body: string) => this.createHtmlFromBody(title, body);

		const readableZipStream = new createWriter({
			async pull(ctrl) {
				const startTime = Math.floor(Date.now() / 1000);
				let count = 0;
				const enqueue = (fileBits: BlobPart[], path: string) =>
					ctrl.enqueue(new File(fileBits, `${encodedId}/${path}`));
				log(`@${downloadObj.id} posts:${downloadObj.postCount} files:${downloadObj.fileCount}`);
				enqueue([createRootHtml()], 'index.html');
				let postCount = 0;
				for (const post of downloadObj.posts) {
					log(`${post.originalName} (${++postCount}/${downloadObj.postCount})`);
					const informationFile = utils.createInformationFile(post.informationText);
					enqueue(
						informationFile.content,
						`${post.encodedName}/${utils.encodeFileName(informationFile.name)}`,
					);
					enqueue(
						[createPostHtml(post.originalName, post.htmlText)],
						`${post.encodedName}/index.html`,
					);
					if (post.cover) {
						log(`download ${post.cover.name}`);
						const blob = await utils.fetchWithLimit(post.cover, 3);
						if (blob) {
							enqueue([blob], `${post.encodedName}/${post.cover.name}`);
						}
					}
					let fileCount = 0;
					for (const file of post.files) {
						log(`download ${file.encodedName} (${++fileCount}/${post.files.length})`);
						const blob = await utils.fetchWithLimit({ url: file.url, name: file.encodedName }, 3);
						if (blob) {
							enqueue([blob], `${post.encodedName}/${file.encodedName}`);
						} else {
							console.error(`Failed to download ${file.encodedName} (${file.url}); skipping`);
							log(`Failed to download ${file.encodedName}`);
						}
						count++;
						setTimeout(() => {
							const remain = Math.floor(
								Math.abs(Math.floor(Date.now() / 1000) - startTime) *
									((downloadObj.fileCount - count) / count),
							);
							const h = (remain / (60 * 60)) | 0;
							const m = Math.ceil((remain - 60 * 60 * h) / 60);
							remainTime(`${h}:${('00' + m).slice(-2)}`);
							progress(((count * 100) / downloadObj.fileCount) | 0);
						}, 0);
					}
				}
				ctrl.close();
			},
		});

		if (window.WritableStream && readableZipStream.pipeTo) {
			return readableZipStream.pipeTo(fileStream).then(() => console.log('done writing'));
		}

		const writer = fileStream.getWriter();
		const reader = readableZipStream.getReader();
		const pump = async (): Promise<void> => {
			const res = await reader.read();
			if (res.done) {
				await writer.close();
				return;
			}
			await writer.write(res.value);
			return pump();
		};
		await pump();
	}

	isDownloadJsonObj(target: unknown): target is DownloadJsonObj {
		if (typeof target !== 'object' || target === null) {
			console.error('Invalid download object (not an object)', target);
			return false;
		}
		const obj = target as Record<string, unknown>;
		if (typeof obj.postCount !== 'number') {
			console.error('Invalid download object (postCount is not a number)', obj.postCount);
			return false;
		}
		if (typeof obj.fileCount !== 'number') {
			console.error('Invalid download object (fileCount is not a number)', obj.fileCount);
			return false;
		}
		if (typeof obj.id !== 'string') {
			console.error('Invalid download object (id is not a string)', obj.id);
			return false;
		}
		if (typeof obj.url !== 'string') {
			console.error('Invalid download object (url is not a string)', obj.url);
			return false;
		}
		if (!Array.isArray(obj.posts)) {
			console.error('Invalid download object (posts is not an array)', obj.posts);
			return false;
		}
		if (!Array.isArray(obj.tags)) {
			console.error('Invalid download object (tags is not an array)', obj.tags);
			return false;
		}
		return !obj.posts.some((it: unknown) => {
			if (typeof it !== 'object' || it === null) {
				console.error('Invalid post entry (not an object)', it, obj.posts);
				return true;
			}
			const post = it as Record<string, unknown>;
			if (typeof post.informationText !== 'string') {
				console.error('Invalid post entry (informationText)', post.informationText, obj.posts);
				return true;
			}
			if (typeof post.htmlText !== 'string') {
				console.error('Invalid post entry (htmlText)', post.htmlText, obj.posts);
				return true;
			}
			if (!Array.isArray(post.files)) {
				console.error('Invalid post entry (files)', post.files, obj.posts);
				return true;
			}
			if (!Array.isArray(post.tags)) {
				console.error('Invalid post entry (tags)', post.tags, obj.posts);
				return true;
			}
			return post.files.some((f: unknown) => {
				if (typeof f !== 'object' || f === null) {
					console.error('Invalid file entry (not an object)', f, post.files);
					return true;
				}
				const file = f as Record<string, unknown>;
				if (typeof file.url !== 'string') {
					console.error('Invalid file entry (url)', file.url, post.files);
					return true;
				}
				if (typeof file.originalName !== 'string') {
					console.error('Invalid file entry (originalName)', file.originalName, post.files);
					return true;
				}
				if (typeof file.encodedName !== 'string') {
					console.error('Invalid file entry (encodedName)', file.encodedName, post.files);
					return true;
				}
				if (post.cover === undefined) {
					return false;
				}
				if (typeof post.cover !== 'object' || post.cover === null) {
					console.error('Invalid post cover (not an object)', post.cover, obj.posts);
					return true;
				}
				const cover = post.cover as Record<string, unknown>;
				if (typeof cover.url !== 'string') {
					console.error('Invalid post cover (url)', cover.url, post.cover);
					return true;
				}
				if (typeof cover.name !== 'string') {
					console.error('Invalid post cover (name)', cover.name, post.cover);
					return true;
				}
				return false;
			});
		});
	}

	createRootHtmlFromPosts(downloadObj: DownloadJsonObj): string {
		const header =
			`<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<title>${downloadObj.id}</title>\n` +
			`<link href="${this.bootCSS.href}" rel="stylesheet" integrity="${this.bootCSS.integrity}" crossOrigin="anonymous">\n` +
			'<style>div.main{width: 600px; float: none; margin: 65px auto 0}div.root{width: 400px}div.post{width: 600px}' +
			'a.hl,a.hl:hover{color: inherit;text-decoration: none;}div.card{float: none; margin: 0 auto;}' +
			'img.gray-card{height: 210px;background-color: gray;}' +
			'div.gray-carousel{height: 210px; width: 400px;background-color: gray;}' +
			'img.pd-carousel{height: 210px; padding: 15px;}</style>\n' +
			`</head>\n<body>\n<div class="main" id="main">\n`;
		const body =
			`<nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top"><div class="container-fluid">\n` +
			`<a class="navbar-brand" href="${downloadObj.url}">${downloadObj.id}</a>\n` +
			`<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#dd" aria-controls="dd" aria-expanded="false" aria-label="Toggle navigation">\n` +
			`<span class="navbar-toggler-icon"></span>\n` +
			`</button>\n` +
			`<div class="collapse navbar-collapse" id="dd"><ul class="navbar-nav">\n` +
			`<li class="nav-item dropdown">\n` +
			`<a class="nav-link dropdown-toggle" href="#" id="navbarDarkDropdownMenuLink" role="button" data-bs-toggle="dropdown" aria-expanded="false">Tags</a>\n` +
			`<ul class="dropdown-menu dropdown-menu-dark" aria-labelledby="dd">\n` +
			`<li v-for="(tag,i) in [${downloadObj.tags.map((tag) => this.utils.toQuoted(tag)).join(',')}]">\n` +
			` <div class="form-check mx-1">\n` +
			`<input class="form-check-input" type="checkbox" v-model="selected" :value="tag" :id="'box'+(i+1)">\n` +
			`<label class="form-check-label" :for="'box'+(i+1)">{{tag}}</label>\n` +
			`</div>\n</li>\n` +
			`</ul>\n</li>\n</ul></div>\n</div></nav>\n\n` +
			downloadObj.posts
				.map(
					(post) =>
						`<div v-show="isVisible([${post.tags.map((tag) => this.utils.toQuoted(tag)).join(', ')}], selected)">\n` +
						`<a class="hl" href="./${this.utils.encodeUri(post.encodedName)}/index.html"><div class="root card">\n` +
						this.createCoverHtmlFromPost(post) +
						`<div class="card-body"><h5 class="card-title">${post.originalName}</h5></div>\n</div></a><br>\n</div>\n`,
				)
				.join('\n');
		const footer =
			`\n</div>\n` +
			`<script src="${this.vueJS.src}"></script>\n` +
			`<script>\nVue.createApp({\ndata() {return { selected: [] }},` +
			`methods: {\n isVisible(tags, selected) {\n  if (!selected.length) return true\n  return selected.every(it => tags.includes(it))\n }\n}\n` +
			`}).mount('#main')\n</script>\n` +
			`<script src="${this.bootJS.src}" integrity="${this.bootJS.integrity}" crossOrigin="anonymous"></script>\n` +
			'</body></html>';
		return header + body + footer;
	}

	createCoverHtmlFromPost(post: DownloadJsonObj['posts'][number]): string {
		const postUri = `./${this.utils.encodeUri(post.encodedName)}/`;
		if (post.cover) {
			return `<img class="card-img-top gray-card" src="${postUri}${this.utils.encodeUri(post.cover.name)}" alt="cover"/>\n`;
		}
		const images = post.files.filter((file) => this.utils.isImage(file.encodedName));
		if (images.length > 0) {
			return (
				'<div class="carousel slide" data-bs-ride="carousel" data-interval="1000"><div class="carousel-inner">' +
				'\n<div class="carousel-item active">' +
				images
					.map(
						(img) =>
							'<div class="d-flex justify-content-center gray-carousel">' +
							`<img src="${postUri}${this.utils.encodeUri(img.encodedName)}" class="d-block pd-carousel" height="180px"/></div>`,
					)
					.join('</div>\n<div class="carousel-item">') +
				'</div>\n</div></div>\n'
			);
		}
		return `<img class="card-img-top gray-card"/>\n`;
	}

	createHtmlFromBody(title: string, body: string): string {
		return (
			`<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<title>${title}</title>\n` +
			`<link href="${this.bootCSS.href}" rel="stylesheet" integrity="${this.bootCSS.integrity}" crossOrigin="anonymous">\n` +
			'<style>div.main{width: 600px; float: none; margin: 0 auto}div.root{width: 400px}div.post{width: 600px}' +
			'a.hl,a.hl:hover{color: inherit;text-decoration: none;}div.card{float: none; margin: 0 auto;}' +
			'img.gray-card{height: 210px;background-color: gray;}' +
			'div.gray-carousel{height: 210px; width: 400px;background-color: gray;}' +
			'img.pd-carousel{height: 210px; padding: 15px;}</style>\n' +
			`</head>\n<body>\n<div class="main">\n${body}\n</div>\n` +
			`<script src="${this.bootJS.src}" integrity="${this.bootJS.integrity}" crossOrigin="anonymous"></script>\n` +
			'</body></html>'
		);
	}
}
