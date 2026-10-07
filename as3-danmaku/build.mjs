import esbuild from 'esbuild';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 不依赖工作目录，始终以本文件所在目录为基准
const root = path.dirname(fileURLToPath(import.meta.url));

const banner = `import worker from '@jsc/danmaku/worker-loader/inline';

// 运行在work中的弹幕解析器，须提前构建
export default function () {
  return worker(\``;
const footer = `//@ sourceURL=as3-parser.js\`, "Worker", undefined, undefined);
}
`;

const plugin = {
	name: 'example',
	setup(build) {
		build.onEnd(result => {
			result.outputFiles.forEach(d => {
				fs.promises.writeFile(d.path, banner + d.text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace('"use strict";', '') + footer);
			})
		})
	},
};

esbuild.build({
	entryPoints: [path.join(root, 'worker/Worker.ts')],
	target: "es2015",
	format: "iife",
	charset: "utf8",
	bundle: true,
	minify: true,
	treeShaking: true,
	keepNames: true,
	write: false,
	plugins: [
		plugin
	],
	outfile: path.join(root, 'host/worker.js')
})