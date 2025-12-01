declare const __BUILD_VERSION__: string;
declare const __BUILD_REVISION__: string;
declare const __BUILD_TIME__: string;

export const METADATA = {
	version: __BUILD_VERSION__,
	revision: __BUILD_REVISION__,
	lastCompiled: __BUILD_TIME__
} as const;