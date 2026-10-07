/*
 * Bilibili-Old Player 演示页引导脚本
 *
 * 播放器并不接受「视频直链」这种参数：它要的是一份 B 站的 playurl 数据。
 * 所以这个脚本负责把用户给的直链「包装」成播放器认识的世界：
 *
 *   1. 判定地址类型（mp4 / flv / m3u8，也支持手动指定）；
 *   2. 合成 playurl（渐进式 durl）与视频元数据 __INITIAL_STATE__；
 *   3. 拦截播放器发出的 playurl 接口请求，直接喂回合成数据
 *      （这样画质切换、重新载入等后续请求也不会打到 B 站接口上）；
 *   4. 按类型调整 flvjs 能力：mp4 / m3u8 时让 flvjs.isSupported() 返回 false，
 *      迫使播放器走「原生 video」链路（播放器构造函数里就是这么判定的）；
 *   5. 启动播放器；m3u8 播放器本身不支持，额外交给 hls.js 接管它建出来的 video 元素。
 */
(function () {
	'use strict';

	/** 演示用的假稿件信息（播放器只要求这些字段存在） */
	var DEMO_AID = 1;
	var DEMO_BVID = 'BV1xx411c7mD';
	var DEMO_CID = 1;

	var state = {
		url: '',
		type: 'mp4',
		duration: 0,
		loaded: false,
		/** 本地文件时保留 File 引用，便于直接切片读元数据（flv 时长） */
		source: null,
		size: 0,
	};

	/** 本地文件的 object URL（切换文件时要释放） */
	var localObjectURL = '';

	/** 已载入的弹幕（解析成播放器要的 IDmData 形状后缓存，换源时重新装入） */
	var danmaku = {
		items: [],
		name: '',
	};

	var statusNode = null;

	function setStatus(text, kind) {
		if (!statusNode) {
			statusNode = document.getElementById('demo-status');
		}
		if (!statusNode) {
			return;
		}
		statusNode.textContent = text;
		statusNode.className = 'demo-status' + (kind ? ' demo-status-' + kind : '');
	}

	function getParam(name) {
		var search = window.location.search.replace(/^\?/, '');
		var pairs = search ? search.split('&') : [];
		for (var i = 0; i < pairs.length; i++) {
			var kv = pairs[i].split('=');
			if (kv[0] === name) {
				try {
					return decodeURIComponent(kv.slice(1).join('=').replace(/\+/g, ' '));
				} catch (e) {
					return kv.slice(1).join('=');
				}
			}
		}
		return '';
	}

	/**
	 * 从地址与手动选择推断类型
	 * @param {string} url 视频地址
	 * @param {string} forced 手动指定的类型（auto / mp4 / flv / m3u8）
	 */
	function guessType(url, forced) {
		if (forced && forced !== 'auto') {
			return forced;
		}
		var path = url.split('#')[0].split('?')[0].toLowerCase();
		if (/\.m3u8?$/.test(path)) {
			return 'm3u8';
		}
		if (/\.flv$/.test(path)) {
			return 'flv';
		}
		if (/\.(mp4|m4v|mov|webm|ogv|ogg|mkv|ts|mp3|m4a|aac|flac|wav|opus)$/.test(path)) {
			return 'mp4';
		}
		// 没有扩展名时按查询参数猜一把，最后默认 mp4
		if (/[?&](type|format)=flv/.test(url)) {
			return 'flv';
		}
		if (/[?&](type|format)=(m3u8|hls)/.test(url)) {
			return 'm3u8';
		}
		return 'mp4';
	}

	/**
	 * 读 flv 的时长：先看文件头 onMetaData 里的 duration，
	 * 没有就回退到「尾部 tag 时间戳」（用前一个 tag 的长度做校验，滤掉误命中）。
	 * 时长很重要：播放器弹幕模块会用 duration / pageSize 决定要拉多少分段，
	 * 读不到时长（Infinity）会让它陷入无休止的分段请求。
	 */
	function probeFlvDuration(source, size) {
		var HEAD = 65536;
		var TAIL = 1048576;
		var read = function (start, end) {
			if (source instanceof Blob) {
				return source.slice(start, end).arrayBuffer();
			}
			return fetch(source, { headers: { Range: 'bytes=' + start + '-' + (end - 1) } }).then(function (r) {
				return r.arrayBuffer();
			});
		};
		return read(0, Math.min(HEAD, size || HEAD))
			.then(function (buf) {
				var u8 = new Uint8Array(buf);
				var text = '';
				for (var i = 0; i < u8.length; i++) {
					text += String.fromCharCode(u8[i]);
				}
				var at = text.indexOf('duration');
				if (at > 0 && at + 9 <= u8.length - 8) {
					var val = new DataView(buf).getFloat64(at + 9);
					if (isFinite(val) && val > 1 && val < 86400) {
						return val;
					}
				}
				if (!size || size <= TAIL) {
					return 0;
				}
				return read(size - TAIL, size).then(function (buf2) {
					var b = new Uint8Array(buf2);
					var max = 0;
					for (var j = 4; j + 11 < b.length; j++) {
						var type = b[j];
						if (type !== 8 && type !== 9 && type !== 18) {
							continue;
						}
						var sz = (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
						var prev = ((b[j - 4] << 24) | (b[j - 3] << 16) | (b[j - 2] << 8) | b[j - 1]) >>> 0;
						if (prev !== sz + 11) {
							continue;
						}
						var ts = (b[j + 4] << 16) | (b[j + 5] << 8) | b[j + 6];
						if (ts > max && ts < 86400000) {
							max = ts;
						}
					}
					return max / 1000;
				});
			})
			.catch(function () {
				return 0;
			});
	}

	/** 探测时长：mp4 用隐藏 video，flv 读容器元数据，其余返回 0 */
	function probeDuration(url, type, source, size) {
		return new Promise(function (resolve) {
			if (type === 'flv') {
				probeFlvDuration(source || url, size || 0).then(resolve);
				return;
			}
			if (type !== 'mp4') {
				resolve(0);
				return;
			}
			var video = document.createElement('video');
			var done = function (value) {
				video.removeAttribute('src');
				video.load();
				resolve(value || 0);
			};
			video.preload = 'metadata';
			video.muted = true;
			video.onloadedmetadata = function () {
				done(isFinite(video.duration) ? video.duration : 0);
			};
			video.onerror = function () {
				done(0);
			};
			// 探测超时（跨域/网络慢时不要让页面卡住）
			setTimeout(function () {
				done(isFinite(video.duration) ? video.duration : 0);
			}, 8000);
			video.src = url;
		});
	}

	/**
	 * 合成 playurl（渐进式 durl）
	 *
	 * 关键字段说明（都对得上播放器里的解析逻辑）：
	 *   from: 'local'  必填，否则播放器会以「Unsupported video source」拒绝；
	 *   format         必须与 flvjs 能力匹配：flv 时不能含 mp4，mp4 时必须含 mp4；
	 *   durl[]         url / length(毫秒) / size / backup_url。
	 */
	function buildPlayurl(url, type, durationSec, quality) {
		var isFlv = type === 'flv';
		var format = isFlv ? 'flv' : 'mp4';
		var durationMs = Math.round((durationSec || 0) * 1000);
		return {
			code: 0,
			message: '0',
			ttl: 1,
			data: {
				from: 'local',
				result: 'suee',
				quality: quality || 80,
				format: format,
				timelength: durationMs,
				accept_format: format,
				accept_quality: [quality || 80],
				accept_description: ['高清 1080P'],
				support_formats: [
					{
						quality: quality || 80,
						format: format,
						new_description: '1080P',
						display_desc: '1080P',
						superscript: '',
						codecs: [],
					},
				],
				durl: [
					{
						order: 1,
						length: durationMs,
						size: 0,
						url: url,
						backup_url: [],
					},
				],
			},
		};
	}

	function buildInitialState(name, type, durationSec) {
		var videoData = {
			aid: DEMO_AID,
			bvid: DEMO_BVID,
			cid: DEMO_CID,
			p: 1,
			pages: [
				{
					cid: DEMO_CID,
					page: 1,
					from: 'vupload',
					part: name,
					duration: Math.round(durationSec || 0),
					vid: '',
					weblink: '',
					dimension: { width: 1920, height: 1080, rotate: 0 },
				},
			],
			title: name,
			duration: Math.round(durationSec || 0),
			pic: '',
			desc: '本页面是 Bilibili-Old Player 的演示页，播放的是外部直链（' + type.toUpperCase() + '）。',
			pubdate: Math.floor(Date.now() / 1000),
			owner: { mid: 1, name: '演示', face: '' },
			stat: {
				aid: DEMO_AID,
				view: 0,
				danmaku: 0,
				reply: 0,
				favorite: 0,
				coin: 0,
				share: 0,
				like: 0,
				now_rank: 0,
				his_rank: 0,
				evaluation: '',
			},
			dimension: { width: 1920, height: 1080, rotate: 0 },
		};
		return {
			videoData: videoData,
			aid: DEMO_AID,
			bvid: DEMO_BVID,
			cid: DEMO_CID,
			p: 1,
			videoStatus: 'ok',
		};
	}

	/** 把合成数据当作接口应答塞回 XHR（支持 json 与 protobuf/ArrayBuffer） */
	function respond(xhr, body) {
		var binary = body instanceof ArrayBuffer;
		var text = binary ? '' : JSON.stringify(body);
		var mime = binary ? 'application/octet-stream' : 'application/json';
		var define = function (key, value) {
			try {
				Object.defineProperty(xhr, key, { configurable: true, value: value });
			} catch (e) {
				/* 某些字段无法覆盖时忽略即可 */
			}
		};
		define('readyState', 4);
		define('status', 200);
		define('statusText', 'OK');
		define('responseURL', xhr.__demoURL || '');
		define('responseText', text);
		define(
			'response',
			binary ? (xhr.responseType === 'arraybuffer' ? body : new Uint8Array(body)) : xhr.responseType === 'json' ? body : text,
		);
		xhr.getAllResponseHeaders = function () {
			return 'content-type: ' + mime + '\r\n';
		};
		xhr.getResponseHeader = function (name) {
			return String(name).toLowerCase() === 'content-type' ? mime : null;
		};
		setTimeout(function () {
			try {
				xhr.dispatchEvent(new Event('readystatechange'));
				xhr.dispatchEvent(new ProgressEvent('load'));
				xhr.dispatchEvent(new ProgressEvent('loadend'));
			} catch (e) {
				/* 事件派发失败不该影响播放 */
			}
		}, 0);
	}

	/**
	 * 拦截播放器发出的接口请求
	 * 只处理「播放地址」相关的接口，其它接口（弹幕、点赞等）保持原样，
	 * 让它们自然失败，避免伪造出错误的数据结构把播放器带偏。
	 */
	function installNetworkBridge() {
		var playurlAnswer = function (url, payload) {
			var qn = String(payload || '').match(/[?&]qn=(\d+)/);
			return buildPlayurl(state.url, state.type, state.duration, qn ? Number(qn[1]) : 0);
		};
		var route = function (url, payload) {
			// 弹幕：用本地弹幕（xml/json）编码成播放器要的 protobuf 应答
			if (/dm\/web\/seg\.so/i.test(url)) {
				var seg = /segment_index=(\d+)/.exec(url);
				return danmakuSegment(seg ? Number(seg[1]) : 1);
			}
			if (/dm\/web\/view/i.test(url)) {
				return encodeDmView(danmaku.items.length, state.duration);
			}
			if (/player\/(wbi\/)?playurl/i.test(url)) {
				return playurlAnswer(url, payload);
			}
			if (/web-interface\/view/i.test(url)) {
				return { code: 0, message: '0', ttl: 1, data: window.__INITIAL_STATE__.videoData };
			}
			return null;
		};

		var originalOpen = XMLHttpRequest.prototype.open;
		var originalSend = XMLHttpRequest.prototype.send;

		XMLHttpRequest.prototype.open = function (method, url) {
			this.__demoURL = String(url || '');
			return originalOpen.apply(this, arguments);
		};

		XMLHttpRequest.prototype.send = function (body) {
			var url = this.__demoURL || '';
			var payload = url + '&' + (typeof body === 'string' ? body : '');
			try {
				var answer = route(url, payload);
				if (answer) {
					respond(this, answer);
					return;
				}
			} catch (e) {
				/* 拦截失败就退回真实请求 */
			}
			return originalSend.apply(this, arguments);
		};

		// 万一哪条链路用的是 fetch，也一并兜住
		if (typeof window.fetch === 'function') {
			var originalFetch = window.fetch.bind(window);
			window.fetch = function (input, init) {
				var url = typeof input === 'string' ? input : (input && input.url) || '';
				try {
					var answer = route(url, init && init.body ? String(init.body) : '');
					if (answer) {
						return Promise.resolve(
							new Response(JSON.stringify(answer), {
								status: 200,
								headers: { 'content-type': 'application/json' },
							}),
						);
					}
				} catch (e) {
					/* 拦截失败就退回真实请求 */
				}
				return originalFetch(input, init);
			};
		}
	}

	/** 按需加载 hls.js（只有 m3u8 才需要，避免多余请求） */
	function loadHls() {
		return new Promise(function (resolve, reject) {
			if (window.Hls) {
				resolve(window.Hls);
				return;
			}
			var script = document.createElement('script');
			script.src = './vendor/hls.min.js';
			script.onload = function () {
				window.Hls ? resolve(window.Hls) : reject(new Error('hls.js 已加载但未挂载全局 Hls'));
			};
			script.onerror = function () {
				reject(new Error('无法加载 ./vendor/hls.min.js（请先执行 node public/build-demo.mjs）'));
			};
			document.head.appendChild(script);
		});
	}

	/**
	 * mp4 / m3u8 强制走原生链路
	 * 播放器构造函数会直接读 window.flvjs.isSupported() 来决定 allowFlv，
	 * 为 true 时它会按 FLV 去要地址、并拒绝 format 含 mp4 的 playurl。
	 */
	function forceNativePlayer() {
		if (window.flvjs && typeof window.flvjs.isSupported === 'function') {
			window.flvjs.isSupported = function () {
				return false;
			};
		}
	}

	/** m3u8：用 hls.js 接管播放器建出来的 video 元素 */
	function attachHls(url) {
		var waited = 0;
		var timer = setInterval(function () {
			waited += 250;
			var video = document.querySelector('#bilibili-player video') || document.querySelector('#bofqi video') || document.querySelector('.bilibili-player video');
			if (!video) {
				if (waited > 20000) {
					clearInterval(timer);
					setStatus('没有等到播放器的 video 元素，m3u8 无法接管', 'error');
				}
				return;
			}
			clearInterval(timer);
			loadHls()
				.then(function (Hls) {
					if (!Hls.isSupported()) {
						setStatus('当前浏览器不支持 MSE，hls.js 无法播放 m3u8（播放器本身不支持 HLS）', 'error');
						return;
					}
					var hls = new Hls({ enableWorker: true });
					hls.on(Hls.Events.ERROR, function (event, data) {
						if (data && data.fatal) {
							setStatus('HLS 播放错误：' + data.type + ' / ' + data.details, 'error');
						}
					});
					hls.on(Hls.Events.MANIFEST_PARSED, function () {
						setStatus('m3u8 已由 hls.js 接管播放：' + url, 'ok');
						var play = video.play();
						play && play.catch && play.catch(function () { });
					});
					hls.loadSource(url);
					hls.attachMedia(video);
					window.__demoHls = hls;
				})
				.catch(function (e) {
					setStatus('m3u8 需要 hls.js：' + (e && e.message ? e.message : e), 'error');
				});
		}, 250);
	}

	/**
	 * 换源前先拆掉上一个播放器。
	 * GrayManager 是单例且有 initialized 守卫，不重置的话第二次 EmbedPlayer 会直接空转，
	 * 表现就是「换地址/换文件没反应」。
	 */
	function teardown() {
		try {
			window.player && window.player.destroy && window.player.destroy();
		} catch (e) {
			/* 忽略 */
		}
		try {
			if (window.__demoHls) {
				window.__demoHls.destroy();
				window.__demoHls = null;
			}
		} catch (e) {
			/* 忽略 */
		}
		try {
			var gray = window.GrayManager;
			if (gray) {
				gray.initialized = false;
				gray.storageLoaded = false;
				gray.playerParams = null;
				gray.h5Params = null;
				gray.enable = false;
				gray.statusList = [];
			}
		} catch (e) {
			/* 忽略 */
		}
		window.player = undefined;
		window.__playinfo__ = undefined;
		delete window.__playurlMap__;
		servedSegments = {};
		var bofqi = document.getElementById('bilibili-player') || document.getElementById('bofqi');
		if (bofqi) {
			bofqi.innerHTML = '';
		}
	}

	/* ==================== 弹幕（xml / json） ==================== */

	/** 把 B 站经典 xml 弹幕解析成播放器要的 IDmData 形状 */
	function parseDanmakuXml(text) {
		var clean = text.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '');
		var doc = new DOMParser().parseFromString(clean, 'text/xml');
		if (doc.getElementsByTagName('parsererror').length) {
			throw new Error('XML 解析失败');
		}
		var nodes = doc.getElementsByTagName('d');
		var list = [];
		for (var i = 0; i < nodes.length; i++) {
			var p = (nodes[i].getAttribute('p') || '').split(',');
			if (p.length < 4) {
				continue;
			}
			list.push({
				progress: Math.round(parseFloat(p[0]) * 1000) || 0,
				mode: Number(p[1]) || 1,
				fontsize: Number(p[2]) || 25,
				color: Number(p[3]) || 16777215,
				ctime: Number(p[4]) || 0,
				pool: Number(p[5]) || 0,
				midHash: p[6] || '',
				idStr: p[7] || '',
				weight: Number(p[8]) || 10,
				attr: 0,
				id: i + 1,
				content: nodes[i].textContent || '',
			});
		}
		return list;
	}

	/** json 弹幕：兼容 {elems:[]}、{data:{elems:[]}} 与顶层数组，字段名也做兼容 */
	function parseDanmakuJson(text) {
		var raw = JSON.parse(text);
		var arr = Array.isArray(raw)
			? raw
			: raw.elems || (raw.data && (raw.data.elems || raw.data.danmaku)) || raw.danmaku || [];
		if (!Array.isArray(arr)) {
			throw new Error('JSON 里没找到弹幕数组（支持 elems 或顶层数组）');
		}
		return arr.map(function (it, i) {
			it = it || {};
			var seconds =
				it.progress !== undefined
					? Number(it.progress) / 1000
					: Number(it.time !== undefined ? it.time : it.stime) || 0;
			return {
				progress: Math.round(seconds * 1000),
				mode: Number(it.mode !== undefined ? it.mode : it.type) || 1,
				fontsize: Number(it.fontsize !== undefined ? it.fontsize : it.size) || 25,
				color: Number(it.color) || 16777215,
				ctime: Number(it.ctime !== undefined ? it.ctime : it.date) || 0,
				pool: Number(it.pool) || 0,
				midHash: it.midHash || it.uhash || it.uid || '',
				idStr: it.idStr || it.dmid || (it.id !== undefined ? String(it.id) : ''),
				weight: Number(it.weight) || 10,
				attr: 0,
				id: i + 1,
				content: String(it.content !== undefined ? it.content : it.text !== undefined ? it.text : it.m || ''),
			};
		});
	}

	/* ---------- 极简 protobuf 编码（把弹幕喂给播放器内部解码器） ----------
	 * 播放器的弹幕来自 /x/v2/dm/web/seg.so（protobuf，DmSegMobileReply），
	 * 它内部用 const/dm.json 的 schema 解码，这里按同一 schema 编码即可。
	 */
	function pbVarint(bytes, value) {
		value = Math.max(0, Math.round(value) || 0);
		while (value > 127) {
			bytes.push((value & 127) | 128);
			value = Math.floor(value / 128);
		}
		bytes.push(value & 127);
	}

	function pbTag(bytes, field, wire) {
		pbVarint(bytes, field * 8 + wire);
	}

	function pbInt(bytes, field, value) {
		pbTag(bytes, field, 0);
		pbVarint(bytes, value);
	}

	function pbStr(bytes, field, value) {
		value = String(value == null ? '' : value);
		var arr = [];
		for (var i = 0; i < value.length; i++) {
			var c = value.charCodeAt(i);
			if (c < 0x80) {
				arr.push(c);
			} else if (c < 0x800) {
				arr.push(0xc0 | (c >> 6), 0x80 | (c & 63));
			} else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length) {
				var c2 = value.charCodeAt(++i);
				var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
				arr.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
			} else {
				arr.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
			}
		}
		pbTag(bytes, field, 2);
		pbVarint(bytes, arr.length);
		for (var k = 0; k < arr.length; k++) {
			bytes.push(arr[k]);
		}
	}

	function pbMsg(bytes, field, inner) {
		pbTag(bytes, field, 2);
		pbVarint(bytes, inner.length);
		for (var i = 0; i < inner.length; i++) {
			bytes.push(inner[i]);
		}
	}

	/** DanmakuElem：1 id、2 progress(ms)、3 mode、4 fontsize、5 color、6 midHash、7 content、8 ctime、9 weight、11 pool、12 idStr */
	function encodeDanmakuElem(it) {
		var b = [];
		pbInt(b, 1, it.id);
		pbInt(b, 2, it.progress);
		pbInt(b, 3, it.mode);
		pbInt(b, 4, it.fontsize);
		pbInt(b, 5, it.color);
		pbStr(b, 6, it.midHash);
		pbStr(b, 7, it.content);
		pbInt(b, 8, it.ctime);
		pbInt(b, 9, it.weight);
		pbInt(b, 11, it.pool);
		pbStr(b, 12, it.idStr);
		return b;
	}

	/** DmSegMobileReply：repeated DanmakuElem elems = 1 */
	function encodeDanmakuSeg(items) {
		var out = [];
		items.forEach(function (it) {
			pbMsg(out, 1, encodeDanmakuElem(it));
		});
		return new Uint8Array(out).buffer;
	}

	/** DmWebViewReply：1 state、2 text、4 dmSge(DmSegConfig)、8 count
	 *  pageSize 给成整段时长，这样播放器只会请求 1 个分段（否则长视频会拉几百段、
	 *  每段失败还会递归重试，把主线程淹死） */
	function encodeDmView(count, durationSec) {
		var b = [];
		pbInt(b, 1, 0);
		pbStr(b, 2, '演示弹幕');
		pbInt(b, 8, count);
		var sge = [];
		pbInt(sge, 1, Math.max(6000, Math.round((durationSec || 0) * 1000)));
		pbInt(sge, 2, 1);
		pbMsg(b, 4, sge);
		return new Uint8Array(b).buffer;
	}

	/** 已答复过的分段（同一分段只喂一次，避免重复叠加弹幕） */
	var servedSegments = {};

	/** 取某个分段的弹幕（按时间窗切分，和 view 里的 pageSize 对应） */
	function danmakuSegment(index) {
		var key = String(index);
		if (servedSegments[key]) {
			return new ArrayBuffer(0);
		}
		servedSegments[key] = true;
		var pageSec = Math.max(6, state.duration || 0);
		var from = (index - 1) * pageSec;
		var to = index * pageSec;
		var items = danmaku.items.filter(function (it) {
			return it.progress >= from * 1000 && it.progress < to * 1000;
		});
		// 便于排查重复：记录每个分段实际喂出去的条数
		window.__demoDanmakuServed = window.__demoDanmakuServed || { segments: {}, items: 0 };
		window.__demoDanmakuServed.segments[index] = items.length;
		window.__demoDanmakuServed.items += items.length;
		return encodeDanmakuSeg(items);
	}

	/** 读取弹幕文件（.xml / .json），解析后让播放器重新拉取弹幕 */
	function setDanmakuFromFile(file) {
		if (!file) {
			return;
		}
		var name = file.name || 'danmaku';
		var isJson = /\.json$/i.test(name);
		setStatus('正在读取弹幕文件：' + name + ' …');
		file.text()
			.then(function (text) {
				var items = isJson ? parseDanmakuJson(text) : parseDanmakuXml(text);
				if (!items.length) {
					setStatus('弹幕文件里没有解析到弹幕：' + name, 'warn');
					return;
				}
				danmaku.items = items;
				danmaku.name = name;
				if (!state.url) {
					setStatus('弹幕已就绪（' + items.length + ' 条），播放视频时会自动装入', 'ok');
					return;
				}
				// 播放器的弹幕只在初始化时拉取，所以重新起播一次让它带上弹幕
				var at = 0;
				try {
					at = window.player && window.player.getCurrentTime ? window.player.getCurrentTime() : 0;
				} catch (e) {
					at = 0;
				}
				setStatus('已解析 ' + items.length + ' 条弹幕（' + name + '），正在重新载入播放器…');
				boot();
				if (at > 1) {
					setTimeout(function () {
						try {
							window.player.seek(at);
						} catch (e) {
							/* 忽略 */
						}
					}, 6000);
				}
			})
			.catch(function (e) {
				setStatus('弹幕文件读取或解析失败：' + (e && e.message ? e.message : e), 'error');
			});
	}

	function boot() {
		var url = state.url;
		var type = state.type;
		var name = url.split('/').pop().split('?')[0] || '外部视频';

		setStatus('正在准备播放器…');
		teardown();

		probeDuration(url, type, state.source, state.size).then(function (duration) {
			state.duration = duration;
			// 播放器要的全局数据
			window.__INITIAL_STATE__ = buildInitialState(name, type, duration);
			window.__playinfo__ = buildPlayurl(url, type, duration, 0);
			window.__playurlMap__ = {};
			window.__playurlMap__[DEMO_CID] = window.__playinfo__;
			window.aid = DEMO_AID;
			window.bvid = DEMO_BVID;
			window.cid = DEMO_CID;
			window.pageno = 1;
			window.show_bv = true;

			if (type !== 'flv') {
				forceNativePlayer();
			}

			installNetworkBridge();

			// 播放器默认会把 http 源改写成 https（enable_ssl_stream 默认 true），http 直链必须关掉
			var params = 'cid=' + DEMO_CID + '&aid=' + DEMO_AID + '&autoplay=1&as_wide=1';
			if (/^http:\/\//i.test(url)) {
				params += '&enable_ssl_stream=0';
			}

			try {
				window.EmbedPlayer('player', '', params, '', false, function () { }, true);
			} catch (e) {
				setStatus('播放器启动失败：' + (e && e.message ? e.message : e), 'error');
				return;
			}

			if (type === 'm3u8') {
				setStatus('正在等待播放器创建 video 元素，随后交给 hls.js…');
				attachHls(url);
			} else {
				setStatus('已用 ' + type.toUpperCase() + ' 链路启动播放器：' + url, 'ok');
			}
		});
	}

	function start() {
		statusNode = document.getElementById('demo-status');
		if (!window.jQuery) {
			setStatus('缺少 jQuery：请先执行 node public/build-demo.mjs 准备 public/vendor（播放器不会自带全局 $）', 'error');
			return;
		}
		if (!window.EmbedPlayer) {
			setStatus('缺少播放器产物 video.js：请先执行 npm run build 与 node public/build-demo.mjs', 'error');
			return;
		}
		var url = getParam('url') || (document.getElementById('demo-url') || {}).value || '';
		var type = getParam('type') || (document.getElementById('demo-type') || {}).value || 'auto';
		var input = document.getElementById('demo-url');
		var select = document.getElementById('demo-type');
		if (input) {
			input.value = url;
		}
		if (select) {
			select.value = type;
		}
		if (!url) {
			setStatus('请输入 mp4 / flv / m3u8 直链，或点击下面的示例', 'warn');
			return;
		}
		state.url = url;
		state.type = guessType(url, type);
		boot();
	}

	/** 统一入口：设置地址与类型后启动播放 */
	function startPlayback(url, type, label) {
		state.url = url;
		state.type = guessType(url, type || 'auto');
		var input = document.getElementById('demo-url');
		var select = document.getElementById('demo-type');
		if (input && label) {
			input.value = label;
		}
		if (select) {
			select.value = type || 'auto';
		}
		boot();
	}

	window.demoPlayerStart = function (url, type) {
		if (!url) {
			return;
		}
		var input = document.getElementById('demo-url');
		var select = document.getElementById('demo-type');
		if (input) {
			input.value = url;
		}
		if (select) {
			select.value = type || 'auto';
		}
		startPlayback(url, type || (select && select.value) || 'auto');
	};

	/** 本地文件播放：用 object URL 喂给播放器（拖拽与“选择本地文件”都走这里） */
	window.demoPlayerLocalFile = function (file) {
		if (!file) {
			return;
		}
		// 弹幕文件（.xml / .json）走弹幕通道，不要当成视频
		if (/\.(xml|json)$/i.test(file.name || '')) {
			setDanmakuFromFile(file);
			return;
		}
		if (localObjectURL) {
			try {
				URL.revokeObjectURL(localObjectURL);
			} catch (e) {
				/* 忽略 */
			}
		}
		localObjectURL = URL.createObjectURL(file);
		state.source = file;
		state.size = file.size || 0;
		var type = guessType(file.name || '', 'auto');
		setStatus('正在用本地文件播放：' + (file.name || '未命名') + '（' + type + ' 链路，' + Math.round((file.size || 0) / 1048576) + ' MB）');
		// 本地文件不需要写回地址框，避免把文件名当成地址
		startPlayback(localObjectURL, type);
	};

	/** 只加载弹幕文件（页面上的“选择弹幕”按钮走这里） */
	window.demoPlayerDanmakuFile = setDanmakuFromFile;

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}
})();