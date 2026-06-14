// test823 : project WHY MediaHub Client Engine
import { NormPW } from './Bencode/Bencode.js';
import { HashMaster, SHA3256, SymMaster, Random } from './Bencrypt/Bencrypt.js';
import { EncodeCfg, DecodeCfg } from './Opsec/Opsec.js';

const SERVER_URL = "https://localhost:443"; // Go 백엔드 주소 연동
// 🔒 [보안 스펙] 무작위 사전 대조 레인보우 테이블 공격을 원천 무력화하기 위한 소스코드 내 고정 페퍼
const SECRET_PEPPER = "_WHY_MEDIA_HUB_PROTOCOL_2026_SECURE_PEPPER_!@#$";

// 메모리 내부 세션 컨텍스트 (브라우저 종료/새로고침 시 영구 증발)
let session = {
    userHash: "",  // 유저 데이터 조회용 식별 키 문자열 (hex)
    userKey: null,   // 가상 폴더 목록 해독용 44바이트 마스터 키
    folderMap: {}, // 가상 폴더 컨테이너: Map<폴더명, 폴더키>
    currentFolderKey: null,
    currentFolderId: "",
    currentNamesMap: {} // 현재 폴더의 파일 정보 컨테이너: Map<파일명, 파일키>
};

// 헬퍼: USAG-Lib SHA3-256 연동 물리 위치 Hex(24자) 변환기
function getPhysicalId(cryptoKey) {
    const hashed = SHA3256(cryptoKey);
    return Array.from(hashed.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 헬퍼: 대용량 암호화 파일 전송을 위한 입출력 청크 누적 어댑터 객체
class BufferWriter {
    constructor() { this.chunks = []; this.length = 0; }
    async write(chunk) {
        this.chunks.push(new Uint8Array(chunk));
        this.length += chunk.length;
    }
    getBuffer() {
        const res = new Uint8Array(this.length);
        let offset = 0;
        for (const c of this.chunks) { res.set(c, offset); offset += c.length; }
        return res;
    }
}

// 헬퍼: EnFile용 웹 브라우저 로컬 파일 청크 리더 어댑터 객체
class FileSource {
    constructor(file) { this.file = file; this.offset = 0; }
    async read(size) {
        if (this.offset >= this.file.size) return new Uint8Array(0);
        const slice = this.file.slice(this.offset, this.offset + size);
        const buf = await slice.arrayBuffer();
        this.offset += buf.byteLength;
        return new Uint8Array(buf);
    }
}

// 1단계: 인증 및 가변 솔트 마스터 키 추출 연산
document.getElementById("btnConnect").addEventListener("click", async () => {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username || !password) return alert("아이디와 비밀번호를 입력하십시오.");

    try {
        // 유니코드 유실 방지 NFC 정규화 및 바이트 치환
        const pwBytes = NormPW(password);

        // 💡 [요구사항 반영] username 문자열과 내부 고정 페퍼 상수를 결합하여 유저 고유 가변 솔트 생성
        const saltStr = username + SECRET_PEPPER;
        const saltBytes = new TextEncoder().encode(saltStr);

        // Argon2id 구동 키 유도 수행
        const hm = new HashMaster("arg2", 32, 44);
        const [storeKey, userKey] = await hm.KDF(pwBytes, saltBytes); //

        session.userHash = getPhysicalId(storeKey);
        session.userKey = userKey;

        document.getElementById("lblUserHash").textContent = session.userHash;

        // 가상 스토리지 메타데이터 가져오기
        await fetchUserdata();
        renderFolderSelect();

        document.getElementById("authSection").classList.add("hidden");
        document.getElementById("mainSection").classList.remove("hidden");

    } catch (err) {
        alert("보안 스토리지 해제에 실패했습니다.");
    }
});

// 2단계: 유저데이터 다운로드 및 동기화
async function fetchUserdata() {
    const res = await fetch(`${SERVER_URL}/api/userdata/${session.userHash}`);
    if (res.status === 404) {
        session.folderMap = {};
        return;
    }
    const encBuf = new Uint8Array(await res.arrayBuffer());
    const sm = new SymMaster("gcm1", session.userKey);
    const decBuf = await sm.DeBin(encBuf); //
    session.folderMap = DecodeCfg(decBuf); //
}

async function syncUserdata() {
    const sm = new SymMaster("gcm1", session.userKey);
    const cfgBuf = EncodeCfg(session.folderMap); //
    const encBuf = await sm.EnBin(cfgBuf); //
    await fetch(`${SERVER_URL}/api/userdata/${session.userHash}`, { method: "POST", body: encBuf });
}

// 3단계: 가상 폴더 CRUD 제어 기법
function renderFolderSelect() {
    const select = document.getElementById("folderSelect");
    select.innerHTML = '<option value="">-- 폴더를 선택하세요 --</option>';
    Object.keys(session.folderMap).forEach(name => {
        const opt = document.createElement("option");
        opt.value = name; opt.textContent = name;
        select.appendChild(opt);
    });
}

document.getElementById("btnCreateFolder").addEventListener("click", async () => {
    const name = document.getElementById("newFolderName").value.trim();
    if (!name || session.folderMap[name]) return alert("유효하지 않거나 이미 존재하는 폴더명입니다.");

    session.folderMap[name] = Random(44); // 12B IV + 32B Key 임의 생성
    await syncUserdata();
    renderFolderSelect();
    document.getElementById("newFolderName").value = "";
    alert("가상 폴더가 생성 및 안전 동기화되었습니다.");
});

// 폴더 변경 감지 -> 파일 목록(names) 파싱 로드
document.getElementById("folderSelect").addEventListener("change", async (e) => {
    const folderName = e.target.value;
    if (!folderName) {
        document.getElementById("uploadContainer").classList.add("hidden");
        document.getElementById("mediaContainer").classList.add("hidden");
        return;
    }

    session.currentFolderKey = session.folderMap[folderName];
    session.currentFolderId = getPhysicalId(session.currentFolderKey);

    await loadFolderContent();
});

async function loadFolderContent() {
    document.getElementById("uploadContainer").classList.remove("hidden");
    document.getElementById("mediaContainer").classList.remove("hidden");

    const res = await fetch(`${SERVER_URL}/api/storage/${session.currentFolderId}/names`);
    if (res.status === 404) {
        session.currentNamesMap = {};
    } else {
        const encBuf = new Uint8Array(await res.arrayBuffer());
        const sm = new SymMaster("gcm1", session.currentFolderKey);
        session.currentNamesMap = DecodeCfg(await sm.DeBin(encBuf)); //
    }
    renderMediaGrid();
}

// 4단계: 분할 암호화 업로드 파이프라인 연동 (dat, thumb 덮어쓰기 지원)
document.getElementById("btnUpload").addEventListener("click", async () => {
    const file = document.getElementById("fileInput").files[0];
    const thumb = document.getElementById("thumbInput").files[0];

    if (!file) return alert("최소한 미디어 파일은 필수 등록 항목입니다.");

    try {
        const fileKey = Random(44); // 파일 전용 고유 키 독립 파생
        const filePid = getPhysicalId(fileKey);

        // A. 대용량 미디어 파일 처리 (gcmx1 청크 암호화 후 업로드)
        const mediaSm = new SymMaster("gcmx1", fileKey);
        const srcAdapter = new FileSource(file);
        const dstAdapter = new BufferWriter();
        await mediaSm.EnFile(srcAdapter, file.size, dstAdapter); //

        await fetch(`${SERVER_URL}/api/media/${session.currentFolderId}/${filePid}/dat`, {
            method: "POST", body: dstAdapter.getBuffer()
        });

        // B. 썸네일 파일 처리 (요구사항 반영: 폴더키 기반 gcm1 암호화 후 .thumb 업로드)
        if (thumb) {
            const thumbBuf = new Uint8Array(await thumb.arrayBuffer());
            const folderSm = new SymMaster("gcm1", session.currentFolderKey);
            const encThumb = await folderSm.EnBin(thumbBuf); //
            await fetch(`${SERVER_URL}/api/media/${session.currentFolderId}/${filePid}/thumb`, {
                method: "POST", body: encThumb
            });
        }

        // C. 폴더 메타데이터(names) 갱신 및 서버 업로드
        session.currentNamesMap[file.name] = fileKey;
        const metaSm = new SymMaster("gcm1", session.currentFolderKey);
        const encMeta = await metaSm.EnBin(EncodeCfg(session.currentNamesMap)); //
        await fetch(`${SERVER_URL}/api/storage/${session.currentFolderId}/names`, { method: "POST", body: encMeta });

        alert("미디어 파일이 완전히 성공적으로 업로드되었습니다.");
        await loadFolderContent();

    } catch (err) {
        alert("업로드 처리 중 오류 발생");
    }
});

// 5단계: 가상 라이브러리 목록화 및 개별 썸네일 동적 해독 복원
function renderMediaGrid() {
    const grid = document.getElementById("mediaGrid");
    grid.innerHTML = "";

    Object.entries(session.currentNamesMap).forEach(([fileName, fileKey]) => {
        const filePid = getPhysicalId(fileKey);

        const card = document.createElement("div");
        card.className = "media-card";

        const img = document.createElement("img");
        img.className = "thumb-img";
        img.alt = "Thumbnail Loading...";

        // 💡 비동기로 개별 .thumb 암호문만 래치하여 즉석 복호화 처리 후 가상 이미지 주소(Blob URL) 바인딩
        fetchAndDecryptThumb(filePid, img);

        const title = document.createElement("div");
        title.style.fontWeight = "bold"; title.textContent = fileName;

        card.appendChild(img); card.appendChild(title);
        card.addEventListener("click", () => startStreaming(fileName, fileKey));
        grid.appendChild(card);
    });
}

async function fetchAndDecryptThumb(filePid, imgElement) {
    try {
        const res = await fetch(`${SERVER_URL}/api/media/${session.currentFolderId}/${filePid}/thumb`);
        if (res.status === 404) return imgElement.alt = "No Thumbnail";

        const encBuf = new Uint8Array(await res.arrayBuffer());
        const sm = new SymMaster("gcm1", session.currentFolderKey);
        const decBuf = await sm.DeBin(encBuf); //

        imgElement.src = URL.createObjectURL(new Blob([decBuf]));
    } catch (e) { imgElement.alt = "Error"; }
}

// 6단계: ★ 핵심 - ReadableStream 연동 고속 대용량 스트리밍 복호화 파이프라인
async function startStreaming(fileName, fileKey) {
    document.getElementById("playerContainer").classList.remove("hidden");
    document.getElementById("playingTitle").textContent = "재생 중: " + fileName;

    const filePid = getPhysicalId(fileKey);

    // 백엔드로부터 암호화 통파일의 전체 Length 사양 메타데이터 탐색 취득
    const headRes = await fetch(`${SERVER_URL}/api/media/${session.currentFolderId}/${filePid}/dat`, { method: "GET", headers: { 'Range': 'bytes=0-0' } });
    const contentRange = headRes.headers.get("Content-Range");
    if (!contentRange) return alert("스트리밍 헤더 감지에 실패했습니다.");
    const encryptedTotalSize = parseInt(contentRange.split("/")[1], 10);

    const mediaSm = new SymMaster("gcmx1", fileKey);

    class ChunkedServerSource {
        constructor() { this.pointer = 0; }
        async read(size) {
            if (this.pointer >= encryptedTotalSize) return new Uint8Array(0);
            const end = Math.min(this.pointer + size - 1, encryptedTotalSize - 1);
            const res = await fetch(`${SERVER_URL}/api/media/${session.currentFolderId}/${filePid}/dat`, {
                headers: { 'Range': `bytes=${this.pointer}-${end}` }
            });
            const ab = await res.arrayBuffer();
            this.pointer += ab.byteLength;
            return new Uint8Array(ab);
        }
    }

    // 복호화된 청크가 나오는 즉시 ReadableStream 컨트롤러 버퍼에 인큐
    const stream = new ReadableStream({
        async start(controller) {
            const src = new ChunkedServerSource();
            const dst = { write: async (plainChunk) => controller.enqueue(plainChunk) };
            try {
                // 1MB 파이프라인 루프를 돌며 실시간 브라우저 메모리 복호화 수행
                await mediaSm.DeFile(src, encryptedTotalSize, dst); //
            } catch (e) { controller.error(e); }
            finally { controller.close(); }
        }
    });

    const video = document.getElementById("videoPlayer");
    video.src = URL.createObjectURL(new Response(stream).blob());
}

document.getElementById("btnRefresh").addEventListener("click", async () => {
    if (session.userHash) { await fetchUserdata(); renderFolderSelect(); }
});