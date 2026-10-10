import Utils from './common/utils';
import Danmaku, { IDanmakuOptions } from './component/danmaku';
import TestCSS3 from './component/test-css3';
import TestCanvas2D from './component/test-canvas2d';

interface IManagerOptions {
    [key: string]: any;
}

interface ILayoutBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface ILayoutCache {
    cw: number;
    ch: number;
    vw: number;
    vh: number;
    bh: number;
}

/**
 * 高级弹幕（mode 7）的坐标属于「作者当时那块画布」。
 * 16:9 的作品通常就是 810x456（与弹幕存档站的基准一致），但不同作品的画布大小并不相同：
 * 画布比 456 高的作品，如果一律按 456 换算，底部的弹幕就会被挤出画面。
 * 因此这里把 456 当作「最小基准」，再按弹幕自身的纵向分布估计实际画布高度。
 */
const DEFAULT_BASE_HEIGHT = 456;
/** 内容底边到画布底边留的余量（作者排版时通常也留了一点） */
const CONTENT_BASE_MARGIN = 1.04;
/** 估计值的上限，避免个别越界坐标把画布撑得过大 */
const MAX_BASE_HEIGHT_RATIO = 2.2;
/** 估计值变化超过这个比例才调整，避免播放过程中来回缩放 */
const BASE_HEIGHT_HYSTERESIS = 0.05;

export interface ITextData extends Object {
    dmid: string;
    mode: number;
    size: number;
    date: number;
    class: number;
    stime: number;
    color: number;
    uid: string;
    text: string;
    mid?: string;
    uname?: string;
}
interface IRepackTextData {
    textData: ITextData;
}

type GuidInterface = () => number;

class Manager {
    config: IManagerOptions;
    private paused: boolean;
    private sDate!: number;
    private createStatus: boolean;
    private dmList: Danmaku[];
    private cdmList: Danmaku[];
    private visableStatus: boolean;
    private initialType: string;
    private getId: GuidInterface;
    private canvas!: HTMLCanvasElement | HTMLElement;
    private ctx!: CanvasRenderingContext2D;
    private testManager!: TestCanvas2D | TestCSS3;
    container: HTMLElement;
    status!: boolean;
    sTime: number;
    dmexposure = 0;

    /** 基准画布尺寸（弹幕坐标所在的坐标系） */
    private _baseWidth = (DEFAULT_BASE_HEIGHT * 16) / 9;
    private _baseHeight = DEFAULT_BASE_HEIGHT;
    /** 由弹幕内容估计出的画布高度与其缓存 */
    private baseEstimate = 0;
    private baseEstimateCount = 0;
    private appliedBaseHeight = 0;
    /** 基准画布 -> 视频显示区域的映射（等比缩放 + 居中） */
    private viewScale = 1;
    private viewX = 0;
    private viewY = 0;
    private layoutCache: ILayoutCache | null = null;

    constructor(config: IManagerOptions) {
        this.container = config.container;
        this.config = Utils.assign(
            {
                container: document.getElementById('player'),
                danmakuNumber: -1, // -1 为无上限
                videoSpeed: 1,
                visible: true,
                type: 'div',
                baseHeight: 0, // 0 = 按弹幕内容自动估计（下限 456），>0 = 固定画布高度
                baseWidth: 0, // <=0 = 按视频宽高比推导，>0 = 固定画布宽度
                setType: (type: string) => { },
                blockJudge: (options: any) => { },
                getType: () => this.config.type,
                getDanmakuNumber: () => this.config.danmakuNumber,
                getVideoElement: null as null | (() => HTMLVideoElement | null),
            },
            config,
        );
        this.paused = true;
        this.sTime = 0;
        this.getId = this.guid();
        this.createStatus = false;
        this.dmList = []; // 总高级弹幕列表
        this.cdmList = []; // 当前高级弹幕列表
        this.visableStatus = this.config.visible;
        this.initialType = this.getType();
    }

    /** 基准画布宽度（弹幕 x 坐标的最大有效值，百分比坐标也基于它换算） */
    get baseWidth(): number {
        return this._baseWidth;
    }

    /** 基准画布高度（弹幕 y 坐标的最大有效值，百分比坐标也基于它换算） */
    get baseHeight(): number {
        return this._baseHeight;
    }

