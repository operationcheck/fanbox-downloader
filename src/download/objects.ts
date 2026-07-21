import type { DownloadJsonObj, DownloadObj, FileObj, PostObj } from './types';
import { DownloadUtils } from './utils';

/**
 * Wrapper around the download JSON tree.
 */
export class DownloadObject {
	private readonly downloadObj: DownloadObj;
	private readonly utils: DownloadUtils;
	private readonly orderedPosts: PostObject[] = [];
	private url = '#main';
	private tags: string[] | undefined;

	constructor(id: string, utils: DownloadUtils) {
		this.downloadObj = { posts: {}, id };
		this.utils = utils;
	}

	stringify(): string {
		const downloadJson: DownloadJsonObj = {
			posts: this.orderedPosts.map((it) => it.toJsonObjBy(this.downloadObj.posts)),
			id: this.downloadObj.id,
			url: this.url,
			tags: this.tags ?? this.collectTags(),
			postCount: this.countPost(),
			fileCount: this.countFile(),
		};
		return JSON.stringify(downloadJson);
	}

	setUrl(url: string) {
		this.url = url;
	}

	setTags(tags: string[]) {
		this.tags = tags;
	}

	addPost(name: string): PostObject {
		const encodedName = this.utils.encodeFileName(name);
		if (this.downloadObj.posts[encodedName] === undefined) {
			this.downloadObj.posts[encodedName] = [];
		}
		const postObj: PostObj = { name, info: '', files: {}, html: '', tags: [] };
		this.downloadObj.posts[encodedName].push(postObj);
		const postObject = new PostObject(postObj, this.utils);
		this.orderedPosts.push(postObject);
		return postObject;
	}

	private countPost(): number {
		return Object.values(this.downloadObj.posts).reduce((s, posts) => s + posts.length, 0);
	}

	private countFile(): number {
		return Object.values(this.downloadObj.posts).reduce(
			(allFileSize, posts) =>
				allFileSize +
				posts.reduce(
					(postFileSize, post) =>
						postFileSize + Object.values(post.files).reduce((s, files) => s + files.length, 0),
					0,
				),
			0,
		);
	}

	private collectTags(): string[] {
		const tags = new Set<string>();
		Object.values(this.downloadObj.posts).forEach((posts) =>
			posts.forEach((post) => post.tags.forEach((tag) => tags.add(tag))),
		);
		return [...tags];
	}
}

/**
 * Wrapper around a single post entry.
 */
export class PostObject {
	private readonly postObj: PostObj;
	private readonly utils: DownloadUtils;

	constructor(postObj: PostObj, utils: DownloadUtils) {
		this.postObj = postObj;
		this.utils = utils;
	}

	setInfo(info: string) {
		this.postObj.info = info;
	}

	setHtml(html: string) {
		this.postObj.html = html;
	}

	setTags(tags: string[]) {
		this.postObj.tags = tags;
	}

	setCover(name: string, extension: string, url: string): FileObject {
		const fileObj: FileObj = { name, extension: extension ? `.${extension}` : '', url };
		this.postObj.cover = fileObj;
		return new FileObject(fileObj, this.utils);
	}

	addFile(name: string, extension: string, url: string): FileObject {
		const encodedName = this.utils.encodeFileName(name);
		if (this.postObj.files[encodedName] === undefined) {
			this.postObj.files[encodedName] = [];
		}
		const fileObj: FileObj = { name, extension: extension ? `.${extension}` : '', url };
		this.postObj.files[encodedName].push(fileObj);
		return new FileObject(fileObj, this.utils);
	}

	getAutoAssignedLinkTag(fileObject: FileObject): string {
		const ext = fileObject.getEncodedExtension();
		switch (true) {
			case this.utils.isAudio(ext):
				return this.getAudioLinkTag(fileObject);
			case this.utils.isImage(ext):
				return this.getImageLinkTag(fileObject);
			case this.utils.isVideo(ext):
				return this.getVideoLinkTag(fileObject);
			default:
				return this.getFileLinkTag(fileObject);
		}
	}

	getAudioLinkTag(fileObject: FileObject): string {
		const filePath = this.getCurrentFilePath(fileObject);
		return (
			`<a class="hl" href="${filePath}" download="${fileObject.getEncodedName() + fileObject.getEncodedExtension()}"><div class="post card">\n` +
			`<div class="card-header">${fileObject.getOriginalName()}</div>\n` +
			`<audio class="card-img-top" src="${filePath}" controls/>\n</div></a>`
		);
	}

	getLinkTag(url: string, title: string): string {
		return (
			`<a class="hl" href="${url}"><div class="post card text-center"><p class="pt-2">\n` +
			`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-box-arrow-up-left" viewBox="0 0 16 16">\n` +
			`<path fill-rule="evenodd" d="M7.364 3.5a.5.5 0 0 1 .5-.5H14.5A1.5 1.5 0 0 1 16 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 14.5V7.864a.5.5 0 1 1 1 0V14.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H7.864a.5.5 0 0 1-.5-.5z"/>\n` +
			`<path fill-rule="evenodd" d="M0 .5A.5.5 0 0 1 .5 0h5a.5.5 0 0 1 0 1H1.707l8.147 8.146a.5.5 0 0 1-.708.708L1 1.707V5.5a.5.5 0 0 1-1 0v-5z"/>\n` +
			`</svg> ${title}</p></div></a>`
		);
	}

