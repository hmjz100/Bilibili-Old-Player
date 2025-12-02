declare const _BUILD_VERSION_: string;
declare const _BUILD_REVISION_: string;
declare const _BUILD_TIME_: string;

export const METADATA = {
	version: _BUILD_VERSION_,
	revision: _BUILD_REVISION_,
	lastCompiled: _BUILD_TIME_
} as const;