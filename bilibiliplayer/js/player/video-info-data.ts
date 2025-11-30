// import DashPlugin from '@jsc/dash-player';

import { IMediaInfoInterface, IStatInfoInterface, PlayerType } from "@jsc/dash-player";

const generateVideoInfoItems = (playerType: PlayerType) => {
    if (playerType === 'NativePlayer') {
        return {
            infos: [
                {
                    name: 'mimeType',
                    type: 'text',
                    title: 'Mime 类型',
                    data: '',
                },
                {
                    name: 'playerType',
                    type: 'text',
                    title: 'Player 类型',
                    data: '',
                },
                {
                    name: 'resolution',
                    type: 'text',
                    title: '分辨率',
                    data: '',
                },
                {
                    name: 'streamType',
                    type: 'text',
                    title: '流式类型',
                    data: '',
                },
                {
                    name: 'streamHost',
                    type: 'text',
                    title: '流式主域',
                    data: '',
                },
                {
                    name: 'droppedFrames',
                    type: 'text',
                    title: '丢帧',
                    data: '',
                },
                {
                    name: 'Log',
                    type: 'log',
                    title: '日志',
                    data: '',
                },
            ],
        };
    } else if (playerType === 'DashPlayer') {
        return {
            infos: [
                {
                    name: 'mimeType',
                    type: 'text',
                    title: 'Mime 类型',
                    data: '',
                },
                {
                    name: 'playerType',
                    type: 'text',
                    title: 'Player 类型',
                    data: '',
                },
                {
                    name: 'resolution',
                    type: 'text',
                    title: '分辨率',
                    data: '',
                },
                {
                    name: 'fps',
                    type: 'text',
                    title: '帧率',
                    data: '',
                },
                {
                    name: 'audioSampling',
                    type: 'text',
                    title: '音频采样',
                    data: '',
                },
                {
                    name: 'videoDatarate',
                    type: 'text',
                    title: '视频数据速率',
                    data: '',
                },
                {
                    name: 'audioDatarate',
                    type: 'text',
                    title: '音频数据速率',
                    data: '',
                },
                {
                    name: 'segments',
                    type: 'text',
                    title: '分段',
                    data: '',
                },
                {
                    name: 'streamType',
                    type: 'text',
                    title: '流式类型',
                    data: '',
                },
                {
                    name: 'videoStreamHost',
                    type: 'text',
                    title: '视频主域',
                    data: '',
                },
                {
                    name: 'audioStreamHost',
                    type: 'text',
                    title: '音频主域',
                    data: '',
                },
                {
                    name: 'videoConnectionSpeed',
                    type: 'graph',
                    title: '视频速率',
                    unit: 'Kbps',
                    data: 0,
                },
                {
                    name: 'audioConnectionSpeed',
                    type: 'graph',
                    title: '音频速率',
                    unit: 'Kbps',
                    data: 0,
                },
                {
                    name: 'networkActivity',
                    type: 'graph',
                    title: '网络活动',
                    unit: 'KB',
                    data: 0,
                },
                {
                    name: 'droppedFrames',
                    type: 'text',
                    title: '丢帧',
                    data: '',
                },
                {
                    name: 'Log',
                    type: 'log',
                    title: '日志',
                    data: '',
                },
            ],
        };
    }

    // else: FlvPlayer
    return {
        infos: [
            {
                name: 'mimeType',
                type: 'text',
                title: 'Mime 类型',
                data: '',
            },
            {
                name: 'playerType',
                type: 'text',
                title: 'Player 类型',
                data: '',
            },
            {
                name: 'resolution',
                type: 'text',
                title: '分辨率',
                data: '',
            },
            {
                name: 'fps',
                type: 'text',
                title: '帧率',
                data: '',
            },
            {
                name: 'videoProfile',
                type: 'text',
                title: '视频简要',
                data: '',
            },
            {
                name: 'audioSampling',
                type: 'text',
                title: '音频采样',
                data: '',
            },
            {
                name: 'videoDatarate',
                type: 'text',
                title: '视频数据速率',
                data: '',
            },
            {
                name: 'audioDatarate',
                type: 'text',
                title: '音频数据速率',
                data: '',
            },
            {
                name: 'segments',
                type: 'text',
                title: '分段',
                data: '',
            },
            {
                name: 'loader',
                type: 'text',
                title: '载入',
                data: '',
            },
            {
                name: 'streamType',
                type: 'text',
                title: '流式类型',
                data: '',
            },
            {
                name: 'streamHost',
                type: 'text',
                title: '流式主域',
                data: '',
            },
            {
                name: 'connectionSpeed',
                type: 'graph',
                title: '连接速率',
                unit: 'KB/s',
                data: 0,
            },
            {
                name: 'droppedFrames',
                type: 'text',
                title: '丢帧',
                data: '',
            },
            {
                name: 'Log',
                type: 'log',
                title: '日志',
                data: '',
            },
        ],
    };
};

