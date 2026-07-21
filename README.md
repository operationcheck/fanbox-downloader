# Fanbox Downloader

A bookmarklet that downloads pixiv FANBOX posts as a ZIP archive, with one folder per post.

### Usage

- https://operationcheck.github.io/fanbox-downloader/

Bookmarklet:

```
javascript:import("https://operationcheck.github.io/fanbox-downloader/fanbox-downloader.min.js").then(m=>m.main()).catch(e=>alert(`Error (${e})`));
```

### Known issues

- ZIP archives larger than 4 GB may fail to extract in some tools (the archive itself is usually fine)
- The `download` attribute on file links does not work, so original filenames cannot be restored when names collide

### Changes from the upstream fork

- Broader URL support
- Downloads as a ZIP with one folder per post
- Saves post text and related metadata
- Loads the script externally because the code grew too large for an inline bookmarklet

### Development

```bash
pnpm install
pnpm run build
pnpm run lint
pnpm run fmt
```

Site content lives in Markdown under `docs/` and is published by GitHub Actions (Vite build + Jekyll). The built `fanbox-downloader.min.js` is not committed — CI regenerates it on every deploy.

GitHub Pages must use **Source: GitHub Actions** (not "Deploy from a branch").
