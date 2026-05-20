export {};

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
        convertFileSrc(path: string): string;
      };
      dialog?: {
        open(options?: Record<string, unknown>): Promise<string | string[] | null>;
        save(options?: Record<string, unknown>): Promise<string | null>;
      };
      webview?: {
        getCurrentWebview(): {
          onDragDropEvent(callback: (event: {
            payload?: {
              type?: string;
              paths?: string[];
            };
          }) => void): Promise<() => void>;
        };
      };
    };
  }
}

declare module '*.css' {}
