import Danmaku from './danmaku';
import Manager from '../manager';

class TestCSS3 {
    private container: HTMLElement;
    private manager: Manager;
    private layouts: { wrap: HTMLElement; danmaku: Danmaku }[] = [];
    [adv: string]: any;
    constructor(wrapper: HTMLElement, manager: Manager) {
        this.container = wrapper;
        this.manager = manager;
    }

    test(danmaku: Danmaku) {
        const wrap = document.createElement('div');
        wrap.style.position = 'absolute';
        wrap.style.background = 'transparent';
        wrap.style.transformOrigin = wrap.style.webkitTransformOrigin = '0 0';
        wrap.style.zIndex = String(10 + danmaku.options.id);
        this.applyLayout(wrap);
        if (this.container) {
            this.container.appendChild(wrap);
        }
        this.layouts.push({ wrap: wrap, danmaku: danmaku });
        this.render(danmaku, wrap);
        setTimeout(() => this.destroy(danmaku, wrap), danmaku.options.duration + 10);
    }

    /** 与正式弹幕层用同一套「基准画布 -> 显示区域」映射 */
    private applyLayout(wrap: HTMLElement) {
        const layout = this.manager ? this.manager.getLayout() : null;
        if (!layout) {
            wrap.style.left = '0px';
            wrap.style.top = '0px';
            wrap.style.width = '100%';
            wrap.style.height = '100%';
            wrap.style.transform = wrap.style.webkitTransform = '';
            return;
        }
        wrap.style.left = layout.x + 'px';
        wrap.style.top = layout.y + 'px';
        wrap.style.width = layout.width + 'px';
        wrap.style.height = layout.height + 'px';
        wrap.style.transform = wrap.style.webkitTransform = 'scale(' + layout.scale + ')';
    }

    private render(danmaku: Danmaku, wrap: HTMLElement) {
        this['adv_danmaku_test_' + danmaku.options.id] = window.requestAnimationFrame(() => {
            this.render(danmaku, wrap);
        });
        this.applyLayout(wrap);
        this.drawDanmaku(danmaku, wrap);
    }

    private drawDanmaku(danmaku: Danmaku, wrap: HTMLElement) {
        danmaku.refresh(Date.now());
        if (danmaku.drawStatus) {
            danmaku.img!.style.opacity = danmaku.options.cOpacity.toString();
            danmaku.innerCell.style.transform = danmaku.innerCell.style.webkitTransform = danmaku.createTransform(
                danmaku.options.x,
                danmaku.options.y,
                danmaku.options.yRotate,
                danmaku.options.zRotate,
            );
            wrap.appendChild(danmaku.img!);
        }
    }

    resize() {
        this.layouts = this.layouts.filter((item) => !!item.wrap.parentNode);
        this.layouts.forEach((item) => this.applyLayout(item.wrap));
    }

    destroy(danmaku: Danmaku, wrap: HTMLElement) {
        wrap.parentNode && this.container.removeChild(wrap);
        this.layouts = this.layouts.filter((item) => item.wrap !== wrap);
        window.cancelAnimationFrame(this['adv_danmaku_test_' + danmaku.options.id]);
    }
}

export default TestCSS3;
