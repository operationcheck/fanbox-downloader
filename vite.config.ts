import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		outDir: 'docs',
		emptyOutDir: false,
		lib: {
			entry: 'src/fanbox-downloader.ts',
			name: 'FanboxDownloader',
			formats: ['es'],
			fileName: () => 'fanbox-downloader.min.js',
		},
		minify: 'oxc',
		target: 'es2023',
		rolldownOptions: {
			output: {
				codeSplitting: false,
				// Vite disables whitespace minify for ES lib output (tree-shaking annotations).
				// This bookmarklet is a standalone bundle, so enable full minification.
				minify: {
					compress: true,
					mangle: true,
					codegen: true,
				},
			},
		},
	},
});
