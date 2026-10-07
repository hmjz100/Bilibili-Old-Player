import Player from '../player';

interface ITimerInfoInterface {
    errorInfoId: number[];
    topId: number[];
}
export interface IItemInterface {
    item: JQuery;
}
export interface IItemExtInterface extends IItemInterface {
    stop: () => void;
}

class Toast {
    private player: Player;
    private prefix: string;
    private timeout = 5000;
    private timerInfo: ITimerInfoInterface = { errorInfoId: [], topId: [] };
    private topTimeoutIndex: number = 0;
    private isPay = false;
    private payPermanent = false;
    domNodes: { [key: string]: JQuery } = {};

    constructor(player: Player) {
        this.player = player;
        this.prefix = player.prefix;
        this.init();
    }

    init() {
        this.createWrapper();
    }

    addErrorInfo(o?: any): IItemInterface {
        const config = $.extend(
            true,
            {},
            {
                maxLen: 4,
                timeout: 1000,
                isSuccess: false,
            },
            o,
        );

        const maxLen = 4;
        const item = $(`<div class="${this.prefix}-video-toast-item ${this.prefix}-video-toast-error-info"></div>`);
        const text = $(
            `<div class="${this.prefix}-video-toast-item-text ${this.prefix}-video-toast-error-info"></div>`,
        );
        item.append(text);
        text.append(config.msg);
        if (config && config.isSuccess) {
            this.timerInfo.errorInfoId.push(
                window.setTimeout(
                    () =>
                        this.domNodes.middleArea.animate(
                            {
                                opacity: 0,
                            },
                            300,
                            () => {
                                this.domNodes.middleArea.empty();
                                this.domNodes.middleArea.css({
                                    opacity: 1,
                                });
                                if (config && typeof config.callback === 'function') {
                                    config.callback();
                                }
                            },
                        ),
                    config.timeout,
                ),
            );
        }
        if (this.domNodes.middleArea.children().length < config.maxLen) {
            this.domNodes.middleArea.append(item);
        } else {
            $(this.domNodes.middleArea.children()[0]).remove();
            this.domNodes.middleArea.append(item);
        }
        // this.domNodes.middleArea.empty().append(item);
        return { item: item };
    }

    addTopHinter(
        content: string | Element | JQuery,
        timeout?: number,
        callback?: Function,
        hasClose: boolean = false,
        permanent: boolean = false,
        multiAppend?: boolean,
        selfRemoveCallback?: Function,
    ): IItemExtInterface {
        const item = $(`<div class="${this.prefix}-video-toast-item"></div>`);
        const text = $(`<div class="${this.prefix}-video-toast-item-text"></div>`);
        let mouseInTop = false;
        let delay = true;
        let stop: (() => void) | void;

        if (hasClose) {
            stop = () => {
                clearTimeout(this.timerInfo.topId[this.topTimeoutIndex]);
                item.off('mouseenter mouseleave');
                item.animate({ opacity: 0 }, 300, () => {
                    item.remove();
                    if (typeof callback === 'function') {
                        callback();
                    }
                });
            };
            const close = $(`<div class="${this.prefix}-video-toast-item-close"><i class="${this.prefix}-iconfont icon-close"></i></div>`);
            close.attr('title', '关闭');
            close.click(stop);
            item.append(close);
        }
        const toRemove = () => {
            if (mouseInTop || delay) return;
            item.remove();
            if (typeof callback === 'function' && !hasClose) {
                callback();
            }
            if (typeof selfRemoveCallback === 'function') {
                selfRemoveCallback();
            }
        };
        item.append(text);
        text.append(content);
        // 是否常驻
        if (!permanent) {
            clearTimeout(this.timerInfo.topId[this.topTimeoutIndex]);
            this.timerInfo.topId[this.topTimeoutIndex] = window.setTimeout(() => {
                delay = false;
                if (mouseInTop) return;
                item.animate(
                    {
                        opacity: 0,
                    },
                    300,
                    () => {
                        toRemove();
                    },
                );
            }, timeout || 1000);
            item.on({
                mouseenter: () => {
                    mouseInTop = true;
                },
                mouseleave: () => {
                    mouseInTop = false;
                    window.setTimeout(() => {
                        toRemove();
                    }, 300);
                },
            });
        }
        if (multiAppend) {
            this.domNodes.topArea.prepend(item);
        } else {
            this.domNodes.topArea.empty().append(item);
        }
        this.topTimeoutIndex += 1;
        // @ts-ignore
        return { item, stop };
    }

    addMiddleHinter(content: string | JQuery.PlainObject): IItemInterface {
        const item = $(content);
        this.domNodes.middleArea.empty().append(item);
        return { item: item };
    }

