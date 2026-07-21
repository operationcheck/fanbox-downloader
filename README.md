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

### Local download (Node.js)

After the bookmarklet copies JSON:

```bash
# pass a saved JSON file
pnpm download path/to/manifest.json

# or copy it to scripts/download.json
cp path/to/manifest.json scripts/download.json
pnpm download

# or paste JSON into EMBEDDED_JSON in scripts/download-local.mjs, then:
pnpm download
```

Options:

```bash
pnpm download --out ./downloads --cookie "FANBOXSESSID=..." manifest.json
pnpm download --cookie-file scripts/cookie.txt manifest.json
pnpm download --force manifest.json   # re-download existing files
```

Cookie (any one of these):

1. `--cookie "..."`
2. `--cookie-file path` (default file: `scripts/cookie.txt`)
3. `EMBEDDED_COOKIE` in `scripts/download-local.mjs`
4. `scripts/cookie.txt`
5. `FANBOX_COOKIE` env

Copy the `cookie` request header from DevTools on `fanbox.cc` / `downloads.fanbox.cc`. Paid files usually need it. Output goes to `downloads/{creatorId}/` with one folder per post. Already-downloaded files are skipped so you can resume after failures.

### Zip local downloads

After `pnpm download`, create one ZIP per creator folder under `downloads/`:

```bash
pnpm zip
pnpm zip --dir ./downloads
pnpm zip {creator}     # only this folder
pnpm zip --force       # recreate existing ZIPs
```

`downloads/{creator}/` → `downloads/{creator}.zip`. Existing `.zip` files are skipped unless `--force` is set.

### Development

```bash
pnpm install
pnpm run build
pnpm run lint
pnpm run fmt
```

Site content lives in Markdown under `docs/` and is published by GitHub Actions (Vite build + Jekyll). The built `fanbox-downloader.min.js` is not committed — CI regenerates it on every deploy.

GitHub Pages must use **Source: GitHub Actions** (not "Deploy from a branch").
