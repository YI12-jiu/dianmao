"""通过 GitHub Git Data API 提交文件（当 git 的 443 通道被代理挡住时的备用通道）
用法： python scripts/gh-upload.py <owner>/<repo>
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = sys.argv[1] if len(sys.argv) > 1 else 'YI12-jiu/dianmao'
TOKEN = subprocess.check_output(['gh', 'auth', 'token'], text=True).strip()
API = 'https://api.github.com'


def call(method, path, payload=None, retries=3):
    url = API + path
    data = json.dumps(payload).encode() if payload is not None else None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Authorization', 'Bearer ' + TOKEN)
        req.add_header('Accept', 'application/vnd.github+json')
        req.add_header('X-GitHub-Api-Version', '2022-11-28')
        req.add_header('User-Agent', 'dianmao-deploy')
        if data:
            req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:300]
            if e.code in (500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 + attempt * 3)
                continue
            raise SystemExit(f'{method} {path} -> {e.code} {detail}')
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 + attempt * 3)
                continue
            raise SystemExit(f'{method} {path} -> {e}')


def bootstrap_if_empty():
    """空仓库不能直接建 blob，先用 Contents API 落一个文件把 main 分支开出来"""
    try:
        call('GET', f'/repos/{REPO}/git/ref/heads/main')
        return
    except SystemExit:
        pass
    with open('README.md', 'rb') as fh:
        content = base64.b64encode(fh.read()).decode()
    call('PUT', f'/repos/{REPO}/contents/README.md', {
        'message': 'chore: 初始化仓库',
        'content': content,
        'branch': 'main',
    })
    print('已初始化 main 分支')


def main():
    files = [f for f in subprocess.check_output(['git', '-c', 'core.quotepath=false', 'ls-files'], text=True).splitlines() if f]
    if not files:
        raise SystemExit('git ls-files 为空，先 git add')
    bootstrap_if_empty()
    print(f'准备提交 {len(files)} 个文件到 {REPO}')

    entries = []
    for i, path in enumerate(files, 1):
        with open(path, 'rb') as fh:
            content = base64.b64encode(fh.read()).decode()
        blob = call('POST', f'/repos/{REPO}/git/blobs', {'content': content, 'encoding': 'base64'})
        executable = os.access(path, os.X_OK) and path.endswith('.sh')
        entries.append({
            'path': path.replace(os.sep, '/'),
            'mode': '100755' if executable else '100644',
            'type': 'blob',
            'sha': blob['sha'],
        })
        print(f'  [{i}/{len(files)}] {path}')

    tree = call('POST', f'/repos/{REPO}/git/trees', {'tree': entries})
    commit = call('POST', f'/repos/{REPO}/git/commits', {
        'message': '点卯 · 课堂考勤工作台：登录页 + 老师端/学生端，离线优先，云同步队列',
        'tree': tree['sha'],
    })

    try:
        call('POST', f'/repos/{REPO}/git/refs', {'ref': 'refs/heads/main', 'sha': commit['sha']})
        print('已创建分支 main')
    except SystemExit as e:
        if '422' in str(e) or '409' in str(e):
            call('PATCH', f'/repos/{REPO}/git/refs/heads/main', {'sha': commit['sha'], 'force': True})
            print('已更新分支 main')
        else:
            raise

    print('commit:', commit['sha'][:10])
    print(f'https://github.com/{REPO}')


if __name__ == '__main__':
    main()
