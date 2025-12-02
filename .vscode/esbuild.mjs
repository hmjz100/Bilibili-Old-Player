import pkg from '../package.json' with { type: 'json' };
import esbuild from 'esbuild';
import fs from 'fs-extra';
import { exec } from 'child_process';

/**
 * 获取项目的 `commit` 哈希值
 * @returns {Promise<string>} `commit` 哈希值
 */
function getHash() {
    return new Promise((resolve, reject) => {
        exec(`git rev-parse HEAD`, (e, d) => {
            e && reject(e);
            d && resolve(d.match(/[a-f0-9]{40}/)[0]);
        })
    })
}

const hash = await getHash();
const version = pkg.version;
const revision = hash.slice(0, 7);

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
		_BUILD_VERSION_: `'${version}'`,
		_BUILD_REVISION_: `'${revision}'`,
		_BUILD_TIME_: `'${new Date().toISOString()}'`,
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