import os
import tempfile
import requests
import urllib3
import cv2

import Bencode
import Bencrypt
import Opsec

# disable self-signed warning
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class MediaHubClient:
    def __init__(self, server_url, username, password):
        self.server_url = server_url.rstrip('/')
        self.username = username
        self.password = password
        self.user_hash = None
        self.user_key = None
        self.fld_map = {}
        
    def get_user_pid(self, key: bytes) -> str:
        return Bencrypt.SHA3256(key)[:16].hex()

    def get_obj_pid(self, key: bytes) -> str:
        return key[32:44].hex()

    def authenticate(self):
        SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$"
        salt_bytes = Bencrypt.SHA3256((self.username + SECRET_PEPPER).encode('utf-8'))
        pw_bytes = Bencode.NormPW(self.password)
        
        hm = Bencrypt.HashMaster("arg2st")
        store_key, user_key = hm.KDF(pw_bytes, salt_bytes)
        self.user_hash = self.get_user_pid(store_key)
        self.user_key = user_key

    def fetch_folders(self):
        if not self.user_hash:
            raise Exception("Not authenticated")
        
        url_user = f"{self.server_url}/api/userdata/{self.user_hash}"
        res = requests.get(url_user, verify=False)
        
        if res.status_code == 200:
            if len(res.content) > 0:
                sm = Bencrypt.SymMaster("gcm1", self.user_key[:32])
                dec = sm.DeBin(res.content)
                self.fld_map = Opsec.DecodeCfg(dec)
            else:
                self.fld_map = {}
        else:
            raise Exception(f"Connection Error: code {res.status_code}")
        
        return self.fld_map

    def create_folder(self, new_fld_name):
        if new_fld_name in self.fld_map:
            raise Exception("Folder name already exists!")
            
        self.fld_map[new_fld_name] = Bencrypt.Random(32) + Bencrypt.Random(12)
        sm = Bencrypt.SymMaster("gcm1", self.user_key[:32])
        encrypted_usr = sm.EnBin(Opsec.EncodeCfg(self.fld_map))
        
        url_user = f"{self.server_url}/api/userdata/{self.user_hash}"
        res = requests.post(url_user, data=encrypted_usr, verify=False)
        if res.status_code != 200:
             raise Exception(f"Failed to create folder: code {res.status_code}")

    def fetch_files(self, folder_name):
        if folder_name not in self.fld_map:
            raise Exception("Folder not found")
            
        folder_key = self.fld_map[folder_name]
        folder_pid = self.get_obj_pid(folder_key)
        
        url_meta = f"{self.server_url}/api/storage/{folder_pid}/names"
        res_meta = requests.get(url_meta, verify=False)
        fls_map = {}
        if res_meta.status_code == 200 and len(res_meta.content) > 0:
            met_sm = Bencrypt.SymMaster("gcm1", folder_key[:32])
            dec_meta = met_sm.DeBin(res_meta.content)
            fls_map = Opsec.DecodeCfg(dec_meta)
            
        return folder_pid, folder_key, fls_map

    def make_image_thumbnail(self, filepath):
        img = cv2.imread(filepath)
        if img is None:
            return None
        h, w = img.shape[:2]
        ratio = w / h
        
        if 0.6666 <= ratio <= 1.5:
            if w >= h:
                new_w = 256
                new_h = int(256 / ratio)
            else:
                new_h = 256
                new_w = int(256 * ratio)
            resized = cv2.resize(img, (new_w, new_h))
        else:
            size = min(w, h)
            start_x = (w - size) // 2
            start_y = (h - size) // 2
            cropped = img[start_y:start_y+size, start_x:start_x+size]
            resized = cv2.resize(cropped, (256, 256))
            
        ret_jpg, encoded_img = cv2.imencode('.jpg', resized, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if ret_jpg:
            return encoded_img.tobytes()
        return None

    def make_video_thumbnail(self, filepath):
        cap = cv2.VideoCapture(filepath)
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_to_seek = int(fps) if fps > 0 else 1
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_to_seek)
        
        ret, frame = cap.read()
        thumb_bytes = None
        if ret:
            h, w = frame.shape[:2]
            ratio = w / h
            if 0.6666 <= ratio <= 1.5:
                if w >= h:
                    new_w = 256
                    new_h = int(256 / ratio)
                else:
                    new_h = 256
                    new_w = int(256 * ratio)
                resized = cv2.resize(frame, (new_w, new_h))
            else:
                size = min(w, h)
                start_x = (w - size) // 2
                start_y = (h - size) // 2
                cropped = frame[start_y:start_y+size, start_x:start_x+size]
                resized = cv2.resize(cropped, (256, 256))
                
            ret_jpg, encoded_img = cv2.imencode('.jpg', resized, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if ret_jpg:
                thumb_bytes = encoded_img.tobytes()
        cap.release()
        return thumb_bytes

    def upload_file(self, folder_pid, folder_key, fls_map, filepath, progress_callback=None):
        if not os.path.isfile(filepath):
            raise Exception("File not found")
            
        file_name = os.path.basename(filepath)
        orig_size = os.path.getsize(filepath)

        # 1. Generate file unique key(32B) and derive physical file ID
        file_key = Bencrypt.Random(32) + Bencrypt.Random(12)
        file_pid = self.get_obj_pid(file_key)

        # 2. Analyze file extension and generate thumbnail
        ext = file_name.split('.')[-1].lower()
        thumb_bytes = None
        if ext in ['mp4', 'webm', 'mov', 'mkv']:
            thumb_bytes = self.make_video_thumbnail(filepath)
        elif ext in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
            thumb_bytes = self.make_image_thumbnail(filepath)

        if thumb_bytes:
            fl_sm = Bencrypt.SymMaster("gcm1", file_key[:32])
            enc_thumb = fl_sm.EnBin(thumb_bytes)
            url_thumb = f"{self.server_url}/api/media/{folder_pid}/{file_pid}/thumb"
            requests.post(url_thumb, data=enc_thumb, verify=False)

        # 3. Encrypt media file stream
        smx = Bencrypt.SymMaster("gcmx1", file_key[:32])
        enc_size = smx.AfterSize(orig_size)
        pad_size = Opsec.PadLen(enc_size)
        total_upload_size = enc_size + pad_size

        with tempfile.TemporaryFile() as tmp_f:
            with open(filepath, "rb") as f_in:
                smx.EnFile(f_in, orig_size, tmp_f)
            if pad_size > 0:
                Opsec.PadFile(tmp_f, pad_size)
            tmp_f.seek(0)
            
            # 4. Upload via file wrapper for progress tracking (avoids chunked transfer encoding)
            url_dat = f"{self.server_url}/api/media/{folder_pid}/{file_pid}/dat"

            import time

            class ProgressFileWrapper:
                def __init__(self, f, total, callback):
                    self._f = f
                    self._total = total
                    self._sent = 0
                    self._callback = callback
                    self._window_start = time.monotonic()
                    self._window_bytes = 0

                def read(self, size=-1):
                    chunk = self._f.read(size)
                    if chunk:
                        self._sent += len(chunk)
                        self._window_bytes += len(chunk)
                        now = time.monotonic()
                        elapsed = now - self._window_start
                        if elapsed >= 0.5 and self._callback:
                            speed_bps = self._window_bytes / elapsed
                            self._callback(self._sent, self._total, speed_bps)
                            self._window_start = now
                            self._window_bytes = 0
                    return chunk

                def __len__(self):
                    return self._total

            wrapper = ProgressFileWrapper(tmp_f, total_upload_size, progress_callback)
            res = requests.post(url_dat, data=wrapper, verify=False,
                                headers={'Content-Length': str(total_upload_size)})
            if res.status_code != 200:
                raise Exception(f"Upload failed: code {res.status_code}")

            # Final progress update
            if progress_callback:
                progress_callback(total_upload_size, total_upload_size, 0)


        # 5. Prepare file info
        fl_info = file_key + Opsec.EncodeInt(orig_size, 8, False)
        fls_map[file_name] = fl_info
        
        # 6. Update metadata map
        met_sm = Bencrypt.SymMaster("gcm1", folder_key[:32])
        encoded_meta = Opsec.EncodeCfg(fls_map)
        url_meta = f"{self.server_url}/api/storage/{folder_pid}/names"
        res = requests.post(url_meta, data=met_sm.EnBin(encoded_meta), verify=False)
        if res.status_code != 200:
             raise Exception(f"Failed to sync metadata: code {res.status_code}")
             
        return True

    def download_file(self, folder_pid, fl_info, file_name, out_dir):
        file_key = fl_info[:44]
        orig_size = Opsec.DecodeInt(fl_info[44:52], False)
        file_pid = self.get_obj_pid(file_key)
        
        smx = Bencrypt.SymMaster("gcmx1", file_key[:32])
        ciph_size = smx.AfterSize(orig_size)
        
        url_dat = f"{self.server_url}/api/media/{folder_pid}/{file_pid}/dat"
        res_get = requests.get(url_dat, stream=True, verify=False)
        
        if res_get.status_code in [200, 206]:
            out_path = os.path.join(out_dir, file_name)
            with open(out_path, "wb") as f_out:
                smx.DeFile(res_get.raw, ciph_size, f_out)
            return out_path
        else:
            raise Exception(f"Download failed: {res_get.status_code}")
