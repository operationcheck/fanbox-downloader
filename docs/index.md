---
layout: default
title: Fanbox Downloader
description: A bookmarklet that downloads pixiv FANBOX posts as a ZIP archive.
permalink: /
---

## Fanbox Downloader

A bookmarklet that downloads pixiv FANBOX posts as a ZIP archive.

### How to use

1. Add the bookmarklet to your bookmarks:

```
javascript:import("https://operationcheck.github.io/fanbox-downloader/fanbox-downloader.min.js").then(m=>m.main()).catch(e=>alert(`Error (${e})`));
```

2. Run it on a FANBOX creator page or post page[^1]
3. Post info is copied to the clipboard as JSON
4. Run it again on the download page[^2] and paste the JSON into the input box
5. The download starts

[^1]: Pages whose URL starts with `○○○.fanbox.cc` or `fanbox.cc/@○○○`

[^2]: Pages whose URL starts with `downloads.fanbox.cc` (the "View original size" image page)

### Links

- [GitHub](https://github.com/operationcheck/fanbox-downloader)
