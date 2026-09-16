/**
 * MediaHub Video Streaming Service Worker Client & Direct Stream Helpers
 *
 * Coordinates registration of video encryption keys with `/sw.js` for Service Worker streaming,
 * and provides direct on-the-fly backend streaming URLs as a fallback when Service Worker is unavailable.
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
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        if (!swMessageListenerAttached) {
          swMessageListenerAttached = true;
          navigator.serviceWorker.addEventListener('message', (event) => {
            const data = event.data;
            if (data?.action === 'REQUEST_KEY' && data.filePid) {
              const regInfo = activeRegistrations.get(data.filePid);
              const targetSw = reg.active || navigator.serviceWorker.controller || reg.waiting || reg.installing;
              if (regInfo && targetSw) {
                targetSw.postMessage({
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
        console.warn('[VideoStream] Service worker unavailable:', err);
        swRegistrationPromise = null; // Allow future retry
        return null;
      }
    })();
  }

  return swRegistrationPromise;
}

/**
 * Registers a video file with the service worker for streaming.
 * Uses MessageChannel and broadcast fallback.
 */
export async function registerVideoStream(info: VideoStreamRegistration): Promise<boolean> {
  let reg: ServiceWorkerRegistration | null = null;
  try {
    reg = await initVideoStreamWorker();
  } catch {
    return false;
  }
  if (!reg) return false;

  activeRegistrations.set(info.filePid, info);

  const sw = reg.active || navigator.serviceWorker.controller || reg.waiting || reg.installing;
  if (!sw) return false;

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const channel = new MessageChannel();

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        channel.port1.close();
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve(true); // proceed to stream
      }
    }, 1500);

    const done = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        channel.port1.close();
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve(true);
      }
    };

    const onMsg = (e: MessageEvent) => {
      if (e.data?.action === 'REGISTERED' && e.data?.filePid === info.filePid) {
        done();
      }
    };

    channel.port1.onmessage = done;
    navigator.serviceWorker.addEventListener('message', onMsg);

    try {
      sw.postMessage(
        {
          action: 'REGISTER',
          folderId: info.folderId,
          filePid: info.filePid,
          fileKey: info.fileKeyHex,
          originalSize: info.originalSize,
          fileName: info.fileName,
        },
        [channel.port2]
      );
    } catch {
      try {
        sw.postMessage({
          action: 'REGISTER',
          folderId: info.folderId,
          filePid: info.filePid,
          fileKey: info.fileKeyHex,
          originalSize: info.originalSize,
          fileName: info.fileName,
        });
      } catch {
        done();
      }
    }
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
    const sw = reg.active || navigator.serviceWorker.controller || reg.waiting;
    if (sw) {
      sw.postMessage({ action: 'UNREGISTER', filePid });
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

/**
 * Returns the direct on-the-fly streaming URL served by the backend server.
 * Streams decrypted byte ranges on-the-fly without buffering into browser RAM.
 */
export function getDirectStreamUrl(folderId: string, filePid: string, fileKeyHex: string, fileName: string): string {
  return `/api/stream/${encodeURIComponent(folderId)}/${encodeURIComponent(filePid)}?key=${encodeURIComponent(fileKeyHex)}&name=${encodeURIComponent(fileName)}`;
}
