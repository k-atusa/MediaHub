import http.server
import socketserver
import threading
import requests
import re
import urllib.parse
from Cryptodome.Cipher import AES

import Bencrypt

class ProxyRequestHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # Suppress logs
        
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.end_headers()

    def do_GET(self):
        # Path format: /stream/{folder_pid}/{file_name}
        path = urllib.parse.unquote(self.path)
        m = re.match(r"^/stream/([^/]+)/(.*)$", path)
        if not m:
            self.send_error(404, "Not Found")
            return
            
        folder_pid = m.group(1)
        file_name = m.group(2)
        
        server = self.server
        
        # Lock to access shared data securely
        with server.lock:
            if file_name not in server.files_map:
                self.send_error(404, "File Not Found in Proxy Map")
                return
            fl_info = server.files_map[file_name]
            client = server.client
            
        file_key = fl_info[:44]
        raw_aes_key = file_key[:32]
        
        from mediahub_core import Opsec
        orig_size = Opsec.DecodeInt(fl_info[44:52], False)
        file_pid = client.get_obj_pid(file_key)
        
        PLAIN_CHUNK = 1048576
        CIPHER_CHUNK = PLAIN_CHUNK + 16
        
        # Parse Range header
        r_start, r_end = 0, orig_size - 1
        is_partial = False
        range_header = self.headers.get("Range")
        if range_header:
            # Handle standard Range: bytes=A-B or bytes=A-
            rm = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if rm:
                r_start = int(rm.group(1))
                if rm.group(2):
                    r_end = int(rm.group(2))
                is_partial = True
            else:
                # Handle suffix Range: bytes=-N
                rm2 = re.match(r"bytes=-(\d+)", range_header)
                if rm2:
                    suffix_len = int(rm2.group(1))
                    r_start = max(0, orig_size - suffix_len)
                    is_partial = True
                    
        # Determine response code and headers
        if r_start > r_end or r_start >= orig_size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{orig_size}")
            self.end_headers()
            return

        # Determine chunks
        first_idx = r_start // PLAIN_CHUNK
        last_idx = r_end // PLAIN_CHUNK
        content_length = r_end - r_start + 1
        
        # Mime type
        ext = file_name.split('.')[-1].lower()
        mime = {"mp4": "video/mp4", "webm": "video/webm", "mov": "video/mp4", "mkv": "video/x-matroska", 
                "png": "image/png", "jpg": "image/jpeg", "pdf": "application/pdf"}.get(ext, "application/octet-stream")
        
        if is_partial:
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {r_start}-{r_end}/{orig_size}")
        else:
            self.send_response(200)
            
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(content_length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        # Fetch Global IV (cache it per file_pid)
        global_iv = server.get_global_iv(client, folder_pid, file_pid)
        if not global_iv:
            return

        for cur_idx in range(first_idx, last_idx + 1):
            plain_chunk = server.get_decrypted_chunk(client, folder_pid, file_pid, raw_aes_key, orig_size, cur_idx, global_iv)
            if not plain_chunk:
                break
                
            chunk_base = cur_idx * PLAIN_CHUNK
            from_idx = max(r_start, chunk_base) - chunk_base
            to_idx = min(r_end, chunk_base + len(plain_chunk) - 1) - chunk_base
            
            if from_idx <= to_idx:
                try:
                    self.wfile.write(plain_chunk[from_idx:to_idx + 1])
                except Exception as e:
                    # Client likely disconnected
                    break

class ThreadingProxyServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    
    def __init__(self, server_address, RequestHandlerClass):
        super().__init__(server_address, RequestHandlerClass)
        self.client = None
        self.files_map = {}
        self.lock = threading.Lock()
        self.iv_cache = {}
        self.chunk_cache = {}

    def get_global_iv(self, client, folder_pid, file_pid):
        cache_key = f"{folder_pid}_{file_pid}"
        with self.lock:
            if cache_key in self.iv_cache:
                return self.iv_cache[cache_key]
                
        url = f"{client.server_url}/api/media/{folder_pid}/{file_pid}/dat"
        res = requests.get(url, headers={"Range": "bytes=0-11"}, verify=False)
        if res.status_code in [200, 206] and len(res.content) == 12:
            with self.lock:
                self.iv_cache[cache_key] = res.content
            return res.content
        return None

    def get_decrypted_chunk(self, client, folder_pid, file_pid, raw_aes_key, orig_size, chk_idx, global_iv):
        cache_key = f"{folder_pid}_{file_pid}_{chk_idx}"
        with self.lock:
            if cache_key in self.chunk_cache:
                return self.chunk_cache[cache_key]

        PLAIN_CHUNK = 1048576
        CIPHER_CHUNK = PLAIN_CHUNK + 16
        
        c_start = 12 + chk_idx * CIPHER_CHUNK
        plain_len = min(PLAIN_CHUNK, orig_size - chk_idx * PLAIN_CHUNK)
        cipher_len = plain_len + 16
        c_end = c_start + cipher_len - 1
        
        url = f"{client.server_url}/api/media/{folder_pid}/{file_pid}/dat"
        res = requests.get(url, headers={"Range": f"bytes={c_start}-{c_end}"}, verify=False)
        if res.status_code not in [200, 206] or len(res.content) != cipher_len:
            return None
            
        cipher_buf = res.content
        chunk_data = cipher_buf[:-16]
        tag_data = cipher_buf[-16:]
        
        iv = Bencrypt.mkiv(global_iv, chk_idx)
        cipher = AES.new(raw_aes_key, AES.MODE_GCM, nonce=iv)
        try:
            plain_chunk = cipher.decrypt_and_verify(chunk_data, tag_data)
        except ValueError:
            return None # Mac verification failed
            
        with self.lock:
            self.chunk_cache[cache_key] = plain_chunk
            # keep cache small
            if len(self.chunk_cache) > 16:
                oldest = next(iter(self.chunk_cache))
                del self.chunk_cache[oldest]
                
        return plain_chunk

class MediaHubProxy:
    def __init__(self, port=18080):
        self.port = port
        self.server = ThreadingProxyServer(("127.0.0.1", self.port), ProxyRequestHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def update_context(self, client, files_map):
        with self.server.lock:
            self.server.client = client
            self.server.files_map = files_map
            # Clear caches on context switch
            self.server.iv_cache.clear()
            self.server.chunk_cache.clear()
