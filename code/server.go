// test823 : project WHY MediaHub
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// server config
type Config struct {
	StorageDir string `json:"storage"`
	Port       string `json:"port"`
	CertFile   string `json:"cert"`
	KeyFile    string `json:"key"`
}

var cfg Config

// init environment
func initEnv() {
	// set default value
	configPath := "./config.json"
	cfg = Config{
		StorageDir: "./",
		Port:       "443",
		CertFile:   "./cert.pem",
		KeyFile:    "./key.pem",
	}

	// load config, make new if not exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		file, _ := json.MarshalIndent(cfg, "", "  ")
		_ = os.WriteFile(configPath, file, 0644)
		log.Println("config.json file not existing, created")
	} else {
		file, _ := os.ReadFile(configPath)
		_ = json.Unmarshal(file, &cfg)
	}

	// make directories
	_ = os.MkdirAll(filepath.Join(cfg.StorageDir, "users"), 0755)
	_ = os.MkdirAll(filepath.Join(cfg.StorageDir, "data"), 0755)
	_ = os.MkdirAll("./public", 0755)

	// make certificate if not exists
	if _, err := os.Stat(cfg.CertFile); os.IsNotExist(err) {
		log.Println("making self-signed certificate")
		makeCert(cfg.CertFile, cfg.KeyFile)
	}
}

// handles userdata
func serveUser(w http.ResponseWriter, r *http.Request) {
	// URL: /api/userdata/{user_hash}
	userHash := strings.TrimPrefix(r.URL.Path, "/api/userdata/")
	if userHash == "" || strings.Contains(userHash, "/") {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	path := filepath.Join(cfg.StorageDir, "users", filepath.Clean(userHash), "userdata")
	switch r.Method {
	case http.MethodGet: // read userdata
		http.ServeFile(w, r, path)
	case http.MethodPost: // create/update userdata
		_ = os.MkdirAll(filepath.Dir(path), 0755)
		save(w, r, path)
	case http.MethodDelete: // delete userdata
		_ = os.RemoveAll(filepath.Dir(path))
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// handles folder metadata
func serveMeta(w http.ResponseWriter, r *http.Request) {
	// URL: /api/storage/{folder_pid}/names
	target := strings.TrimPrefix(r.URL.Path, "/api/storage/")
	parts := strings.Split(target, "/")
	if len(parts) < 2 {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	folderID, metaType := parts[0], parts[1]
	if metaType != "names" {
		http.Error(w, "Invalid Metadata Type", http.StatusBadRequest)
		return
	}

	path := filepath.Join(cfg.StorageDir, "data", filepath.Clean(folderID), "names")
	switch r.Method {
	case http.MethodGet: // read metadata
		http.ServeFile(w, r, path)
	case http.MethodPost: // create/update metadata
		_ = os.MkdirAll(filepath.Dir(path), 0755)
		save(w, r, path)
	case http.MethodDelete: // delete metadata
		_ = os.RemoveAll(filepath.Dir(path))
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// handles media files
func serveMedia(w http.ResponseWriter, r *http.Request) {
	// URL: /api/media/{folder_pid}/{file_pid}/{dat|thumb}
	target := strings.TrimPrefix(r.URL.Path, "/api/media/")
	parts := strings.Split(target, "/")
	if len(parts) < 3 {
		http.Error(w, "Folder/File ID and Data Type(dat/thumb) Required", http.StatusBadRequest)
		return
	}
	folderID, fileID, dataType := parts[0], parts[1], parts[2]
	if dataType != "dat" && dataType != "thumb" {
		http.Error(w, "Invalid Data Type", http.StatusBadRequest)
		return
	}

	// use filename as hex.thumb, hex.dat
	fileName := filepath.Clean(fileID) + "." + dataType
	path := filepath.Join(cfg.StorageDir, "data", filepath.Clean(folderID), fileName)

	switch r.Method {
	case http.MethodGet: // read media file
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Accept-Ranges", "bytes")
		http.ServeFile(w, r, path)
	case http.MethodPost: // create/update media file
		_ = os.MkdirAll(filepath.Dir(path), 0755)
		save(w, r, path)
	case http.MethodDelete: // delete media file
		_ = os.Remove(path)
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// overwrite file
func save(w http.ResponseWriter, r *http.Request, path string) {
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	if _, err = io.Copy(out, r.Body); err != nil {
		http.Error(w, "Write Fault", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("Success"))
}

// cross platform optimization middleware filter
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "..") { // block directory traversal
			http.Error(w, "Directory Traversal Detected", http.StatusBadRequest)
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
	_ = pem.Encode(cFile, &pem.Block{Type: "CERTIFICATE", Bytes: der})

	// write private key
	kFile, _ := os.OpenFile(keyOut, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	defer kFile.Close()
	b, _ := x509.MarshalECPrivateKey(priv)
	_ = pem.Encode(kFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: b})
}

func main() {
	initEnv()

	// link API and file server
	mux := http.NewServeMux()
	mux.HandleFunc("/api/userdata/", serveUser)
	mux.HandleFunc("/api/storage/", serveMeta)
	mux.HandleFunc("/api/media/", serveMedia)
	mux.Handle("/", http.FileServer(http.Dir("./public")))

	// start server with TLS
	log.Printf("Server is running on port %s", cfg.Port)
	err := http.ListenAndServeTLS(":"+cfg.Port, cfg.CertFile, cfg.KeyFile, cors(mux))
	if err != nil {
		log.Fatalf("Server startup error: %v", err)
	}
}
