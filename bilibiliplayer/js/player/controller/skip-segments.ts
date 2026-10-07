import STATE from '../state';
import Player from '../../player';
import { ISkipSegments } from '../../io/rebuild-player-extra-params';
import { IItemExtInterface } from '../toast';

class SkipSegments {
	private head?: number[];
	private tail?: number[];
	private duration!: number;
	private timer = 0;
	private toast?: IItemExtInterface;
	/** 当前提示对应的片段区间（`[start, end]`），用于判断用户是否已经越过它 */
	private promptedRange?: number[];

	constructor(private player: Player, private skipSegments: ISkipSegments) {
		setTimeout(() => {
			this.player.userLoadedCallback(() => {
				this.init();
			});
		});
	}
	private init() {
		this.getDuration();
		if (this.duration) {
			this.create();
		} else {
			this.beforeCreate();
		}
	}
	private getDuration() {
		this.duration = this.player.duration() || 0;
	}
	private beforeCreate() {
		this.timer = window.setTimeout(() => {
			this.getDuration();
			if (this.duration) {
				this.init();
			} else {
				this.beforeCreate();
			}
		}, 100);
	}
	private create() {
		this.head = this.skipSegments.head ?? [];
		this.tail = this.skipSegments.tail ?? [];

		// -1代表跳到片尾
		if (this.tail && this.tail[1] < 0) {
			this.tail[1] = this.duration;
		}

		this.events();
	}
	reload(skipSegments?: ISkipSegments) {
		this.destroy();
		if (skipSegments) {
			this.skipSegments = skipSegments;
		}
		this.head = undefined;
		this.tail = undefined;
		this.duration = 0;
		this.init();
	}
	// 判断是否要自动跳过首尾
	autoSkipSegments(currentTime: number, isRange = false) {
		if (this.player.errorPlayurl) return;
		if (!this.player.get('video_status', 'skipheadtail')) return;
		// 播放中自行越过片段末尾（片段很短时会发生）也要撤掉提示
		this.checkPromptedRange(currentTime);
		if (!this.player.video || this.player.video.paused) return;

		this.autoSeekTail(currentTime, isRange);
	}
	private autoSeekTail(currentTime: number, isRange = false) {
		const skip = this.player.get('video_status', 'skipheadtail');
		const duration = this.player.duration() || 0;
		const head = this.head;
		const tail = this.tail;

		if (head && head[0] >= duration) return;

		let isHead = -1;
		if (isRange) {
			// 在片头片尾中间也跳转
			if (head && currentTime >= head[0] && currentTime < head[1]) {
				isHead = 1;
			}
			if (tail && currentTime >= tail[0] && currentTime < tail[1]) {
				isHead = 0;
			}
		} else {
			if (head && currentTime >= head[0] && currentTime - head[0] < 0.3) {
				isHead = 1;
			}
			if (tail && currentTime >= tail[0] && currentTime - tail[0] < 0.3) {
				isHead = 0;
			}
		}
		if (isHead > -1) {
			const enSkip = () => {
				if (!isHead && tail && tail[0] >= duration) return;
				this.player.toast.addTopHinter(`正在为您跳转${isHead ? '片头' : '片尾'}`, 1000);
				this.player.seek(isHead ? head![1] : tail![1]);
			}
			switch (skip) {
				case 1: {
					// 同一时刻只保留一条提示：重复进入片段起点时先撤掉旧的（否则旧倒计时还会照跳）
					this.cancel();
					this.toast = this.player.toast.addBottomHinter({
						restTime: 5,
						closeButton: true,
						text: `秒后跳转${isHead ? '片头' : '片尾'}`,
						jump: '立即跳转',
						jumpFunc: enSkip,
						successCallback: enSkip
					});
					// 记下这条提示对应哪段，用户把进度调到它后面时自动撤掉
					this.promptedRange = isHead ? head : tail;
					break;
				}
				case 2:
					enSkip();
					break;
				default:
					break;
			}
		}
	}
	private destroyHandler = () => this.destroy();
	/**
	 * 取消当前待跳转的提示：把提示 X 掉，并让倒计时停摆（因此不会执行自动跳过）。
	 * 用户选择其它跳转（例如跳到自己上次观看的进度）、或用户自己把进度调到片段之后时调用。
	 */
	cancel() {
		this.toast?.stop();
		this.toast = undefined;
		this.promptedRange = undefined;
	}
	/**
	 * 当前进度是否已经越过提示对应的片段：
	 * 片头提示出现在片段起点，用户（键盘 / 拖进度条 / 外部跳转）跳到片段之后就没必要再跳了；
	 * 片尾提示同理，超过片尾之后直接撤掉。
	 */
	private checkPromptedRange(time?: number) {
		const range = this.promptedRange;
		if (!range || typeof time !== 'number') return;
		if (time >= range[1]) {
			this.cancel();
		}
	}
	/** 用户主动 seek 时的处理（`player.seek()` 一定会触发 VIDEO_MEDIA_SEEK，暂停时同样有效） */
	private seekHandler = (e: JQuery.Event, obj?: { time: number }) => {
		this.checkPromptedRange(obj && obj.time);
	};
	private events() {
		// 防止 reload 后重复绑定导致 VIDEO_DESTROY 触发时多次执行 destroy
		this.player.unbind(STATE.EVENT.VIDEO_DESTROY, <any>this.destroyHandler);
		this.player.bind(STATE.EVENT.VIDEO_DESTROY, <any>this.destroyHandler);
		this.player.unbind(STATE.EVENT.VIDEO_MEDIA_SEEK, <any>this.seekHandler);
		this.player.bind(STATE.EVENT.VIDEO_MEDIA_SEEK, <any>this.seekHandler);
	}
	private destroy() {
		this.timer && clearTimeout(this.timer);
		this.timer = 0;
		this.cancel();
		// 不再清空 extraParams.skipSegments，避免破坏切换视频后新的可跳过片段数据
	}
}

export default SkipSegments;
