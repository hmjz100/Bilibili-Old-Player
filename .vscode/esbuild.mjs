import esbuild from 'esbuild';
import fs from 'fs-extra';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url'; 
import { dirname, resolve } from 'path';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf-8'));
// console.log(JSON.stringify(pkg));
const version = pkg.version;
const revision = execSync('git rev-parse --short HEAD').toString().trim();

esbuild.build({
    entryPoints: ['src/video.ts'], // 入口脚本
    target: "chrome76", // 目标标准
    bundle: true, // 是否打包
    // sourcemap: true, // map文件
    minify: true, // 是否压缩
    outdir: 'dist', // 输出目录
    outbase: "src", // 输入目录
    format: 'iife', // 输出格式
    treeShaking: true, // 清除无效代码
    // metafile: true, // 打印报表
    // charset: 'utf8', // 文件编码
    define: {
		'__BUILD_VERSION__': JSON.stringify(version),
		'__BUILD_REVISION__': JSON.stringify(revision),
		'__BUILD_TIME__': JSON.stringify(new Date().toISOString()),
	},
    loader: { // 文件对应的解析方式
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
}).then(d => fs.promises.rm('as3-danmaku/host/worker.js'))