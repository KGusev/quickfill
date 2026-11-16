"""Download pinned test-only distributions; never packaged with the extension."""
from pathlib import Path
from urllib.request import urlopen
files = {
    'react.development.js':'https://unpkg.com/react@18.3.1/umd/react.development.js',
    'react-dom.development.js':'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js',
    'vue.global.prod.js':'https://unpkg.com/vue@3.5.13/dist/vue.global.prod.js',
}
folder=Path(__file__).parent/'vendor'
folder.mkdir(exist_ok=True)
for filename,url in files.items():
    (folder/filename).write_bytes(urlopen(url,timeout=30).read())
    print(filename)