    /**
     * 当前的「基准画布 -> 显示区域」映射。
     * 测试预览等外挂图层可以复用同一套映射，保证和正式弹幕层一致。
     */
    getLayout() {
        this.updateLayout();
        return {
            x: this.viewX,
            y: this.viewY,
            scale: this.viewScale,
            width: this._baseWidth,
            height: this._baseHeight,
        };
    }

    count(): number {
        return this.cdmList ? this.cdmList.length : 0;
    }

    getType(): string {
        return this.config.getType();
    }

    addDanmaku(textData: ITextData, render?: boolean) {
        const danmaku = this.buildTextData(textData);
        if (!this.dmList) {
            this.dmList = [];
        }
        if (danmaku) {
            this.dmList.push(danmaku);
        }
        if (render) {
            danmaku!.renderStatus = true;
            this.drawDanmaku(danmaku!);
            this.cdmList.push(danmaku!);
        }
    }

    danmakuType(type: string) {
        if (!type || this.initialType === type) {
            return this.initialType;
        }
        if (this.dmList.length && this.visableStatus && this.canvas) {
            this.config.setType(type);
            this.typeChangeCheck();
            this.getType() === 'div' ? (this.canvas.innerHTML = '') : this.clearCanvas();
            this.refreshCdmList();
            this.drawDanmaku();
            return type;
        }
        return null;
    }

    exportDanmaku(): HTMLElement | null {
        const len = this.cdmList.length;
        if (len < 1) {
            return null;
        }
        this.updateLayout();
        const scale = this.viewScale || 1;
        const gifContainer = document.createElement('canvas');
        const giftext = <CanvasRenderingContext2D>gifContainer.getContext('2d');
        gifContainer.width = this.container.offsetWidth;
        gifContainer.height = this.container.offsetHeight;
        for (let i = 0; i < len; i++) {
            const danmaku = this.cdmList[i];
            danmaku.refresh(this.sTime, true);
            if (!danmaku.drawStatus || !danmaku.img) {
                continue;
            }
            const img = <HTMLCanvasElement>danmaku.img;
            // 基准坐标 -> 容器坐标
            const x = this.viewX + (danmaku.options.x - danmaku.options.offsetX) * scale;
            const y = this.viewY + (danmaku.options.y - danmaku.options.offsetY - 2) * scale;
            const w = (img.width || 0) * scale;
            const h = (img.height || 0) * scale;
            if (w > 0 && h > 0) {
                giftext.drawImage(img, x, y, w, h);
            } else {
                giftext.drawImage(img, x, y);
            }
        }
        return gifContainer;
    }

    remove(dmid: string) {
        let danmaku: Danmaku;
        this.dmList = this.dmList.filter((item) => item.options.dmid !== dmid);
        this.cdmList = this.cdmList.filter((item) => {
            if (item.options.dmid === dmid) {
                danmaku = item;
                return false;
            } else {
                return true;
            }
        });
        // @ts-ignore
        if (danmaku) {
            if (this.getType() === 'div') {
                danmaku.img && danmaku.img.remove && danmaku.img.remove();
            } else {
                this.refreshCdmList(true);
            }
        }
    }

    play() {
        if (this.dmList.length) {
            if (!this.createStatus) {
                this.create();
            }
            this.sDate = Date.now();
            this.paused = false;
            this.render();
        }
    }

    pause() {
        if (this.dmList.length) {
            this.paused = true;
        }
    }

    stop() {
        if (this.dmList.length) {
            this.sTime = 0;
            this.paused = true;
        }
    }

    seek(t: number) {
        if (!this.createStatus) {
            this.play();
            this.pause();
        }
        if (this.dmList.length && this.visableStatus && this.canvas) {
            this.sTime = t * 1000;
            this.sDate = Date.now();
            this.renderDanmaku();
        }
    }

    resize() {
        if (this.createStatus) {
            this.updateLayout(true);
            this.clearCanvas();
            this.drawDanmaku();
        }
        this.testManager && this.testManager.resize();
    }

    visible(value: boolean) {
        if (value !== this.visableStatus) {
            if (value) {
                // show
                this.visableStatus = true;
                this.render();
            } else {
                // hide
                this.visableStatus = false;
                this.clearCurrent();
            }
        }
    }

