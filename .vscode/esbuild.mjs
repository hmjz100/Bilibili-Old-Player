import pkg from '../package.json' with { type: 'json' };
import esbuild from 'esbuild';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'child_process';

const version = pkg.version;
console.log("Building Player...");
console.log("Version: ", version);

/** 项目根目录（本文件位于 <root>/.vscode/ 下） */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 获取项目的 `commit` 哈希值
 * @returns {Promise<string>} `commit` 哈希值
 */
function getProjectHash() {
	return new Promise((resolve, reject) => {
		exec(`git rev-parse HEAD`, { cwd: process.cwd() }, (e, d) => {
			e && reject(e);
			d && resolve(d.match(/[a-f0-9]{40}/)[0]);
		})
	})
}

const commit = await getProjectHash();
console.log("Commit: ", commit);

esbuild.build({
	entryPoints: ['src/video.ts'],
	target: "es2015",
	format: "iife",
	charset: "utf8",
	outdir: "dist",
	outbase: "src",
	bundle: true,
	minify: true,
	treeShaking: true,
	// sourcemap: true,
	// metafile: true,
	define: {
		_BUILD_VERSION_: `'${version}'`,
		_BUILD_REVISION_: `'${commit}'`,
		_BUILD_TIME_: `'${new Date().toISOString()}'`,
	},
	loader: {
		'.html': 'text',
		'.svg': 'text',
		'.art': 'text',
		'.png': 'dataurl',
		'.gif': "dataurl",
		'.less': 'css',
		'.ttf': 'dataurl',
		'.woff': 'dataurl',
		'.eot': 'dataurl',
		'.xml': 'dataurl'
	}
}).then(d => fs.promises.rm(path.join(root, 'as3-danmaku/host/worker.js')))