import subprocess
import tempfile


def detect_mime(file_bytes: bytes, filename: str = "") -> str:
    mime = _magic_from_buffer(file_bytes)
    if mime != "application/octet-stream":
        return mime
    if filename:
        ext_map = {
            ".txt": "text/plain",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".pdf": "application/pdf",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }
        for ext, mime_type in ext_map.items():
            if filename.lower().endswith(ext):
                return mime_type
    return "application/octet-stream"


def _magic_from_buffer(buf: bytes) -> str:
    try:
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(buf)
            tmp_path = tmp.name
        result = subprocess.run(
            ["/usr/bin/file", "--mime-type", "-b", tmp_path],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip()
    finally:
        try:
            import os
            os.unlink(tmp_path)
        except (NameError, OSError):
            pass