    clearCurrent() {
        if (this.getType() === 'div') {
            if (this.canvas) {
                this.canvas.innerHTML = '';
            }
        } else {
            this.clearCanvas();
        }
        this.cdmList.forEach(function (d: Danmaku) {
            d.renderStatus = false;
            d.img && d.img.remove && d.img.remove();
            d.img = null;
        });
        this.cdmList = [];
    }

    searchAreaDanmaku(e: MouseEvent): IRepackTextData[] {
        if (this.getType() === 'div') {
            return this.searchCSSArea(e.clientX || 0, e.clientY || 0);
        } else {
            // canvas 模式的 offsetX/offsetY 是画布 CSS 像素，换算回基准坐标
            const scale = this.viewScale || 1;
            return this.searchCanvasArea((e.offsetX || 0) / scale, (e.offsetY || 0) / scale);
        }
    }

    testDanmaku(textData: ITextData) {
        const danmaku = this.buildTextData(textData);
        danmaku!.options.stime = Date.now();
        if (this.getType() === 'div') {
            this.testManager = new TestCSS3(this.container, this);
        } else {
            this.testManager = new TestCanvas2D(this.container, this);
        }
        this.testManager.test(danmaku!);
    }

    option(key: any, value: any): any {
        if (!key) {
            return;
        }
        if (typeof value !== 'undefined') {
            switch (key) {
                case 'videospeed':
                    if (arguments.length === 1) {
                        return this.config.videoSpeed;
                    } else {
                        this.config.videoSpeed = value;
                    }
                    break;
                default:
                    this.config[key] = value;
                    break;
            }
        }
    }

    private guid(): GuidInterface {
        let id = 0;
        return function () {
            return id++;
        };
    }

    private create() {
        this.getType() === 'div' ? this.createDiv() : this.createCanvas();
        this.container && this.container.appendChild(this.canvas);
        this.createStatus = true;
        this.updateLayout(true);
        this.render();
    }

    private createDiv() {
        const canvas = document.createElement('div');
        canvas.style.position = 'absolute';
        canvas.style.left = '0px';
        canvas.style.top = '0px';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.background = 'transparent';
        canvas.style.zIndex = '10';
        canvas.style.transformOrigin = canvas.style.webkitTransformOrigin = '0 0';
        this.canvas = canvas;
    }

    private createCanvas() {
        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.width = this.container.offsetWidth;
        canvas.height = this.container.offsetHeight;
        canvas.style.background = 'transparent';
        canvas.style.zIndex = '10';
        this.ctx = <CanvasRenderingContext2D>canvas.getContext('2d');
        this.canvas = canvas;
    }

    /** 取播放器里的 video 元素，用于计算视频实际显示区域 */
    private getVideoElement(): HTMLVideoElement | null {
        const getter = this.config.getVideoElement;
        if (typeof getter === 'function') {
            const video = getter();
            if (video) {
                return video;
            }
        }
        const parent = this.container && this.container.parentElement;
        if (!parent || !parent.querySelector) {
            return null;
        }
        return <HTMLVideoElement>parent.querySelector('video');
    }

    /**
     * 视频实际画面框（去掉 letterbox / pillarbox 之后的内容区），坐标相对弹幕容器左上角。
     * 容器本身比画面大（黑边、内边距）时不能直接用容器尺寸，否则高级弹幕会整体偏移。
     */
    private getVideoBox(cw: number, ch: number, video: HTMLVideoElement | null): ILayoutBox {
        const full: ILayoutBox = { x: 0, y: 0, width: cw, height: ch };
        if (!video || !video.videoWidth || !video.videoHeight || !video.getBoundingClientRect || !this.container) {
            return full;
        }
        const containerRect = this.container.getBoundingClientRect();
        const videoRect = video.getBoundingClientRect();
        const ew = videoRect.width;
        const eh = videoRect.height;
        if (!ew || !eh) {
            return full;
        }
        const x = videoRect.left - containerRect.left;
        const y = videoRect.top - containerRect.top;
        let fit = 'fill';
        if (window.getComputedStyle) {
            const style = window.getComputedStyle(video);
            fit = style.objectFit || (<any>style)['object-fit'] || 'fill';
        }
        // object-fit: fill 时画面被拉伸到整个元素，直接用元素框
        if (fit === 'fill' || fit === 'cover') {
            return { x: x, y: y, width: ew, height: eh };
        }
        const ratio = video.videoWidth / video.videoHeight;
        let w = ew;
        let h = ew / ratio;
        if (h > eh) {
            h = eh;
            w = eh * ratio;
        }
        return { x: x + (ew - w) / 2, y: y + (eh - h) / 2, width: w, height: h };
    }