	getFileLinkTag(fileObject: FileObject): string {
		const filePath = this.getCurrentFilePath(fileObject);
		return (
			`<a class="hl" href="${filePath}" download="${fileObject.getEncodedName() + fileObject.getEncodedExtension()}">` +
			`<div class="post card text-center"><p class="pt-2">\n` +
			`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-download" viewBox="0 0 16 16">\n` +
			`<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>\n` +
			`<path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>\n` +
			`</svg> ${fileObject.getOriginalName() + fileObject.getOriginalExtension()}</p></div></a>`
		);
	}

	getImageLinkTag(fileObject: FileObject): string {
		const filePath = this.getCurrentFilePath(fileObject);
		return (
			`<a class="hl" href="${filePath}" download="${fileObject.getEncodedName() + fileObject.getEncodedExtension()}"><div class="post card">\n` +
			`<img class="card-img-top" src="${filePath}" alt="${fileObject.getOriginalName()}"/>\n</div></a>`
		);
	}

	getVideoLinkTag(fileObject: FileObject): string {
		const filePath = this.getCurrentFilePath(fileObject);
		return (
			`<a class="hl" href="${filePath}" download="${fileObject.getEncodedName() + fileObject.getEncodedExtension()}"><div class="post card">\n` +
			`<video class="card-img-top" src="${filePath}" controls/>\n</div></a>`
		);
	}

	private getCurrentFilePath(fileObject: FileObject): string {
		const encodedName = fileObject.getEncodedName();
		if (fileObject.equals(this.postObj.cover)) {
			const fileName = this.utils.getFileName(
				encodedName,
				fileObject.getEncodedExtension(),
				1,
				0,
				true,
			);
			return `./${this.utils.encodeUri(fileName)}`;
		}
		if (this.postObj.files[encodedName] === undefined) {
			throw new Error(`file object is undefined: ${fileObject.getOriginalName()}`);
		}
		const index = this.postObj.files[encodedName].findIndex((it) => fileObject.equals(it));
		if (index < 0) {
			throw new Error(`file object is not found: ${fileObject.getOriginalName()}`);
		}
		const fileName = this.utils.getFileName(
			encodedName,
			fileObject.getEncodedExtension(),
			this.postObj.files[encodedName].length,
			index,
			true,
		);
		return `./${this.utils.encodeUri(fileName)}`;
	}

	toJsonObjBy(posts: Record<string, PostObj[]>): DownloadJsonObj['posts'][number] {
		const key = this.utils.encodeFileName(this.postObj.name);
		const postIndex = posts[key]?.indexOf(this.postObj);
		if (postIndex === undefined || postIndex < 0) {
			throw new Error(`post object is not found: ${this.postObj.name}`);
		}
		const encodedName = this.utils.getFileName(key, '', posts[key].length, postIndex, false);
		const cover = this.postObj.cover
			? {
					url: this.postObj.cover.url,
					name: this.utils.getFileName(
						this.postObj.cover.name,
						this.postObj.cover.extension,
						1,
						0,
						true,
					),
				}
			: undefined;
		return {
			originalName: this.postObj.name,
			encodedName,
			informationText: this.postObj.info,
			htmlText: this.postObj.html,
			files: this.collectFiles(),
			tags: this.postObj.tags,
			cover,
		};
	}

	private collectFiles(): DownloadJsonObj['posts'][number]['files'] {
		const ret: DownloadJsonObj['posts'][number]['files'] = [];
		for (const [key, fileObjArray] of Object.entries(this.postObj.files)) {
			let fileIndex = 0;
			for (const fileObj of fileObjArray) {
				const extension = fileObj.extension ? this.utils.encodeFileName(fileObj.extension) : '';
				const encodedName = this.utils.getFileName(
					key,
					extension,
					fileObjArray.length,
					fileIndex++,
					true,
				);
				ret.push({
					url: fileObj.url,
					originalName: fileObj.name,
					encodedName,
				});
			}
		}
		return ret;
	}
}

/**
 * Wrapper around a single file entry.
 */
export class FileObject {
	private readonly fileObj: FileObj;
	private readonly utils: DownloadUtils;

	constructor(fileObj: FileObj, utils: DownloadUtils) {
		this.fileObj = fileObj;
		this.utils = utils;
	}

	getEncodedName(): string {
		return this.utils.encodeFileName(this.fileObj.name);
	}

	getEncodedExtension(): string {
		return this.utils.encodeFileName(this.fileObj.extension);
	}

	getOriginalName(): string {
		return this.fileObj.name;
	}

	getOriginalExtension(): string {
		return this.fileObj.extension;
	}

	getUrl(): string {
		return this.fileObj.url;
	}

	equals(obj: unknown): boolean {
		if (typeof obj !== 'object' || obj === null) {
			return false;
		}
		const candidate = obj as Partial<FileObj>;
		return candidate.name === this.fileObj.name && candidate.url === this.fileObj.url;
	}
}
