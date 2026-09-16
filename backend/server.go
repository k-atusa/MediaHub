// test823 : project WHY MediaHub
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

//go:embed all:dist
var distFS embed.FS

// server config
type Config struct {
	StorageDir string `json:"storage"`
	Port       string `json:"port"`
	CertFile   string `json:"cert"`
	KeyFile    string `json:"key"`
	InviteCode string `json:"invite"`
	Notice     string `json:"notice"`
}

var cfg Config

// init environment
func initEnv() {
	// move to executable path
	exePath, _ := os.Executable()
	realPath, _ := filepath.EvalSymlinks(exePath)
	os.Chdir(filepath.Dir(realPath))

	// set default value
	configPath := "./config/config.json"
	cfg = Config{
		StorageDir: "./",
		Port:       "443",
		CertFile:   "./certs/cert.pem",
		KeyFile:    "./certs/key.pem",
		InviteCode: "",
		Notice:     "",
	}

	// load config, make new if not exists
	configDir := filepath.Dir(configPath)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		log.Printf("failed to create config directory: %v", err)
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		file, _ := json.MarshalIndent(cfg, "", "  ")
		os.WriteFile(configPath, file, 0644)
		log.Println("config.json file not exists, created")
	} else {
		file, _ := os.ReadFile(configPath)
		json.Unmarshal(file, &cfg)
	}

	// make directories
	os.MkdirAll(filepath.Join(cfg.StorageDir, "users"), 0755)
	os.MkdirAll(filepath.Join(cfg.StorageDir, "data"), 0755)

	// make certificate if not exists
	certDir := filepath.Dir(cfg.CertFile)
	if err := os.MkdirAll(certDir, 0755); err != nil {
		log.Printf("failed to create certs directory: %v", err)
	}

	if _, err := os.Stat(cfg.CertFile); os.IsNotExist(err) {
		log.Println("making self-signed certificate")
		makeCert(cfg.CertFile, cfg.KeyFile)
	}
}

// return error with 1.5s delay
func postError(w http.ResponseWriter, error string, code int) {
	time.Sleep(1500 * time.Millisecond)
	http.Error(w, error, code)
}