    /**
     * 用已加载弹幕的纵向分布估计作者画布高度。
     * 取「每条弹幕最低位置 + 自身文字高度」的 90 分位再留 4% 余量：
     * 既不会像最大值那样被个别越界坐标带跑，也不会让成片的底部内容被切掉。
     * 例：810x456 的作品估计值仍是 456（保持原样），而 851x561 的作品会得到 ~549。
     */
    private estimateBaseHeight(): number {
        const list = this.dmList;
        const len = list ? list.length : 0;
        if (!len) {
            return 0;
        }
        // 弹幕会随播放分段装入，按 5% 的量级重算即可，避免每帧排序
        if (this.baseEstimate && len < this.baseEstimateCount * 1.05) {
            return this.baseEstimate;
        }
        const bottoms: number[] = [];
        for (let i = 0; i < len; i++) {
            const options = list[i].options;
            const lines = (options.text || '').split(/\r|\n/).length;
            const bottom = Math.max(options.startY, options.endY) + options.size * lines;
            if (isFinite(bottom) && bottom > 0) {
                bottoms.push(bottom);
            }
        }
        this.baseEstimateCount = len;
        if (!bottoms.length) {
            return (this.baseEstimate = 0);
        }
        bottoms.sort((a, b) => a - b);
        const p90 = bottoms[Math.min(bottoms.length - 1, Math.floor(bottoms.length * 0.9))];
        return (this.baseEstimate = p90 * CONTENT_BASE_MARGIN);
    }

    /** 最终生效的画布高度：固定值优先，其次用估计值（夹在 [456, 456*2.2] 之间并做迟滞） */
    private resolveBaseHeight(): number {
        const configured = Number(this.config.baseHeight);
        if (configured > 0) {
            return configured;
        }
        const estimated = this.estimateBaseHeight();
        if (!estimated) {
            return this.appliedBaseHeight || DEFAULT_BASE_HEIGHT;
        }
        const target = Math.min(
            Math.max(estimated, DEFAULT_BASE_HEIGHT),
            DEFAULT_BASE_HEIGHT * MAX_BASE_HEIGHT_RATIO,
        );
        if (
            !this.appliedBaseHeight ||
            Math.abs(target - this.appliedBaseHeight) / this.appliedBaseHeight > BASE_HEIGHT_HYSTERESIS
        ) {
            this.appliedBaseHeight = target;
        }
        return this.appliedBaseHeight;
    }

    /**
     * 重算「基准画布 -> 视频显示区域」的映射。
     * 容器尺寸（全屏 / 宽屏 / resize）、视频分辨率或画布高度变化时才真正重算，避免每帧强制重排。
     */
    private updateLayout(force?: boolean): boolean {
        const container = this.container;
        if (!container) {
            return false;
        }
        const cw = container.offsetWidth;
        const ch = container.offsetHeight;
        if (!cw || !ch) {
            return false;
        }
        const video = this.getVideoElement();
        const vw = video ? video.videoWidth || 0 : 0;
        const vh = video ? video.videoHeight || 0 : 0;
        const baseHeight = this.resolveBaseHeight();
        const cache = this.layoutCache;
        if (
            !force &&
            cache &&
            cache.cw === cw &&
            cache.ch === ch &&
            cache.vw === vw &&
            cache.vh === vh &&
            cache.bh === baseHeight
        ) {
            return false;
        }
        this.layoutCache = { cw: cw, ch: ch, vw: vw, vh: vh, bh: baseHeight };

        const box = this.getVideoBox(cw, ch, video);
        let baseWidth = Number(this.config.baseWidth);
        if (!(baseWidth > 0)) {
            // 基准画布按视频宽高比推导：16:9 即 810x456
            baseWidth = box.height > 0 ? (baseHeight * box.width) / box.height : (baseHeight * 16) / 9;
        }
        this._baseWidth = baseWidth;
        this._baseHeight = baseHeight;

        // 等比缩放后居中，宽高比不一致时也不会被拉伸
        const scaleX = box.width / baseWidth;
        const scaleY = box.height / baseHeight;
        const scale = Math.min(scaleX, scaleY) || 1;
        this.viewScale = scale;
        this.viewX = box.x + (box.width - baseWidth * scale) / 2;
        this.viewY = box.y + (box.height - baseHeight * scale) / 2;
        this.applyLayerLayout();
        return true;
    }

