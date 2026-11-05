/** Typed renderer bridge exposes bounded main-process capabilities. */
import type { Envelope } from "../../shared/src/index";
declare global {
  interface Window {
    canvas: {
      connect: (options: any) => Promise<void>;
      send: (e: Envelope) => Promise<void>;
      ack: (seq: number) => Promise<void>;
      disconnect: () => Promise<void>;
      discover: () => Promise<any[]>;
      onMessage: (fn: (e: Envelope) => void) => () => void;
      onStatus: (
        fn: (v: { status: string; detail: string }) => void,
      ) => () => void;
      onRtt: (fn: (n: number) => void) => () => void;
      read: (key: string) => Promise<any>;
      write: (key: string, value: unknown) => Promise<void>;
      save: (options: {
        name: string;
        data: string;
        base64?: boolean;
      }) => Promise<boolean>;
      open: () => Promise<string | null>;
    };
  }
}
