/*
 * 准备 GitHub Pages 的发布目录。
 *
 * 做两件事：
 *   1. 把宿主页面必须自己提供的 jQuery 拷到 public/vendor/
 *      —— 播放器产物不含 jQuery，而国内访问 CDN 很不可靠，所以一律内置；
 *   2. 把播放器构建产物（dist/video.js、dist/video.css）拷进 public/。
 *
 * 用法：npm run build 之后执行 `node public/build-demo.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.join(root, 'package.json'));

/** 在 node_modules 里找包内文件，兼容 pnpm 的 .pnpm 布局 */
function resolvePackageFile(pkg, relative) {
	try {
		return require.resolve(`${pkg}/${relative}`);
	} catch (e) {
		/* 继续用下面的兜底路径 */
	}
	const direct = path.join(root, 'node_modules', pkg, relative);
	if (fs.existsSync(direct)) {
		return direct;
	}
	const pnpmDir = path.join(root, 'node_modules', '.pnpm');
	if (fs.existsSync(pnpmDir)) {
		const prefix = pkg.replace('/', '+') + '@';
		const hit = fs.readdirSync(pnpmDir).find((name) => name.startsWith(prefix));
		if (hit) {
			const candidate = path.join(pnpmDir, hit, 'node_modules', pkg, relative);
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return null;
}

const vendor = path.join(here, 'vendor');
fs.mkdirSync(vendor, { recursive: true });

const missing = [];
const tasks = [
	{ name: 'jquery.min.js', pkg: 'jquery', relative: 'dist/jquery.min.js', required: true, to: path.join(vendor, 'jquery.min.js') },
	{ name: 'video.js', from: path.join(root, 'dist/video.js'), required: true, to: path.join(here, 'video.js') },
	{ name: 'video.css', from: path.join(root, 'dist/video.css'), required: true, to: path.join(here, 'video.css') },
];

for (const task of tasks) {
	const from = task.from || resolvePackageFile(task.pkg, task.relative);
	if (!from || !fs.existsSync(from)) {
		missing.push(`${task.name}${task.pkg ? `` : ''}`);
		continue;
	}
	fs.copyFileSync(from, task.to);
	console.log(`复制 ${task.name} <- ${path.relative(root, from)}`);
}

if (missing.length) {
	const required = tasks.filter((t) => t.required).map((t) => t.name);
	const missingRequired = missing.filter((m) => required.some((r) => m.startsWith(r)));
	console.log(`\n缺少：${missing.join('、')}`);
	if (missingRequired.length) {
		console.error('必要文件缺失，请先执行 `npm run build` 并确保依赖已安装。');
		process.exit(1);
	}
}

console.log('\n演示页目录已就绪：public/');