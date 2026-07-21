/** Internal download object tree */
export type DownloadObj = { posts: Record<string, PostObj[]>; id: string };

/** Internal post object */
export type PostObj = {
	name: string;
	info: string;
	files: Record<string, FileObj[]>;
	html: string;
	tags: string[];
	cover?: FileObj;
};

/** Internal file object */
export type FileObj = { url: string; name: string; extension: string };

/** Serialized JSON shape used by the download UI / ZIP writer */
export type DownloadJsonObj = {
	posts: {
		originalName: string;
		encodedName: string;
		informationText: string;
		htmlText: string;
		files: { url: string; originalName: string; encodedName: string }[];
		tags: string[];
		cover?: { url: string; name: string };
	}[];
	id: string;
	url: string;
	tags: string[];
	fileCount: number;
	postCount: number;
};
