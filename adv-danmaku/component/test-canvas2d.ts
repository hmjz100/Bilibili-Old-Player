import Danmaku from './danmaku';
import Manager from '../manager';

class TestCanvas2D {
    private container: HTMLElement;
    private manager: Manager;
    private canvas!: HTMLCanvasElement;
    [adv: string]: any;

    constructor(wrapper: HTMLElement, manager: Manager) {
        this.container = wrapper;
        this.manager = manager;
    }

    test(danmaku: Danmaku) {
        const canvas = document.createElement('canvas');
        const ctx = <CanvasRenderingContext2D>canvas.getContext('2d');
        canvas.style.position = 'absolute';
        canvas.style.background = 'transparent';
        canvas.style.zIndex = String(10 + danmaku.options.id);
        this.container && this.container.appendChild(canvas);
        this.canvas = canvas;
        this.applyLayout(canvas);
        this.render(danmaku, ctx);
        setTimeout(() => this.destroy(danmaku, canvas), danmaku.options.duration + 10);
    }

    /** 与正式弹幕层用同一套「基准画布 -> 显示区域」映射 */
    private applyLayout(canvas: HTMLCanvasElement) {
        const layout = this.manager ? this.manager.getLayout() : null;
        const dpr = window.devicePixelRatio || 1;
        if (!layout) {
            canvas.style.left = '0px';
            canvas.style.top = '0px';
            canvas.style.width = this.container.offsetWidth + 'px';
            canvas.style.height = this.container.offsetHeight + 'px';
            canvas.width = this.container.offsetWidth;
            canvas.height = this.container.offsetHeight;
            return;
        }
        const w = layout.width * layout.scale;
        const h = layout.height * layout.scale;
        canvas.style.left = layout.x + 'px';
        canvas.style.top = layout.y + 'px';
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
    }

    private render(danmaku: Danmaku, ctx: CanvasRenderingContext2D) {
        this['adv_danmaku_test_' + danmaku.options.id] = window.requestAnimationFrame(() => {
            this.render(danmaku, ctx);
        });
        this.drawDanmaku(danmaku, ctx);
    }

    private drawDanmaku(danmaku: Danmaku, ctx: CanvasRenderingContext2D) {
        const dpr = window.devicePixelRatio || 1;
        const scale = this.manager ? this.manager.getLayout().scale : 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
        danmaku.refresh(Date.now());
        danmaku.drawStatus &&
            ctx.drawImage(
                <HTMLCanvasElement>danmaku.img,
                danmaku.options.x - danmaku.options.offsetX,
                danmaku.options.y - danmaku.options.offsetY - 2,
            );
    }

    resize() {
        if (this.canvas) {
            this.applyLayout(this.canvas);
        }
    }

    destroy(danmaku: Danmaku, canvas: HTMLCanvasElement) {
        canvas.parentNode && this.container.removeChild(canvas);
        window.cancelAnimationFrame(this['adv_danmaku_test_' + danmaku.options.id]);
    }
}

export default TestCanvas2D;