    /** 把映射结果写到弹幕图层上：div 用 CSS transform，canvas 用像素尺寸 + ctx 变换 */
    private applyLayerLayout() {
        if (!this.canvas) {
            return;
        }
        if (this.getType() === 'div') {
            const el = <HTMLElement>this.canvas;
            el.style.left = this.viewX + 'px';
            el.style.top = this.viewY + 'px';
            el.style.width = this._baseWidth + 'px';
            el.style.height = this._baseHeight + 'px';
            el.style.transformOrigin = el.style.webkitTransformOrigin = '0 0';
            el.style.transform = el.style.webkitTransform = 'scale(' + this.viewScale + ')';
        } else {
            const el = <HTMLCanvasElement>this.canvas;
            const dpr = window.devicePixelRatio || 1;
            const w = this._baseWidth * this.viewScale;
            const h = this._baseHeight * this.viewScale;
            el.style.left = this.viewX + 'px';
            el.style.top = this.viewY + 'px';
            el.style.width = w + 'px';
            el.style.height = h + 'px';
            const pw = Math.max(1, Math.round(w * dpr));
            const ph = Math.max(1, Math.round(h * dpr));
            if (el.width !== pw || el.height !== ph) {
                el.width = pw;
                el.height = ph;
            }
            this.applyCtxTransform();
        }
    }

    /** canvas 模式下把基准坐标映射到画布像素（含 devicePixelRatio） */
    private applyCtxTransform() {
        if (this.getType() === 'div' || !this.ctx || !this.ctx.setTransform) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const k = this.viewScale * dpr;
        this.ctx.setTransform(k, 0, 0, k, 0, 0);
    }

