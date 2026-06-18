import esbuild from 'esbuild';
import fs from 'fs-extra';

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
	entryPoints: ["./worker/Worker.ts"],
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
	outfile: './host/worker.js'
})