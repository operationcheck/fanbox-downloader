#!/usr/bin/env node
/**
 * Zip each creator folder under downloads/.
 *
 *   pnpm zip
 *   pnpm zip --dir ./downloads
 *   pnpm zip {creator}          # only this folder
 *   pnpm zip --force            # recreate even if .zip exists
 *
 * For downloads/{creator}/ creates downloads/{creator}.zip (skipped if it already exists).
 */

import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

function usage(exitCode = 0) {
	console.log(`Usage: node scripts/zip-downloads.mjs [options] [folder...]

Options:
  --dir <path>   Downloads directory (default: ./downloads)
  --force        Recreate ZIP even if it already exists
  --help         Show this help

If folder names are given, only those folders are zipped.
`);
	process.exit(exitCode);
}

function parseArgs(argv) {
	const options = {
		dir: path.resolve('downloads'),
		force: false,
		folders: [],
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') usage(0);
		if (arg === '--force') {
			options.force = true;
			continue;
		}
		if (arg === '--dir') {
			options.dir = path.resolve(argv[++i] ?? '');
			continue;
		}
		if (arg.startsWith('-')) {
			console.error(`Unknown option: ${arg}`);
			usage(1);
		}
		options.folders.push(arg);
	}
	return options;
}

async function exists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function runZip(zipName, folderName, cwd) {
	return new Promise((resolve, reject) => {
		// -r recursive, -q quiet
		const child = spawn('zip', ['-r', '-q', zipName, folderName], {
			cwd,
			stdio: ['ignore', 'inherit', 'inherit'],
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`zip exited with code ${code}`));
		});
	});
}

async function main() {
	const options = parseArgs(process.argv.slice(2));

	if (!(await exists(options.dir))) {
		console.error(`Directory not found: ${options.dir}`);
		process.exit(1);
	}

	let folderNames;
	if (options.folders.length > 0) {
		folderNames = options.folders;
	} else {
		const entries = await readdir(options.dir, { withFileTypes: true });
		folderNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	}

	if (folderNames.length === 0) {
		console.log(`No folders found in ${options.dir}`);
		return;
	}

	let created = 0;
	let skipped = 0;

	for (const folderName of folderNames) {
		const folderPath = path.join(options.dir, folderName);
		const zipName = `${folderName}.zip`;
		const zipPath = path.join(options.dir, zipName);

		if (!(await exists(folderPath))) {
			console.error(`skip missing folder: ${folderName}`);
			continue;
		}
		const folderStat = await stat(folderPath);
		if (!folderStat.isDirectory()) {
			console.error(`skip not a directory: ${folderName}`);
			continue;
		}

		if (!options.force && (await exists(zipPath))) {
			console.log(`skip ${zipName} (already exists)`);
			skipped++;
			continue;
		}

		console.log(`zip ${folderName}/ → ${zipName}`);
		await runZip(zipName, folderName, options.dir);
		created++;
	}

	console.log(`\nDone. created=${created} skipped=${skipped}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
