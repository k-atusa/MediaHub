# test824 : MediaHub client
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

# get physical ID by key
def get_pid(key: bytes) -> str:
    return Bencrypt.SHA3256(key)[:16].hex()

# authenticate user
def authenticate(server_url, username, password):
    SECRET_PEPPER = "_PROJECT_WHY_MEDIAHUB_PEPPER_2026_!@#$"
    salt_bytes = Bencrypt.SHA3256((username + SECRET_PEPPER).encode('utf-8'))
    pw_bytes = Bencode.NormPW(password)
    
    hm = Bencrypt.HashMaster("arg2", 32, 44)
    store_key, user_key = hm.KDF(pw_bytes, salt_bytes)
    user_hash = get_pid(store_key)
    return user_hash, user_key

# make image thumbnail
def make_image_thumbnail(filepath):
    img = cv2.imread(filepath)
    if img is None:
        return None
    h, w = img.shape[:2]
    ratio = w / h
    
    # Resize based on aspect ratio
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

# make video thumbnail
def make_video_thumbnail(filepath):
    cap = cv2.VideoCapture(filepath)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_to_seek = int(fps) if fps > 0 else 1
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_to_seek)
    
    # extract frame and resize to 256x256 with same ratio as image
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

# process single file upload
def process_file_upload(server_url, folder_pid, folder_key, fls_map, filepath):
    if not os.path.isfile(filepath):
        return
    file_name = os.path.basename(filepath)
    orig_size = os.path.getsize(filepath)
    print(f"\n[Upload Start] {file_name} ({orig_size} bytes)...")

    # 1. Generate file unique key(44B) and derive physical file ID
    file_key = Bencrypt.Random(44)
    file_pid = get_pid(file_key)

    # 2. Analyze file extension and generate thumbnail based on file type
    ext = file_name.split('.')[-1].lower()
    thumb_bytes = None
    if ext in ['mp4', 'webm', 'mov', 'mkv']:
        print("-> Video file detected: Generating thumbnail...")
        thumb_bytes = make_video_thumbnail(filepath)
    elif ext in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
        print("-> Image file detected: Generating thumbnail...")
        thumb_bytes = make_image_thumbnail(filepath)

    # Encrypt thumbnail with folder key (gcm1) and upload if thumbnail bytes were successfully built
    if thumb_bytes:
        fld_sm = Bencrypt.SymMaster("gcm1", folder_key)
        enc_thumb = fld_sm.EnBin(thumb_bytes)
        url_thumb = f"{server_url}/api/media/{folder_pid}/{file_pid}/thumb"
        requests.post(url_thumb, data=enc_thumb, verify=False)
        print("-> Thumbail upload complete!")

    # 3. Encrypt media file stream (gcmx1) and add random padding for size hiding
    smx = Bencrypt.SymMaster("gcmx1", file_key)
    enc_size = smx.AfterSize(orig_size)
    pad_size = Opsec.PadLen(enc_size)

    with tempfile.TemporaryFile() as tmp_f:
        with open(filepath, "rb") as f_in:
            smx.EnFile(f_in, orig_size, tmp_f)
        if pad_size > 0:
            Opsec.PadFile(tmp_f, pad_size)
        tmp_f.seek(0)
        
        # 4. Upload encrypted media binary as chunk stream to server
        url_dat = f"{server_url}/api/media/{folder_pid}/{file_pid}/dat"
        res = requests.post(url_dat, data=tmp_f, verify=False)
        if res.status_code == 200:
            print(f"-> Media upload complete! (ID: {file_pid})")
        else:
            print(f"-> Upload failed: code {res.status_code}")
            return

    # 5. Prepare file info for memory map update (44 bytes key + 8 bytes original size)
    fl_info = file_key + Opsec.EncodeInt(orig_size, 8, False)
    fls_map[file_name] = fl_info

