/**
 * Plan list API response type.
 * @see https://api.fanbox.cc/plan.listCreator?creatorId=${creatorId}
 */
type PlanInfo = {
	id: string;
	title: string;
	fee: number;
	description: string;
	coverImageUrl: string;
};

type Plans = {
	body?: PlanInfo[] | { plans?: PlanInfo[] };
};

/**
 * Featured tags API response type.
 * @see https://api.fanbox.cc/tag.getFeatured?creatorId=${creatorId}
 */
type TagInfo = {
	tag: string;
	count: number;
	coverImageUrl: string;
};

type Tags = {
	body?: TagInfo[] | { featuredTags?: TagInfo[] };
};

/**
 * Post cover — newer API uses `cover`, older responses used `coverImageUrl`.
 */
type PostCover = {
	type?: string;
	url: string;
};

/**
 * post.info API response.
 * Newer responses nest the post under `body.post`; older ones put fields on `body`.
 * @see https://api.fanbox.cc/post.info?postId=${postId}
 */
type PostInfoResponse = {
	body?: PostInfo | { post?: PostInfo };
};

/**
 * Post info type.
 * @see https://api.fanbox.cc/post.listCreator?creatorId=${creatorId}
 * @see https://api.fanbox.cc/post.info?postId=${postId}
 */
type PostInfo = {
	title: string;
	feeRequired: number;
	id: string;
	creatorId: string;
	coverImageUrl?: string | null;
	cover?: PostCover | null;
	excerpt: string;
	isRestricted: boolean;
	tags: string[];
	// Date values arrive as strings after JSON.parse
	publishedDatetime: string;
	updatedDatetime: string;
	likeCount: number;
	commentCount: number;
} & (
	| {
			type: 'image';
			body: { text: string; images: ImageInfo[] };
	  }
	| {
			type: 'file';
			body: { text: string; files: FileInfo[] };
	  }
	| {
			type: 'article';
			body: {
				imageMap: Record<string, ImageInfo>;
				fileMap: Record<string, FileInfo>;
				embedMap: Record<string, EmbedInfo>; // TODO: properly type embedMap
				urlEmbedMap: Record<string, UrlEmbedInfo>;
				blocks: Block[];
			};
	  }
	| {
			type: 'text';
			body: { text: string };
	  }
	| {
			type: 'unknown';
			body: unknown;
	  }
);

// Value types for article maps
type ImageInfo = { originalUrl: string; extension: string };
type FileInfo = { url: string; name: string; extension: string };
type EmbedInfo = unknown; // FIXME: unknown embed shape
type UrlEmbedInfo = { id: string } & (
	| { type: 'default'; url: string; host: string }
	| { type: 'html'; html: string }
	| { type: 'html.card'; html: string }
	| {
			type: 'fanbox.post';
			postInfo: { id: string; title: string; creatorId: string; coverImageUrl?: string };
	  }
	| { type: 'unknown'; [key: string]: unknown }
); // Catch-all for other observed shapes

// Article block types
type ImageBlock = { type: 'image'; imageId: string };
type FileBlock = { type: 'file'; fileId: string };
type TextBlock = { type: 'p' | 'header'; text: string };
type EmbedBlock = { type: 'embed'; embedId: string };
type UrlEmbedBlock = { type: 'url_embed'; urlEmbedId: string };
type UnknownBlock = { type: 'unknown' }; // Catch-all used by the default switch branch
type Block = ImageBlock | FileBlock | TextBlock | EmbedBlock | UrlEmbedBlock | UnknownBlock;