    private clearCanvas() {
        if (!this.ctx || !this.canvas || this.getType() === 'div') {
            return;
        }
        const el = <HTMLCanvasElement>this.canvas;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, el.width, el.height);
        this.applyCtxTransform();
    }

    private buildTextData(textData: ITextData): Danmaku | null {
        try {
            let text;
            let msg;
            if (Array.isArray(textData.text)) {
                text = textData.text;
                msg = this.escapeXssChars(text[4]);
            } else {
                text = JSON.parse(this.escapeSpecialChars(textData.text));
                msg = text[4];
            }

            const opacityArr = text[2].toString().split('-');
            const config: IDanmakuOptions = {
                id: this.getId(),
                stime: textData.stime,
                mode: textData.mode,
                size: textData.size,
                color: textData.color,
                date: textData.date,
                class: textData.class,
                uid: textData.uid,
                dmid: textData.dmid,
                text: msg,
                sOpacity: parseFloat(opacityArr[0]),
                eOpacity: parseFloat(opacityArr[1]),
                duration: text[3] * 1000,
                startX: parseFloat(text[0]),
                startY: parseFloat(text[1]),
                endX: typeof text[7] === 'undefined' ? parseFloat(text[0]) : parseFloat(text[7]),
                endY: typeof text[8] === 'undefined' ? parseFloat(text[1]) : parseFloat(text[8]),
                canvasW: this.baseWidth,
                canvasH: this.baseHeight,
                container: this.container,
            };
            if (text.length >= 7) {
                config.zRotate = text[5];
                config.yRotate = text[6];
            }
            if (text.length >= 11) {
                config.aTime = text[9];
                config.aDelay = text[10];
            }
            if (text.length >= 12) {
                config.stroked = text[11]; // 描边, h5：0|1， flash：false|true
            }
            if (text.length >= 13) {
                config.family = text[12]; // 字体，默认都为 黑体
            }
            if (text.length >= 14) {
                config.linearSpeedUp = text[13]; // 是否有线性加速，h5改默认值为0
            }
            if (text.length >= 15) {
                config.path = text[14]; // 路径数据，默认都为''
            }
            return new Danmaku(this, config);
        } catch (e) {
            return null;
        }
    }

    private drawDanmaku(danmaku?: Danmaku[] | Danmaku) {
        danmaku = danmaku || this.cdmList;
        if (Array.isArray(danmaku)) {
            danmaku.forEach((d) => {
                this.drawDanmaku(d);
            });
        } else {
            danmaku.refresh(this.sTime);
            if (danmaku.drawStatus && danmaku.img) {
                if (this.getType() === 'div') {
                    danmaku.img.style.opacity = danmaku.options.cOpacity.toString();
                    danmaku.innerCell.style.transform = danmaku.innerCell.style.webkitTransform = danmaku.createTransform(
                        danmaku.options.x,
                        danmaku.options.y,
                        danmaku.options.yRotate,
                        danmaku.options.zRotate,
                    );
                    if (danmaku.blocked || this.config.blockJudge(danmaku.options)) {
                        danmaku.img.style.visibility = 'hidden';
                    } else {
                        danmaku.img.style.visibility = '';
                    }
                    if (!this.canvas) {
                        this.create();
                    }
                    this.canvas.appendChild(danmaku.img);
                } else {
                    if (!danmaku.blocked) {
                        this.ctx.globalAlpha = danmaku.options.cOpacity;
                        this.ctx.drawImage(
                            <HTMLCanvasElement>danmaku.img,
                            danmaku.options.x - danmaku.options.offsetX,
                            danmaku.options.y - danmaku.options.offsetY - 2,
                        );
                    }
                }
            }
        }
    }

    private render() {
        if (this.paused) {
            return false;
        } else {
            if (this.visableStatus) {
                window['requestAnimationFrame'](() => {
                    this.render();
                });
                this.renderDanmaku();
            }
        }
    }

    private renderDanmaku() {
        this.config.danmakuNumber =
            typeof this.config.getDanmakuNumber === 'function'
                ? this.config.getDanmakuNumber()
                : this.config.danmakuNumber;
        this.updateSTime();
        // 每帧校正一次布局：全屏 / 宽屏 / resize / 视频分辨率变化后不需要额外的事件也能自愈
        this.updateLayout();
        this.typeChangeCheck();
        this.getType() === 'div' ? (this.canvas.innerHTML = '') : this.clearCanvas();
        this.refreshCdmList();
        this.drawDanmaku();
    }

    private updateSTime() {
        const timestamp = Date.now();
        this.sTime += (timestamp - this.sDate) * this.config.videoSpeed;
        this.sDate = timestamp;
        // 如果有视频时间函数，则对一下时间
        if (typeof this.config.timeSyncFunc === 'function') {
            const videoTime: number = this.config.timeSyncFunc();
            // 相差太大，进行时间校正
            if (Math.abs(videoTime - this.sTime) > 1000 || isNaN(this.sTime)) {
                this.sTime = videoTime;
            }
        }
    }

    refreshCdmList(force?: boolean) {
        if (!this.visableStatus) {
            this.clearCurrent();
            return;
        }
        for (let i = 0, len = this.dmList.length; i < len; i++) {
            const danmaku: Danmaku = this.dmList[i];
            if (
                danmaku.options.stime <= this.sTime &&
                danmaku.options.stime + danmaku.options.duration >= this.sTime &&
                !danmaku.renderStatus
            ) {
                if (!this.config.blockJudge(danmaku.options) && this.validate()) {
                    danmaku.renderStatus = true;
                    if (!danmaku.showed) {
                        this.dmexposure++;
                    }
                    danmaku.showed = true;
                    this.cdmList.push(danmaku);
                }
            }
        }
        for (let i = this.cdmList.length - 1; i >= 0; i--) {
            const danmaku: Danmaku = this.cdmList[i];
            if (
                danmaku.options.stime > this.sTime ||
                danmaku.options.stime + danmaku.options.duration / this.config.videoSpeed <= this.sTime + 40
            ) {
                danmaku.renderStatus = false;
                danmaku.img && danmaku.img.remove && danmaku.img.remove();
                danmaku.img = null;
                this.cdmList.splice(i, 1);
                continue;
            }
            if (this.config.blockJudge(danmaku.options)) {
                danmaku.blocked = true;
            } else {
                delete (<any>danmaku).blocked;
            }
        }
        if (force) {
            if (this.getType() !== 'div') {
                this.clearCanvas();
            }
            this.drawDanmaku();
        }
    }

    private validate() {
        if (this.cdmList.length >= this.config.danmakuNumber && this.config.danmakuNumber !== -1) {
            return false;
        }
        return true;
    }

    private escapeXssChars(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/>/g, '&gt;')
            .replace(/</g, '&lt;')
            .replace(/(\/n|\\n|\n|\r\n)/g, '\n');
    }

    private escapeSpecialChars(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/>/g, '&gt;')
            .replace(/</g, '&lt;')
            .replace(/\/n|\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
            .replace(/\f/g, '\\f');
    }

    private typeChangeCheck() {
        if (this.initialType !== this.getType()) {
            this.initialType = this.getType();
            for (let i = this.cdmList.length - 1; i >= 0; i--) {
                const danmaku: Danmaku = this.cdmList[i];
                danmaku.renderStatus = false;
                danmaku.img = null;
                delete (<any>danmaku).blocked;
            }
            this.cdmList.length = 0;
            this.container.innerHTML = '';
            this.initialType === 'div' ? this.createDiv() : this.createCanvas();
            this.container && this.container.appendChild(this.canvas);
            this.updateLayout(true);
        }
    }

    private searchCSSArea(clientX: number, clientY: number): IRepackTextData[] {
        const result = [];
        const precision = 5;
        for (let i = this.cdmList.length - 1; i >= 0; i--) {
            const danmaku: Danmaku = this.cdmList[i];
            if (!danmaku.img || !danmaku.img.children || !danmaku.img.children[0]) {
                continue;
            }
            if (!danmaku.img.children[0].getBoundingClientRect) {
                return result;
            }
            const rect = danmaku.img.children[0].getBoundingClientRect();
            const minW = rect.width;
            const minH = rect.height;
            const x = rect.left;
            const y = rect.top;
            if (
                clientX >= x - precision &&
                clientX <= x + minW + precision &&
                clientY >= y - precision &&
                clientY - minH <= y + precision
            ) {
                result.push(this.repackDanmakuData(danmaku));
            }
        }
        return result;
    }

    private searchCanvasArea(offsetX: number, offsetY: number): IRepackTextData[] {
        const result = [];
        const precision = 5;
        for (let i = this.cdmList.length - 1; i >= 0; i--) {
            const danmaku: Danmaku = this.cdmList[i];
            const minW = danmaku.options.minW;
            const minH = danmaku.options.minH;
            const x = danmaku.options.x - danmaku.options.offsetX;
            const y = danmaku.options.y - danmaku.options.offsetY;
            if (
                offsetX >= x - precision &&
                offsetX <= x + minW + precision &&
                offsetY >= y - precision &&
                offsetY - minH <= y + precision
            ) {
                result.push(this.repackDanmakuData(danmaku));
            }
        }
        return result;
    }

    private repackDanmakuData(danmaku: Danmaku): IRepackTextData {
        return {
            textData: {
                uid: danmaku.options.uid,
                text: danmaku.options.text,
                mode: danmaku.options.mode,
                dmid: danmaku.options.dmid,
                stime: danmaku.options.stime,
                size: danmaku.options.size,
                date: danmaku.options.date,
                color: danmaku.options.color,
                class: danmaku.options.class,
            },
        };
    }

    clear() {
        this.dmList = [];
        this.cdmList = [];
        // 换稿件会复用同一个实例，画布估计要一起重置
        this.baseEstimate = 0;
        this.baseEstimateCount = 0;
        this.appliedBaseHeight = 0;
        if (this.getType() === 'div') {
            if (this.canvas) {
                this.canvas.innerHTML = '';
            }
        } else {
            this.clearCanvas();
        }
    }

    destroy() { }
}

export default Manager;
