/*
 * Bilibili-Old Player 演示页引导脚本
 *
 * 播放器并不接受「视频直链」这种参数：它要的是一份 B 站的 playurl 数据。
 * 所以这个脚本负责把用户给的直链「包装」成播放器认识的世界：
 *
 *   1. 判定地址类型（mp4 / flv，也支持手动指定）；
 *   2. 合成 playurl（渐进式 durl）与视频元数据 __INITIAL_STATE__；
 *   3. 拦截播放器发出的 playurl 接口请求，直接喂回合成数据
 *      （这样画质切换、重新载入等后续请求也不会打到 B 站接口上）；
 *   4. 按类型调整 flvjs 能力：mp4 时让 flvjs.isSupported() 返回 false，
 *      迫使播放器走「原生 video」链路（播放器构造函数里就是这么判定的）；
 *   5. 启动播放器。
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
		/** 探测到的原始分辨率，用来映射画质名称 */
		width: 0,
		height: 0,
	};

	/** 本地文件的 object URL（切换文件时要释放） */
	var localObjectURL = '';

	/** 已载入的弹幕（解析成播放器要的 IDmData 形状后缓存，换源时重新装入） */
	var danmaku = {
		items: [],
		name: '',
	};

	/**
	 * 只在需要提醒用户时（出错 / 用法不对）从顶部弹出提示条；
	 * 正常流程的信息不再打扰用户，点提示条右侧的 ✕ 或 demoPlayerCloseError() 可关闭。
	 */
	function setStatus(text, kind) {
		if (kind !== 'error' && kind !== 'warn') {
			return;
		}
		var box = document.getElementById('demo-error');
		var label = document.getElementById('demo-error-text');
		if (!box || !label) {
			return;
		}
		label.textContent = text;
		box.hidden = false;
	}

	/** 关闭顶部提示条 */
	window.demoPlayerCloseError = function () {
		var box = document.getElementById('demo-error');
		if (box) {
			box.hidden = true;
		}
	};

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
	 * 按地址（或本地文件名）自动推断类型
	 * @param {string} url 视频地址或文件名
	 */
	function guessType(url) {
		var path = url.split('#')[0].split('?')[0].toLowerCase();
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
				var grab = function (key) {
					var pos = text.indexOf(key);
					if (pos > 0 && pos + 9 <= u8.length - 8) {
						var v = new DataView(buf).getFloat64(pos + 9);
						if (isFinite(v) && v > 0 && v < 100000) {
							return Math.round(v);
						}
					}
					return 0;
				};
				state.width = grab('width');
				state.height = grab('height');
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
				state.width = video.videoWidth || 0;
				state.height = video.videoHeight || 0;
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
	/** 按视频原始分辨率映射到 B 站画质档位与名称
	 *  按「长边」判断：4K 也可能是 3840×1920 这类非 16:9 比例，竖屏视频也能正确归类
	 */
	function qualityForSize(width, height) {
		var edge = Math.max(width || 0, height || 0);
		if (edge >= 3840) {
			return { id: 120, label: '4K 超清' };
		}
		if (edge >= 2560) {
			return { id: 112, label: '2K 超清' };
		}
		if (edge >= 1920) {
			return { id: 80, label: '1080P 高清' };
		}
		if (edge >= 1280) {
			return { id: 64, label: '720P 高清' };
		}
		if (edge >= 854) {
			return { id: 32, label: '480P 清晰' };
		}
		if (edge >= 640) {
			return { id: 16, label: '360P 流畅' };
		}
		return { id: 6, label: '240P 极速' };
	}

	function buildPlayurl(url, type, durationSec, quality) {
		var isFlv = type === 'flv';
		var format = isFlv ? 'flv' : 'mp4';
		var durationMs = Math.round((durationSec || 0) * 1000);
		var q = qualityForSize(state.width, state.height);
		var qn = quality || q.id;
		var qname = q.label;
		return {
			code: 0,
			message: '0',
			ttl: 1,
			data: {
				from: 'local',
				result: 'suee',
				quality: qn,
				format: format,
				timelength: durationMs,
				accept_format: format,
				accept_quality: [qn],
				accept_description: [qname],
				support_formats: [
					{
						quality: qn,
						format: format,
						new_description: qname,
						display_desc: qname,
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
		// JSONP 请求（带 callback=xxx）要把结果包进回调里，否则对方拿不到数据
		var cb = /[?&]callback=([^&]+)/.exec(xhr.__demoURL || '');
		if (cb && !binary) {
			text = decodeURIComponent(cb[1]) + '(' + text + ')';
			mime = 'text/javascript';
		}
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
			// 下面这几个接口在演示环境里必然打不通，播放器会反复重试（拖慢页面），
			// 所以直接给出「接口明确说不行」的正常 HTTP 应答，让它别再重试
			if (/player\/(wbi\/)?v2/i.test(url)) {
				return { code: -404, message: '演示模式：无登录态' };
			}
			if (/click-interface\/web\/heartbeat/i.test(url)) {
				return { code: 0, message: '0', data: {} };
			}
			if (/web-interface\/broadcast\/servers/i.test(url)) {
				return { code: 0, message: '0', data: { servers: [] } };
			}
			if (/player\/pagelist/i.test(url)) {
				return { code: 0, message: '0', data: window.__INITIAL_STATE__.videoData.pages };
			}
			if (/dm\/filter\/user/i.test(url)) {
				return { code: 0, message: '0', data: { rule: '', type: [] } };
			}
			// 下面这些同样是打不通就会不停重试的接口，给「成功但没有数据」的应答
			if (/comment\.bilibili\.com\/playtag|playtag,/i.test(url)) {
				return { code: 0, message: '0', data: [] };
			}
			if (/player\/online\/total/i.test(url)) {
				return { code: 0, message: '0', data: { total: '0', count: '0' } };
			}
			if (/pbp\/data/i.test(url)) {
				return { code: -404, message: '演示模式：无高能进度条数据' };
			}
			if (/player\/videoshot/i.test(url)) {
				return { code: -404, message: '演示模式：无缩略图' };
			}
			if (/\/x\/v2\/dm\/post/i.test(url)) {
				return { code: -404, message: '演示模式：不能发送弹幕' };
			}
			if (/comment\.bilibili\.com\/recommend/i.test(url)) {
				return { code: 0, message: '0', data: [] };
			}
			// 保底：B 站各域名下没被上面接管的接口，一律给「接口明确说不行」的正常应答，
			// 避免 CORS 报错与无限重试；媒体文件（flv / mp4 / 分片等）放行，交给播放器自己取
			var isBiliApi = /bilibili\.com|bilivideo\.com|hdslb\.com|biliapi\.net/i.test(url);
			var isMediaFile = /\.(flv|mp4|m4s|m4a|mp3|aac|ts|m3u8|mpd|webm|ogg|wav)([?#]|$)/i.test(url);
			if (isBiliApi && !isMediaFile) {
				return { code: -404, message: '演示模式：该接口未实现' };
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

		// 广播服务在演示环境没有可用服务器，直接把这类 WebSocket 静音，避免反复重连刷报错
		if (typeof window.WebSocket === 'function') {
			var RealWebSocket = window.WebSocket;
			var SilentWebSocket = function (url, protocols) {
				if (/\/sub\?|broadcast|platform=web/.test(String(url))) {
					return {
						url: String(url),
						readyState: 3,
						close: function () { },
						send: function () { },
						addEventListener: function () { },
						removeEventListener: function () { },
						dispatchEvent: function () {
							return false;
						},
					};
				}
				return protocols ? new RealWebSocket(url, protocols) : new RealWebSocket(url);
			};
			SilentWebSocket.prototype = RealWebSocket.prototype;
			['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
				SilentWebSocket[k] = RealWebSocket[k];
			});
			window.WebSocket = SilentWebSocket;
		}

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

	/**
 * mp4 强制走原生链路
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
		// 有些导出的 xml 声明成了 version="2.0"，浏览器只认 1.0 会直接判整份文件解析失败，
		// 所以先把 xml 声明整段去掉，并清掉 B 站偶尔输出的非法控制字符
		var clean = String(text)
			.replace(/^\uFEFF/, '')
			.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '')
			.replace(/<\?xml[\s\S]*?\?>/i, '');
		var doc = new DOMParser().parseFromString(clean, 'text/xml');
		var nodes = doc.getElementsByTagName('d');
		var parsed = [];
		for (var i = 0; i < nodes.length; i++) {
			parsed.push({ p: nodes[i].getAttribute('p') || '', content: nodes[i].textContent || '' });
		}
		if (!parsed.length) {
			// DOMParser 仍失败时退化成正则抽取（<d p="...">文本</d>）
			var re = /<d\s+[^>]*\bp\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/d>/gi;
			var m;
			while ((m = re.exec(clean))) {
				parsed.push({ p: m[1], content: m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') });
			}
		}
		var list = [];
		for (var k = 0; k < parsed.length; k++) {
			var p = String(parsed[k].p).split(',');
			if (p.length < 4) {
				continue;
			}
			var item;
			if (Number(p[0]) > 1e9) {
				// 变体格式：dmid, ?, 进度(毫秒), mode, 字号, 颜色, 时间戳, 弹幕池, midHash
				// 例：<d p="39000861616111621,0,36619,1,25,16777215,1601530082,0,ce06ff22">b站nb</d>
				item = {
					progress: Number(p[2]) || 0,
					mode: Number(p[3]) || 1,
					fontsize: Number(p[4]) || 25,
					color: Number(p[5]) || 16777215,
					ctime: Number(p[6]) || 0,
					pool: Number(p[7]) || 0,
					midHash: p[8] || '',
					idStr: p[0],
					weight: Number(p[9]) || 10,
				};
			} else {
				// 经典格式：时间(秒), mode, 字号, 颜色, 时间戳, 弹幕池, midHash, dmid, 权重
				item = {
					progress: Math.round(parseFloat(p[0]) * 1000) || 0,
					mode: Number(p[1]) || 1,
					fontsize: Number(p[2]) || 25,
					color: Number(p[3]) || 16777215,
					ctime: Number(p[4]) || 0,
					pool: Number(p[5]) || 0,
					midHash: p[6] || '',
					idStr: p[7] || '',
					weight: Number(p[8]) || 10,
				};
			}
			item.attr = 0;
			item.id = k + 1;
			item.content = parsed[k].content;
			list.push(item);
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

	/** 弹幕文本 -> 装入播放器（xml / json 自动判断） */
	function setDanmakuFromText(text, name) {
		var isJson = /\.json$/i.test(name || '') || /^\s*[[{]/.test(text);
		var items = isJson ? parseDanmakuJson(text) : parseDanmakuXml(text);
		if (!items.length) {
			setStatus('弹幕里没有解析到内容：' + name, 'warn');
			return;
		}
		danmaku.items = items;
		danmaku.name = name || 'danmaku';
		servedSegments = {};
		// 便于排查：把解析结果挂在 window 上（含首个弹幕的内容与时间）
		window.__demoDanmakuParsed = {
			name: danmaku.name,
			count: items.length,
			first: items[0] ? { progress: items[0].progress, mode: items[0].mode, color: items[0].color, content: items[0].content } : null,
		};
		if (!state.url) {
			setStatus('弹幕已就绪（' + items.length + ' 条），播放视频时会自动装入', 'ok');
			return;
		}
		// 播放器只在初始化时拉弹幕，所以重新起播一次
		var at = 0;
		try {
			at = window.player && window.player.getCurrentTime ? window.player.getCurrentTime() : 0;
		} catch (e) {
			at = 0;
		}
		setStatus('已解析 ' + items.length + ' 条弹幕（' + danmaku.name + '），正在重新载入播放器…');
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
	}

	/** 读取弹幕文件（.xml / .json） */
	function setDanmakuFromFile(file) {
		if (!file) {
			return;
		}
		var name = file.name || 'danmaku';
		setStatus('正在读取弹幕文件：' + name + ' …');
		file.text()
			.then(function (text) {
				setDanmakuFromText(text, name);
			})
			.catch(function (e) {
				setStatus('弹幕文件读取失败：' + (e && e.message ? e.message : e), 'error');
			});
	}

	/** 从地址加载弹幕（xml / json） */
	function setDanmakuFromUrl(url) {
		if (!url) {
			return;
		}
		var name = url.split('/').pop().split('?')[0] || 'danmaku';
		setStatus('正在下载弹幕：' + url + ' …');
		let _url = new URL(`https://corsproxy.io/?key=94f3f2c0`);
		_url.searchParams.set("url", url);
		fetch(_url.href)
			.then(function (r) {
				if (!r.ok) {
					throw new Error('HTTP ' + r.status);
				}
				return r.text();
			})
			.then(function (text) {
				setDanmakuFromText(text, name);
			})
			.catch(function (e) {
				setStatus('弹幕下载失败（需要目标服务器允许跨域）：' + (e && e.message ? e.message : e), 'error');
			});
	}

	/**
	 * 演示页专用：把误入的迷你播放器扳回普通模式。
	 * 播放器内部 controller._resize() 以「容器 <480 宽或 <360 高」判定迷你模式，
	 * 演示页初始化/换源的一瞬间容器可能是 0 尺寸，会被误判，且之后没有 resize 事件就不再纠正
	 * （表现就是控制栏消失）。这里只在真的处于迷你模式时恢复，不影响宽屏/全屏等其它模式。
	 */
	function keepNormalMode() {
		try {
			var marked = document.querySelectorAll('.mode-miniscreen');
			if (!marked.length) {
				return;
			}
			for (var i = 0; i < marked.length; i++) {
				marked[i].classList.remove('mode-miniscreen');
			}
			if (window.player && typeof window.player.mode === 'function') {
				window.player.mode(0);
			}
		} catch (e) {
			/* 忽略 */
		}
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
			var params = 'cid=' + DEMO_CID + '&aid=' + DEMO_AID + '&autoplay=0&as_wide=1';
			if (/^http:\/\//i.test(url)) {
				params += '&enable_ssl_stream=0';
			}

			try {
				window.EmbedPlayer('player', '', params, '', false, function () { }, true);
			} catch (e) {
				setStatus('播放器启动失败：' + (e && e.message ? e.message : e), 'error');
				return;
			}

			/* 起播后多试几次（播放器初始化是异步的），把可能被误判的迷你模式纠正回来 */
			[300, 900, 2000, 4000].forEach(function (ms) {
				setTimeout(keepNormalMode, ms);
			});
			if (!window.__demoMiniGuard) {
				window.__demoMiniGuard = true;
				// 窗口尺寸变化后播放器会重新判定，这里再兜一次
				window.addEventListener('resize', function () {
					setTimeout(keepNormalMode, 250);
				});
			}

			setStatus('已用 ' + type.toUpperCase() + ' 链路启动播放器：' + url, 'ok');

		});
	}

	function start() {
		if (!window.jQuery) {
			setStatus('缺少 jQuery：请先执行 node public/build.mjs 准备演示文件', 'error');
			return;
		}
		if (!window.EmbedPlayer) {
			setStatus('缺少播放器产物 video.js：请先执行 npm run build 与 node public/build.mjs', 'error');
			return;
		}
		var url = getParam('url') || (document.getElementById('demo-vd-url') || {}).value || '';
		var input = document.getElementById('demo-vd-url');
		if (input) {
			input.value = url;
		}
	}

	/** 统一入口：设置地址与类型后启动播放 */
	function startPlayback(url, detectFrom, label) {
		state.url = url;
		state.type = guessType(detectFrom || url);
		var input = document.getElementById('demo-vd-url');
		if (input && label) {
			input.value = label;
		}
		boot();
	}

	window.demoPlayerStart = function (url) {
		if (!url) {
			return;
		}
		var input = document.getElementById('demo-vd-url');
		if (input) {
			input.value = url;
		}
		startPlayback(url);
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
		var type = guessType(file.name || '');
		setStatus('正在用本地文件播放：' + (file.name || '未命名') + '（' + type + ' 链路，' + Math.round((file.size || 0) / 1048576) + ' MB）');
		// 本地文件不需要写回地址框，避免把文件名当成地址
		startPlayback(localObjectURL, file.name || '');
	};

	/** 只加载弹幕文件（页面上的“弹幕文件”按钮走这里） */
	window.demoPlayerDanmakuFile = setDanmakuFromFile;

	/** 从地址加载弹幕（xml / json 链接） */
	window.demoPlayerDanmakuUrl = setDanmakuFromUrl;

	/** 移除弹幕：清空列表并让播放器重新起播（弹幕只在初始化时装载） */
	window.demoPlayerClearDanmaku = function () {
		danmaku.items = [];
		danmaku.name = '';
		servedSegments = {};
		var dmUrl = document.getElementById('demo-dm-url');
		if (dmUrl) {
			dmUrl.value = '';
		}
		var dmFile = document.getElementById('demo-dm-file');
		if (dmFile) {
			dmFile.value = '';
		}
		setStatus('已移除弹幕，正在重新载入播放器…');
		if (state.url) {
			boot();
		} else {
			setStatus('已移除弹幕', 'ok');
		}
	};

	/** 移除视频：拆掉播放器并清空状态 */
	window.demoPlayerClearVideo = function () {
		teardown();
		state.url = '';
		state.type = 'mp4';
		state.duration = 0;
		state.source = null;
		state.size = 0;
		if (localObjectURL) {
			try {
				URL.revokeObjectURL(localObjectURL);
			} catch (e) {
				/* 忽略 */
			}
			localObjectURL = '';
		}
		var input = document.getElementById('demo-vd-url');
		if (input) {
			input.value = '';
		}
		var file = document.getElementById('demo-vd-file');
		if (file) {
			file.value = '';
		}
		var bofqi = document.getElementById('bilibili-player') || document.getElementById('bofqi');
		if (bofqi) {
			bofqi.innerHTML = '<div id="player_placeholder" class="player"></div>';
		}
		var bgbtn = document.getElementsByClassName("bgray-btn-wrap")?.[0];
		if (bgbtn) {
			bgbtn?.remove?.();
		}
		setStatus('已移除视频，可以重新输入地址或选择本地文件', 'ok');
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}
})();