const updateVideoInfoData = (
    playerType: PlayerType,
    mediaInfo?: IMediaInfoInterface, //| DashPlugin.IMediaInfo,
    statInfo?: IStatInfoInterface //| DashPlugin.IStatisticsInfo,
) => {
    if (!mediaInfo || !statInfo) {
        return [];
    }
    if (Object.keys(mediaInfo).length === 0 || Object.keys(statInfo).length === 0) {
        return [];
    }

    let resolution = mediaInfo['width'] + ' x ' + mediaInfo['height'];
    if (playerType === 'DashPlayer') {
        resolution += '@' + Number(mediaInfo['fps']).toFixed(3);
    } else {
        if (mediaInfo.hasOwnProperty('sarNum')) {
            resolution += ' [SAR ' + mediaInfo['sarNum'] + ':' + mediaInfo['sarDen'] + ']';
        }
        if (mediaInfo.hasOwnProperty('sar')) {
            resolution += ' [SAR ' + mediaInfo['sar'] + ']';
        }
    }

    let streamHost: any;
    let streamType: any;
    let videoStreamHost!: string, audioStreamHost!: string;

    try {
        if (statInfo['url']) {
            streamHost = /https?:\/\/(.+?)\//.exec(<string>statInfo['url'])![1];
            streamType = /^(https?|wss?)\:\/\/?/.exec(<string>statInfo['url'])![1];
        }
        if (statInfo['videoURL']) {
            // streamHost = /https?:\/\/(.+?)\//.exec(statInfo['videoURL'])![1];
            // streamType = /^(https?|wss?)\:\/\/?/.exec(statInfo['videoURL'])![1];
            videoStreamHost = /https?:\/\/(.+?)\//.exec(statInfo['videoURL'])![1];
        }
        if (statInfo['audioURL']) {
            audioStreamHost = /https?:\/\/(.+?)\//.exec(statInfo['audioURL'])![1];
            // streamType = /^(https?|wss?)\:\/\/?/.exec(statInfo['videoURL'])![1];
        }
    } catch (e) {
        streamHost = '';
        streamType = '';
    }

    let droppedFrames = statInfo['droppedFrames'] + ' / ' + statInfo['decodedFrames'];

    let data: {
        name: string;
        data: string | number;
    }[] = [
            {
                name: 'mimeType',
                data: mediaInfo['mimeType'],
            },
            {
                name: 'playerType',
                data: statInfo['playerType'],
            },
            {
                name: 'resolution',
                data: resolution,
            },
            {
                name: 'streamType',
                data: streamType,
            },
            {
                name: 'streamHost',
                data: streamHost,
            },
            {
                name: 'droppedFrames',
                data: droppedFrames,
            },
        ];

    if (playerType === 'NativePlayer') {
        return data;
    }

    if (playerType === 'FlvPlayer') {
        // for FlvPlayer
        const segments = <number>statInfo['currentSegmentIndex'] + 1 + '/' + statInfo['totalSegmentCount'];

        const videoProfile = mediaInfo['profile'] + ', L' + mediaInfo['level'];
        let audioSampling = mediaInfo['audioSampleRate'] + ' Hz';
        const channelCount = mediaInfo['audioChannelCount'];
        if (channelCount === 1) {
            audioSampling += ', Mono';
        } else {
            if (channelCount === 2) {
                audioSampling += ', Stereo';
            } else {
                audioSampling += ', ' + channelCount + ' Channels';
            }
        }
        if (mediaInfo['metadata'] && mediaInfo['metadata']['description']) {
            audioSampling +=
                mediaInfo['metadata']['description'] && /fixed_gap:True/.test(mediaInfo['metadata']['description'])
                    ? ', Fixed'
                    : '';
        }

        const videoDataRate: any = mediaInfo['videoDataRate'];
        const audioDataRate: any = mediaInfo['audioDataRate'];

        // show more video info for FlvPlayer
        data = data.concat([
            {
                name: 'fps',
                data: Number(mediaInfo['fps']).toFixed(3),
            },
            {
                name: 'videoProfile',
                data: videoProfile,
            },
            {
                name: 'audioSampling',
                data: audioSampling,
            },
            {
                name: 'videoDatarate',
                data: Math.round(videoDataRate) + ' Kbps',
            },
            {
                name: 'audioDatarate',
                data: Math.floor(audioDataRate) + ' Kbps',
            },
            {
                name: 'segments',
                data: segments,
            },
            {
                name: 'loader',
                data: statInfo['loaderType']!,
            },
            {
                name: 'connectionSpeed',
                // @ts-ignore
                data: Math.round(statInfo['speed']),
            },
        ]);
    }

    if (playerType === 'DashPlayer') {
        let audioSampling = mediaInfo['audioSampleRate'] + ' Hz';
        const channelCount = mediaInfo['audioChannelCount'];
        if (channelCount === 1) {
            audioSampling += ', Mono';
        } else {
            if (channelCount === 2) {
                audioSampling += ', Stereo';
            } else {
                audioSampling += ', ' + channelCount + ' Channels';
            }
        }

        const videoDataRate: any = mediaInfo['videoDataRate'];
        const audioDataRate: any = mediaInfo['audioDataRate'];

        // remove streamType、streamHost、droppedFrames
        data.splice(3, 3);

        // videoStreamHost += `, ${Math.floor(videoDataRate / 1024)} Kbps`;
        // audioStreamHost += `, ${Math.floor(audioDataRate / 1024)} Kbps`;
        const segments =
            (statInfo['audioCurrentSegmentIndex'] || 0 + 1) + ' / ' + (statInfo['audioTotalSegmentCount'] || 0);

        // droppedFrames = segments + ', ' + droppedFrames;

        data = data.concat([
            {
                name: 'fps',
                data: Number(mediaInfo['fps']).toFixed(3),
            },
            {
                name: 'audioSampling',
                data: audioSampling,
            },
            {
                name: 'videoDatarate',
                data: Math.round(videoDataRate / 1024) + ' Kbps',
            },
            {
                name: 'audioDatarate',
                data: Math.floor(audioDataRate / 1024) + ' Kbps',
            },
            {
                name: 'segments',
                data: segments,
            },
            {
                name: 'droppedFrames',
                data: droppedFrames,
            },
            {
                name: 'videoStreamHost',
                data: videoStreamHost,
            },
            {
                name: 'audioStreamHost',
                data: audioStreamHost,
            },
            {
                name: 'videoConnectionSpeed',
                data: Math.round(statInfo['videoConnectionSpeed']!),
            },
            {
                name: 'audioConnectionSpeed',
                data: Math.round(statInfo['audioConnectionSpeed']!),
            },
            {
                name: 'networkActivity',
                data: Math.round(statInfo['networkActivity']! / 1024),
            },
        ]);
    }

    return data;
};

export default {
    generateVideoInfoItems,
    updateVideoInfoData,
};
