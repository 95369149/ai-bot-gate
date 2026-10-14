#!/usr/bin/env python3
"""部署 AIGate Worker 到 Cloudflare（走 stored custom.cloudflare 凭证，不碰 raw key）。"""
import sys, os, json, urllib.request, uuid

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

API = "https://api.cloudflare.com/client/v4"
ACCOUNT = "26895c14adbb30b3754e79c0d5a41a17"
SCRIPT = "ai-bot-gate"
HERE = os.path.dirname(os.path.abspath(__file__))


def authed(url, method="GET", data=None, content_type=None):
    req = urllib.request.Request(url, data=data, method=method)
    if content_type:
        req.add_header("Content-Type", content_type)
    add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=["api.cloudflare.com"])
    with urllib.request.urlopen(req, timeout=120) as resp:
        return read_json_response(resp)


def main():
    with open(os.path.join(HERE, "worker.js"), "rb") as f:
        script = f.read()
    print(f"脚本大小: {len(script)} 字节", flush=True)

    # multipart 上传
    boundary = "----aigate" + uuid.uuid4().hex
    metadata = json.dumps({
        "main_module": "worker.js",
        "compatibility_date": "2024-11-01",
    }).encode()
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="metadata"\r\n'
    body += b"Content-Type: application/json\r\n\r\n" + metadata + b"\r\n"
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n'
    body += b"Content-Type: application/javascript+module\r\n\r\n" + script + b"\r\n"
    body += f"--{boundary}--\r\n".encode()

    url = f"{API}/accounts/{ACCOUNT}/workers/scripts/{SCRIPT}"
    r = authed(url, "PUT", body, f"multipart/form-data; boundary={boundary}")
    if not r.get("success"):
        print("上传失败:", json.dumps(r, ensure_ascii=False)[:500])
        sys.exit(1)
    print("上传成功:", r["result"].get("id"), flush=True)

    # 开 workers.dev 子域名
    r2 = authed(f"{url}/subdomain", "POST",
                json.dumps({"enabled": True}).encode(), "application/json")
    print("子域名:", json.dumps(r2.get("result"), ensure_ascii=False)[:300], flush=True)

    # 查最终地址
    r3 = authed(f"{url}/subdomain", "GET")
    sub = (r3.get("result") or {}).get("subdomain")
    print("演示地址: https://" + (r3.get("result") or {}).get("subdomain", "?") + f".workers.dev  (脚本 {SCRIPT})")
    # 实际 workers.dev 地址格式为 {script}.{account_subdomain}.workers.dev，需要查 workers 子域名
    r4 = authed(f"{API}/accounts/{ACCOUNT}/workers/subdomain", "GET")
    acct_sub = (r4.get("result") or {}).get("subdomain")
    if acct_sub:
        print(f"演示地址: https://{SCRIPT}.{acct_sub}.workers.dev")


if __name__ == "__main__":
    main()
