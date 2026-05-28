import os
import subprocess
import tempfile

try:
    import magic

    def _detect_with_libmagic(file_bytes: bytes) -> str:
        return magic.from_buffer(file_bytes, mime=True)

except ImportError:
    magic = None

    def _detect_with_libmagic(file_bytes: bytes) -> str:
        raise RuntimeError("libmagic not available")


def _detect_with_file_cmd(file_bytes: bytes) -> str:
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        result = subprocess.run(
            ["/usr/bin/file", "--mime-type", "-b", tmp_path],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return "application/octet-stream"
        return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return "application/octet-stream"
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


EXT_MAP = {
    ".txt": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def detect_mime(file_bytes: bytes, filename: str = "") -> str:
    # Try libmagic first (available in Docker/Linux), fall back to file command
    try:
        mime = _detect_with_libmagic(file_bytes)
    except Exception:
        mime = _detect_with_file_cmd(file_bytes)

    if mime and mime != "application/octet-stream":
        return mime

    # Extension fallback
    if filename:
        for ext, mime_type in EXT_MAP.items():
            if filename.lower().endswith(ext):
                return mime_type

    return mime or "application/octet-stream"