// handles userdata
func serveUser(w http.ResponseWriter, r *http.Request) {
	// URL: /api/userdata/{user_hash}
	userHash := strings.TrimPrefix(r.URL.Path, "/api/userdata/")
	if userHash == "" || strings.Contains(userHash, "/") {
		postError(w, "Bad Request", http.StatusBadRequest)
		return
	}

	path := filepath.Join(cfg.StorageDir, "users", filepath.Clean(userHash))
	switch r.Method {
	case http.MethodGet, http.MethodHead: // read userdata or check existence
		http.ServeFile(w, r, path)
	case http.MethodPost: // create/update userdata
		isNewUser := false
		if _, err := os.Stat(path); os.IsNotExist(err) {
			isNewUser = true
		}

		if isNewUser && cfg.InviteCode != "" {
			// check if user is changing PW
			oldHash := r.Header.Get("X-Old-Hash")
			oldPath := ""
			if oldHash != "" && !strings.Contains(oldHash, "/") && !strings.Contains(oldHash, "\\") {
				oldPath = filepath.Join(cfg.StorageDir, "users", filepath.Clean(oldHash))
			}

			// check old account or invite code
			if oldPath != "" {
				if info, err := os.Stat(oldPath); err != nil || info.IsDir() {
					postError(w, "Invalid Old User", http.StatusForbidden)
					return
				}
			} else {
				if r.Header.Get("X-Invite-Code") != cfg.InviteCode {
					postError(w, "Invalid Invite Code", http.StatusForbidden)
					return
				}
			}
		}

		os.MkdirAll(filepath.Dir(path), 0700)
		save(w, r, path)
	case http.MethodDelete: // delete userdata
		if _, err := os.Stat(path); os.IsNotExist(err) {
			time.Sleep(1500 * time.Millisecond)
		} else {
			os.Remove(path)
		}
		w.WriteHeader(http.StatusOK)
	default:
		postError(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// handles folder metadata
func serveMeta(w http.ResponseWriter, r *http.Request) {
	// URL: /api/storage/{folder_pid}/names
	target := strings.TrimPrefix(r.URL.Path, "/api/storage/")
	parts := strings.Split(target, "/")
	if len(parts) < 2 {
		postError(w, "Bad Request", http.StatusBadRequest)
		return
	}
	folderID, metaType := parts[0], parts[1]
	if metaType != "names" {
		postError(w, "Invalid Metadata Type", http.StatusBadRequest)
		return
	}

	path := filepath.Join(cfg.StorageDir, "data", filepath.Clean(folderID), "names")
	isCreation := false
	if r.Method == http.MethodPost {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			isCreation = true
		}
	}

	// Folder creation or deletion needs user validation
	if r.Method == http.MethodDelete || isCreation {
		userHash := r.Header.Get("X-User-Hash")
		if userHash == "" || strings.Contains(userHash, "/") || strings.Contains(userHash, "\\") {
			postError(w, "Bad Request: Invalid User Hash", http.StatusBadRequest)
			return
		}
		userPath := filepath.Join(cfg.StorageDir, "users", filepath.Clean(userHash))
		if info, err := os.Stat(userPath); os.IsNotExist(err) || info.IsDir() {
			postError(w, "Invalid User", http.StatusForbidden)
			return
		}
	}

	switch r.Method {
	case http.MethodGet, http.MethodHead: // read metadata or check existence
		http.ServeFile(w, r, path)
	case http.MethodPost: // create/update metadata
		os.MkdirAll(filepath.Dir(path), 0755)
		save(w, r, path)
	case http.MethodDelete: // delete metadata
		os.RemoveAll(filepath.Dir(path))
		w.WriteHeader(http.StatusOK)
	default:
		postError(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// handles media files
func serveMedia(w http.ResponseWriter, r *http.Request) {
	// URL: /api/media/{folder_pid}/{file_pid}/{dat|thumb}
	target := strings.TrimPrefix(r.URL.Path, "/api/media/")
	parts := strings.Split(target, "/")
	if len(parts) < 3 {
		postError(w, "Folder/File ID and Data Type(dat/thumb) Required", http.StatusBadRequest)
		return
	}
	folderID, fileID, dataType := parts[0], parts[1], parts[2]
	if dataType != "dat" && dataType != "thumb" {
		postError(w, "Invalid Data Type", http.StatusBadRequest)
		return
	}

	// use filename as hex.thumb, hex.dat
	fileName := filepath.Clean(fileID) + "." + dataType
	path := filepath.Join(cfg.StorageDir, "data", filepath.Clean(folderID), fileName)

	switch r.Method {
	case http.MethodGet, http.MethodHead: // read media file or check existence
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Accept-Ranges", "bytes")
		http.ServeFile(w, r, path)
	case http.MethodPost: // create/update media file
		userHash := r.Header.Get("X-User-Hash")
		if userHash == "" || strings.Contains(userHash, "/") || strings.Contains(userHash, "\\") {
			postError(w, "Bad Request: Invalid User Hash", http.StatusBadRequest)
			return
		}
		userPath := filepath.Join(cfg.StorageDir, "users", filepath.Clean(userHash))
		if info, err := os.Stat(userPath); os.IsNotExist(err) || info.IsDir() {
			postError(w, "Invalid User", http.StatusForbidden)
			return
		}
		os.MkdirAll(filepath.Dir(path), 0755)
		save(w, r, path)
	case http.MethodDelete: // delete media file
		if _, err := os.Stat(path); os.IsNotExist(err) {
			time.Sleep(1500 * time.Millisecond)
		} else {
			os.Remove(path)
		}
		w.WriteHeader(http.StatusOK)
	default:
		postError(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// DecryptedStreamReader provides an io.ReadSeeker that decrypts gcmx1 chunks on-the-fly for HTTP streaming.
type DecryptedStreamReader struct {
	file        *os.File
	globalIV    []byte
	aesKey      []byte
	origSize    int64
	offset      int64
	curChunkIdx int64
	curChunkBuf []byte
}

func (r *DecryptedStreamReader) Seek(offset int64, whence int) (int64, error) {
	var newOffset int64
	switch whence {
	case io.SeekStart:
		newOffset = offset
	case io.SeekCurrent:
		newOffset = r.offset + offset
	case io.SeekEnd:
		newOffset = r.origSize + offset
	default:
		return 0, fmt.Errorf("invalid whence")
	}
	if newOffset < 0 {
		return 0, fmt.Errorf("negative offset")
	}
	r.offset = newOffset
	return r.offset, nil
}

func (r *DecryptedStreamReader) Read(p []byte) (int, error) {
	if r.offset >= r.origSize {
		return 0, io.EOF
	}

	const plainChunk = 1048576
	const cipherChunk = plainChunk + 16

	chunkIdx := r.offset / plainChunk
	chunkOffset := r.offset % plainChunk

	if r.curChunkBuf == nil || r.curChunkIdx != chunkIdx {
		plainLen := int64(plainChunk)
		if (chunkIdx+1)*plainChunk > r.origSize {
			plainLen = r.origSize - chunkIdx*plainChunk
		}
		cipherLen := plainLen + 16

		cStart := 12 + chunkIdx*cipherChunk
		cipherBuf := make([]byte, cipherLen)
		n, err := r.file.ReadAt(cipherBuf, cStart)
		if err != nil && err != io.EOF {
			return 0, err
		}
		if int64(n) < cipherLen {
			cipherBuf = cipherBuf[:n]
		}
		if len(cipherBuf) < 16 {
			return 0, fmt.Errorf("unexpected EOF reading chunk %d (read %d bytes)", chunkIdx, n)
		}

		iv := make([]byte, 12)
		copy(iv, r.globalIV)
		var countBuf [8]byte
		binary.LittleEndian.PutUint64(countBuf[:], uint64(chunkIdx))
		for i := 0; i < 8; i++ {
			iv[4+i] ^= countBuf[i]
		}

		block, err := aes.NewCipher(r.aesKey)
		if err != nil {
			return 0, err
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return 0, err
		}
		plain, err := gcm.Open(nil, iv, cipherBuf, nil)
		if err != nil {
			return 0, fmt.Errorf("decrypt error chunk %d: %w", chunkIdx, err)
		}

		r.curChunkIdx = chunkIdx
		r.curChunkBuf = plain
	}

	avail := int64(len(r.curChunkBuf)) - chunkOffset
	if avail <= 0 {
		return 0, io.EOF
	}

	toCopy := int64(len(p))
	if toCopy > avail {
		toCopy = avail
	}

	copy(p, r.curChunkBuf[chunkOffset:chunkOffset+toCopy])
	r.offset += toCopy
	return int(toCopy), nil
}

// handles on-the-fly streaming decryption for video playback
func serveStream(w http.ResponseWriter, r *http.Request) {
	// URL: /api/stream/{folder_pid}/{file_pid}?key={fileKeyHex}&name={fileName}
	target := strings.TrimPrefix(r.URL.Path, "/api/stream/")
	parts := strings.Split(target, "/")
	if len(parts) < 2 {
		postError(w, "Folder ID and File ID Required", http.StatusBadRequest)
		return
	}
	folderID, fileID := parts[0], parts[1]

	keyHex := r.URL.Query().Get("key")
	if keyHex == "" {
		keyHex = r.Header.Get("X-File-Key")
	}
	if keyHex == "" {
		postError(w, "File key required for stream decryption", http.StatusBadRequest)
		return
	}

	rawKey, err := hex.DecodeString(keyHex)
	if err != nil || len(rawKey) < 32 {
		postError(w, "Invalid file key", http.StatusBadRequest)
		return
	}
	aesKey := rawKey[:32]

	fileName := r.URL.Query().Get("name")
	if fileName == "" {
		fileName = fileID + ".mp4"
	}

	path := filepath.Join(cfg.StorageDir, "data", filepath.Clean(folderID), filepath.Clean(fileID)+".dat")
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			postError(w, "File Not Found", http.StatusNotFound)
		} else {
			postError(w, "Internal Server Error", http.StatusInternalServerError)
		}
		return
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil || fi.Size() < 28 {
		postError(w, "Invalid cipher file", http.StatusBadRequest)
		return
	}

	globalIV := make([]byte, 12)
	if _, err := io.ReadFull(f, globalIV); err != nil {
		postError(w, "Failed to read cipher header", http.StatusInternalServerError)
		return
	}

	const plainChunk = 1048576
	const cipherChunk = plainChunk + 16

	fileCipherSize := fi.Size() - 12
	fullChunks := fileCipherSize / cipherChunk
	remCipher := fileCipherSize % cipherChunk
	var lastPlain int64
	if remCipher > 16 {
		lastPlain = remCipher - 16
	}
	origSize := fullChunks*plainChunk + lastPlain
	if len(rawKey) >= 52 {
		storedSize := int64(binary.LittleEndian.Uint64(rawKey[44:52]))
		if storedSize > 0 {
			origSize = storedSize
		}
	}
	if origSize <= 0 {
		postError(w, "Empty file", http.StatusBadRequest)
		return
	}

	reader := &DecryptedStreamReader{
		file:        f,
		globalIV:    globalIV,
		aesKey:      aesKey,
		origSize:    origSize,
		curChunkIdx: -1,
	}

	w.Header().Set("Accept-Ranges", "bytes")
	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".mp4", ".m4v":
		w.Header().Set("Content-Type", "video/mp4")
	case ".webm":
		w.Header().Set("Content-Type", "video/webm")
	case ".mov":
		w.Header().Set("Content-Type", "video/quicktime")
	case ".mkv":
		w.Header().Set("Content-Type", "video/x-matroska")
	default:
		w.Header().Set("Content-Type", "video/mp4")
	}

	http.ServeContent(w, r, fileName, fi.ModTime(), reader)
}

// handles notice fetch
func serveNotice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		postError(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"notice": cfg.Notice})
}

// handles trim (orphan file deletion)
func serveTrim(w http.ResponseWriter, r *http.Request) {
	// URL: /api/trim/{folder_pid}
	if r.Method != http.MethodPost {
		postError(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	folderID := strings.TrimPrefix(r.URL.Path, "/api/trim/")
	if folderID == "" || strings.Contains(folderID, "/") {
		postError(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// User authentication
	userHash := r.Header.Get("X-User-Hash")
	if userHash == "" || strings.Contains(userHash, "/") || strings.Contains(userHash, "\\") {
		postError(w, "Bad Request: Invalid User Hash", http.StatusBadRequest)
		return
	}
	userPath := filepath.Join(cfg.StorageDir, "users", filepath.Clean(userHash))
	if info, err := os.Stat(userPath); os.IsNotExist(err) || info.IsDir() {
		postError(w, "Invalid User", http.StatusForbidden)
		return
	}

	// Parse request body
	var req struct {
		PIDs []string `json:"pids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		postError(w, "Bad Request: Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate all PIDs are valid hex strings
	keepSet := make(map[string]bool)
	for _, pid := range req.PIDs {
		if _, err := hex.DecodeString(pid); err != nil || pid == "" {
			postError(w, "Bad Request: Invalid PID", http.StatusBadRequest)
			return
		}
		keepSet[pid] = true
	}

	// Scan folder directory
	folderPath := filepath.Join(cfg.StorageDir, "data", filepath.Clean(folderID))
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		postError(w, "Folder Not Found", http.StatusNotFound)
		return
	}

	// Classify files: only encrypted media files (hex.dat / hex.thumb)
	var reEncMedia = regexp.MustCompile(`^[0-9a-f]+\.(dat|thumb)$`)
	allPIDs := make(map[string]bool)
	toDelete := make(map[string]bool)
	deleteFiles := []string{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !reEncMedia.MatchString(name) {
			continue
		}

		// Extract PID from filename (everything before the last dot)
		dotIdx := strings.LastIndex(name, ".")
		pid := name[:dotIdx]
		allPIDs[pid] = true
		if !keepSet[pid] {
			toDelete[pid] = true
			deleteFiles = append(deleteFiles, filepath.Join(folderPath, name))
		}
	}

	// Safety check: retention ratio must be >= 50%
	totalUnique := len(allPIDs)
	deleteUnique := len(toDelete)
	keepUnique := totalUnique - deleteUnique
	if totalUnique == 0 {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("No encrypted media files found"))
		return
	}
	if keepUnique*2 < totalUnique {
		postError(w, fmt.Sprintf("Trim aborted: retention ratio too low (%d/%d keep, need >= 50%%)", keepUnique, totalUnique), http.StatusConflict)
		return
	}

	// Execute deletion
	deleted := 0
	for _, path := range deleteFiles {
		if err := os.Remove(path); err == nil {
			deleted++
		}
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(fmt.Sprintf("Trimmed %d files (%d orphan PIDs removed, %d PIDs kept)", deleted, deleteUnique, keepUnique)))
}

// overwrite file
func save(w http.ResponseWriter, r *http.Request, path string) {
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		postError(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	if _, err = io.Copy(out, r.Body); err != nil {
		postError(w, "Write Fault", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Success"))
}

// cross platform optimization middleware filter
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "..") || strings.Contains(r.URL.Path, "\\") { // block directory traversal
			postError(w, "Directory Traversal Detected", http.StatusBadRequest)
			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ECDSA P-256 self-signed certificate helper
func makeCert(certOut string, keyOut string) {
	// generate private key
	priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

	// set certificate validity
	notBefore := time.Now()
	notAfter := notBefore.Add(365 * 24 * time.Hour)
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, _ := rand.Int(rand.Reader, limit)

	// make certificate template
	template := x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			Organization: []string{"K-ATUSA Programming Club"},
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}

	// create certificate
	der, _ := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)

	// write certificate
	cFile, _ := os.Create(certOut)
	defer cFile.Close()
	pem.Encode(cFile, &pem.Block{Type: "CERTIFICATE", Bytes: der})

	// write private key
	kFile, _ := os.OpenFile(keyOut, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	defer kFile.Close()
	b, _ := x509.MarshalECPrivateKey(priv)
	pem.Encode(kFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: b})
}

func hasLocalIndex(dir string) bool {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return false
	}
	idx, err := os.Stat(filepath.Join(dir, "index.html"))
	return err == nil && !idx.IsDir()
}

// frontendHandler serves static frontend assets from disk (if available) or from embedded FS
func frontendHandler() http.Handler {
	var staticFS http.FileSystem

	// Check local override directories containing index.html first
	if hasLocalIndex("./dist") {
		staticFS = http.Dir("./dist")
		log.Println("Serving frontend from local ./dist directory")
	} else if hasLocalIndex("./public") {
		staticFS = http.Dir("./public")
		log.Println("Serving frontend from local ./public directory")
	} else {
		sub, err := fs.Sub(distFS, "dist")
		if err != nil {
			log.Fatalf("failed to initialize embedded frontend fs: %v", err)
		}
		staticFS = http.FS(sub)
		log.Println("Serving frontend from embedded binary filesystem")
	}

	fileServer := http.FileServer(staticFS)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cleanPath := strings.TrimPrefix(filepath.Clean(r.URL.Path), "/")
		if cleanPath == "" || cleanPath == "." {
			cleanPath = "index.html"
		}

		if cleanPath == "sw.js" {
			w.Header().Set("Service-Worker-Allowed", "/")
		}

		// Try opening requested file
		f, err := staticFS.Open(cleanPath)
		if err == nil {
			stat, statErr := f.Stat()
			f.Close()
			if statErr == nil {
				if stat.IsDir() {
					if !strings.HasSuffix(r.URL.Path, "/") {
						http.Redirect(w, r, r.URL.Path+"/", http.StatusMovedPermanently)
						return
					}
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		// Check if cleanPath/index.html exists (e.g. /folder -> /folder/)
		dirIndexPath := filepath.Join(cleanPath, "index.html")
		if fDir, errDir := staticFS.Open(dirIndexPath); errDir == nil {
			fDir.Close()
			if !strings.HasSuffix(r.URL.Path, "/") {
				http.Redirect(w, r, r.URL.Path+"/", http.StatusMovedPermanently)
				return
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		// Check if cleanPath.html exists (e.g. /folder -> /folder.html)
		htmlPath := cleanPath + ".html"
		if fHtml, errHtml := staticFS.Open(htmlPath); errHtml == nil {
			fHtml.Close()
			r.URL.Path = "/" + htmlPath
			fileServer.ServeHTTP(w, r)
			return
		}

		// Fallback to 404.html if present
		if f404, err404 := staticFS.Open("404.html"); err404 == nil {
			f404.Close()
			w.WriteHeader(http.StatusNotFound)
			r.URL.Path = "/404.html"
			fileServer.ServeHTTP(w, r)
			return
		}

		fileServer.ServeHTTP(w, r)
	})
}

func main() {
	initEnv()

	// link API and file server
	mux := http.NewServeMux()
	mux.HandleFunc("/api/userdata/", serveUser)
	mux.HandleFunc("/api/storage/", serveMeta)
	mux.HandleFunc("/api/media/", serveMedia)
	mux.HandleFunc("/api/stream/", serveStream)
	mux.HandleFunc("/api/notice", serveNotice)
	mux.HandleFunc("/api/trim/", serveTrim)
	mux.Handle("/", frontendHandler())

	// start server with TLS
	log.Printf("Server is running on port %s", cfg.Port)
	err := http.ListenAndServeTLS(":"+cfg.Port, cfg.CertFile, cfg.KeyFile, cors(mux))
	if err != nil {
		log.Fatalf("Server startup error: %v", err)
	}
}