    addBottomHinter(obj: any): IItemExtInterface | undefined {
        if (this.isPay) {
            return;
        }
        let rest: JQuery | null = null;
        /**
         * 本条消息**自己的**定时器句柄。
         * 底部消息是层叠（可同时存在多条）的，超时/关闭必须各管各的——
         * 否则后一条消息的 clearTimeout 会把前一条的自动消失给掐掉。
         */
        let timerId = 0;
        /** 倒计时秒数：放在局部变量里，避免多条消息共用实例字段互相串味 */
        let restTime = Number(obj.restTime) || 0;
        const restTimeShow = obj.restTimeShow !== false;
        const jumpClass = obj.theme ? `${this.prefix}-${obj.theme}` : '';
        const item = $(`<div class="${this.prefix}-video-toast-item"></div>`);
        const text = $(`<div class="${this.prefix}-video-toast-item-text"></div>`);
        const jump = $(`<div class="${this.prefix}-video-toast-item-jump ${jumpClass}"></div>`);
        const successCallback = obj.successCallback || function () { };
        const defaultCallback = obj.defaultCallback || function () { };
        const stop = (close = false) => {
            clearTimeout(timerId);
            item.off('mouseenter mouseleave');
            item.animate({ opacity: 0 }, 300, () => item.remove());
            defaultCallback(close);
        };
        const waiting = (successCallback: Function, defaultCallback: Function) => {
            timerId = window.setTimeout(() => {
                if (--restTime >= 0) {
                    rest!.html(restTime.toString());
                    waiting(successCallback, defaultCallback);
                } else {
                    stop();
                    successCallback();
                }
            }, 1000);
        };
        text.append(obj.text);
        jump.append(obj.jump);
        jump.click(() => {
            stop();
            typeof obj.jumpFunc === 'function' && obj.jumpFunc();
        });
        if (obj.closeButton) {
            const close = $(`<div class="${this.prefix}-video-toast-item-close ${jumpClass}"><i class="${this.prefix}-iconfont icon-close"></i></div>`);
            close.attr('title', '关闭');
            close.click(() => {
                stop(true);
            });
            item.append(close);
            if (!obj.restTime) {
                timerId = window.setTimeout(stop, obj.timeout || this.timeout);
            }
        }
        if (obj.restTime) {
            if (restTimeShow) {
                rest = $(`<em>${restTime}</em>`);
                rest.prependTo(text);
            } else {
                rest = $(`<em style="display:none;">${restTime}</em>`);
                rest.prependTo(text);
            }
            item.on({
                mouseenter: function () {
                    clearTimeout(timerId);
                },
                mouseleave: function () {
                    waiting(successCallback, defaultCallback);
                },
            });
            waiting(successCallback, defaultCallback);
        }
        item.append(text).append(jump);
        if (this.payPermanent) {
            // 课堂toast特殊处理 （因为有个试看视频的固定toast
            item.css({ 'margin-bottom': '10px', display: 'inline-block' });
            this.domNodes.bottomArea.prepend(item);
        } else {
            // 层叠显示：只追加、不清空底部区域，让多条消息可以同时存在、各自超时
            this.domNodes.bottomArea.append(item);
        }
        return {
            item: item,
            stop: stop,
        };
    }

    addPayHinter(
        content: string | Element | JQuery,
        closeBtn?: boolean,
        isPay = true,
        permanent: boolean = false,
    ): IItemInterface {
        const item = $(`<div class="${this.prefix}-video-toast-item ${this.prefix}-video-toast-pay"></div>`);
        const text = $(`<div class="${this.prefix}-video-toast-item-text"></div>`);
        if (closeBtn) {
            const close = $(`<div class="${this.prefix}-video-toast-item-close"><i class="${this.prefix}-iconfont icon-close"></i></div>`);
            close.attr('title', '关闭');
            close.click(() => {
                item.remove();
            });
            item.append(close);
        }
        text.append(content);
        item.append(text);
        this.domNodes.bottomArea.empty().append(item);
        this.isPay = isPay;
        this.payPermanent = permanent;
        return { item: item };
    }

    private createWrapper() {
        const wrapper = $(`
                <div class="${this.prefix}-video-toast-wrp">
                    <div class="${this.prefix}-video-toast-top"></div>
                    <div class="${this.prefix}-video-toast-middle"></div>
                    <div class="${this.prefix}-video-toast-bottom"></div>
                </div>`);
        this.domNodes.topArea = wrapper.find(`.${this.prefix}-video-toast-top`);
        this.domNodes.middleArea = wrapper.find(`.${this.prefix}-video-toast-middle`);
        this.domNodes.bottomArea = wrapper.find(`.${this.prefix}-video-toast-bottom`);
        this.domNodes.wrapper = wrapper;
        this.domNodes.wrapper.appendTo(this.player.template.playerWrap);
    }

    destroy() { }
}

export default Toast;