def main():
    # login to server
    print("=== MediaHub Python Client ===")
    server_url = input("Server Address (Ex. https://localhost:443): ").strip().rstrip('/')
    username = input("Username: ").strip()
    password = input("Password: ")
    try:
        user_hash, user_key = authenticate(server_url, username, password)
    except Exception as e:
        print(f"Failed to hash: {e}")
        return

    # request user data and verify encryption structure
    url_user = f"{server_url}/api/userdata/{user_hash}"
    try:
        res = requests.get(url_user, verify=False)
    except Exception as e:
        print(f"Connection Error: {e}")
        return

    fld_map = {}
    if res.status_code == 404:
        reg = input("User does not exist. Register? (y/n): ").strip().lower()
        if reg.lower() == 'y':
            requests.post(url_user, data=b"", verify=False)
            print("Registration Success! New userspace created.")
        else:
            print("Program terminated.")
            return
    elif res.status_code == 200:
        if len(res.content) > 0:
            try:
                sm = Bencrypt.SymMaster("gcm1", user_key)
                dec = sm.DeBin(res.content)
                fld_map = Opsec.DecodeCfg(dec)
            except Exception as e:
                print(f"Login Error: {e}")
                return
    else:
        print(f"Connection Error: code {res.status_code}")
        return

    # main folder loop
    while True:
        print("\n=== Folder List ===")
        folders = list(fld_map.keys())
        if not folders:
            print("(No folders created)")
        for i, name in enumerate(folders):
            print(f"[{i}] {name}")
        print("------------------------------")
        print("* create [folder name]")
        print("* exit")
        
        f_cmd = input("Enter folder number or command: ").strip()
        if f_cmd.lower() == 'exit':
            break
        elif f_cmd.startswith("create "):
            new_fld_name = f_cmd[7:].strip()
            if new_fld_name in fld_map:
                print("Error: Folder name already exists!")
                continue

            # generate new folder random symmetric key and server synchronization
            fld_map[new_fld_name] = Bencrypt.Random(44)
            sm = Bencrypt.SymMaster("gcm1", user_key)
            encrypted_usr = sm.EnBin(Opsec.EncodeCfg(fld_map))
            requests.post(url_user, data=encrypted_usr, verify=False)
            print(f"Folder '{new_fld_name}' has been successfully created!")
            continue

        try:
            f_idx = int(f_cmd)
            selected_folder = folders[f_idx]
        except:
            print("Error: Invalid command!")
            continue

        # tracking security folder physical container information
        folder_key = fld_map[selected_folder]
        folder_pid = get_pid(folder_key)

        while True:
            # get encrypted file metadata map under the folder and decrypt
            url_meta = f"{server_url}/api/storage/{folder_pid}/names"
            res_meta = requests.get(url_meta, verify=False)
            fls_map = {}
            if res_meta.status_code == 200 and len(res_meta.content) > 0:
                met_sm = Bencrypt.SymMaster("gcm1", folder_key)
                dec_meta = met_sm.DeBin(res_meta.content)
                fls_map = Opsec.DecodeCfg(dec_meta)

            print(f"\n=== Working in folder: {selected_folder} ===")
            files = list(fls_map.keys())
            if not files:
                print("(No files in current folder)")
            for i, name in enumerate(files):
                info = fls_map[name]
                sz = Opsec.DecodeInt(info[44:52], False)
                print(f"[{i}] {name} ({sz} bytes)")
            print("------------------------------")
            print("* download [NUMBER]")
            print("* upload [FILE/FOLDER PATH]")
            print("* back")
            
            cmd_line = input("Enter command: ").strip()
            if not cmd_line:
                continue
            if cmd_line.lower() == 'back':
                break

            # 1. file download stream pipeline control branch
            if cmd_line.startswith("download "):
                try:
                    idx = int(cmd_line[9:].strip())
                    file_name = files[idx]
                    fl_info = fls_map[file_name]
                except:
                    print("Error: Invalid file number!")
                    continue
                
                file_key = fl_info[:44]
                orig_size = Opsec.DecodeInt(fl_info[44:52], False)
                file_pid = get_pid(file_key)
                
                print(f"[Download Start] {file_name}...")
                smx = Bencrypt.SymMaster("gcmx1", file_key)
                ciph_size = smx.AfterSize(orig_size)
                
                url_dat = f"{server_url}/api/media/{folder_pid}/{file_pid}/dat"
                res_get = requests.get(url_dat, stream=True, verify=False)
                
                if res_get.status_code in [200, 206]:
                    with open(file_name, "wb") as f_out:
                        smx.DeFile(res_get.raw, ciph_size, f_out)
                    print(f"-> Download complete! {file_name} restored.")
                else:
                    print(f"-> Download failed: {res_get.status_code}")

            # 2. file and directory batch upload pipeline control branch
            elif cmd_line.startswith("upload "):
                target_path = cmd_line[7:].strip()
                if target_path.startswith('"') and target_path.endswith('"'):
                    target_path = target_path[1:-1]
                if not os.path.exists(target_path):
                    print("Error: Invalid file path!")
                    continue

                # directory
                if os.path.isdir(target_path):
                    print(f"Directory detected: '{target_path}', batch processing.")
                    for sub_file in os.listdir(target_path):
                        full_sub_path = os.path.join(target_path, sub_file)
                        if os.path.isfile(full_sub_path):
                            process_file_upload(server_url, folder_pid, folder_key, fls_map, full_sub_path)
                else:
                    process_file_upload(server_url, folder_pid, folder_key, fls_map, target_path)

                # After all files are uploaded, synchronize the accumulated metadata list map
                met_sm = Bencrypt.SymMaster("gcm1", folder_key)
                encoded_meta = Opsec.EncodeCfg(fls_map)
                requests.post(url_meta, data=met_sm.EnBin(encoded_meta), verify=False)
                print("-> Metadata synchronization complete.")
            else:
                print("-> Invalid command!")

if __name__ == "__main__":
    main()