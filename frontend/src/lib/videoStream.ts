/**
 * MediaHub Video Streaming Service Worker Client
 *
 * Coordinates registration of video encryption keys with `/sw.js` to enable
 * chunked, on-the-fly AES-256-GCM decryption streaming via `<video src="/sw-stream/...">`.
 */

export interface VideoStreamRegistration {
  folderId: string;
  filePid: string;
  fileKeyHex: string;
  originalSize: number;
  fileName: string;
}

const activeRegistrations = new Map<string, VideoStreamRegistration>();
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let swMessageListenerAttached = false;

/**
 * Checks whether the current browser supports Service Worker video streaming.
 */
export function isVideoStreamSupported(): boolean {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  return true;
}

/**
 * Initializes and registers the `/sw.js` service worker.
 */
export async function initVideoStreamWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isVideoStreamSupported()) return null;

  if (!swRegistrationPromise) {
    swRegistrationPromise = (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;

        if (!swMessageListenerAttached) {
          swMessageListenerAttached = true;
          navigator.serviceWorker.addEventListener('message', (event) => {
            const data = event.data;
            if (data?.action === 'REQUEST_KEY' && data.filePid) {
              const regInfo = activeRegistrations.get(data.filePid);
              if (regInfo && reg.active) {
                reg.active.postMessage({
                  action: 'REGISTER',
                  folderId: regInfo.folderId,
                  filePid: regInfo.filePid,
                  fileKey: regInfo.fileKeyHex,
                  originalSize: regInfo.originalSize,
                  fileName: regInfo.fileName,
                });
              }
            }
          });
        }

        return reg;
      } catch (err) {
        console.warn('[VideoStream] Failed to register service worker:', err);
        return null;
      }
    })();
  }

  return swRegistrationPromise;
}

/**
 * Registers a video file with the service worker for streaming.
 * Resolves once the service worker acknowledges (ACK) key storage.
 */
export async function registerVideoStream(info: VideoStreamRegistration): Promise<boolean> {
  const reg = await initVideoStreamWorker();
  if (!reg) return false;

  activeRegistrations.set(info.filePid, info);

  const sw = reg.active || navigator.serviceWorker.controller;
  if (!sw) return false;

  return new Promise<boolean>((resolve) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        navigator.serviceWorker.removeEventListener('message', ackHandler);
        // Fallback: proceed even if ACK timed out
        resolve(true);
      }
    }, 2500);

    const ackHandler = (event: MessageEvent) => {
      if (event.data?.action === 'REGISTERED' && event.data?.filePid === info.filePid) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('message', ackHandler);
          resolve(true);
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', ackHandler);

    sw.postMessage({
      action: 'REGISTER',
      folderId: info.folderId,
      filePid: info.filePid,
      fileKey: info.fileKeyHex,
      originalSize: info.originalSize,
      fileName: info.fileName,
    });
  });
}

/**
 * Unregisters a video file from the service worker and cleans up cached chunks.
 */
export async function unregisterVideoStream(filePid: string): Promise<void> {
  activeRegistrations.delete(filePid);

  if (!isVideoStreamSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.active) {
      reg.active.postMessage({ action: 'UNREGISTER', filePid });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Returns the virtual streaming URL intercepted by the service worker.
 */
export function getVideoStreamUrl(folderId: string, filePid: string): string {
  return `/sw-stream/${encodeURIComponent(folderId)}/${encodeURIComponent(filePid)}`;
}
