from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
import os
import re

ROOT=Path(__file__).resolve().parents[1]
CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.wasm':'application/wasm','.task':'application/octet-stream','.mp4':'video/mp4','.vtt':'text/vtt'}
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def send_head(self):
        self._range_remaining=None
        path=Path(self.translate_path(self.path))
        if path.suffix.lower()!='.mp4' or not path.is_file():return super().send_head()
        try:source=path.open('rb')
        except OSError:return self.send_error(404,'File not found')
        stat=os.fstat(source.fileno());length=stat.st_size
        raw=self.headers.get('Range') if not self.headers.get('If-Range') else None
        start,end=0,length-1
        if raw is not None:
            match=re.fullmatch(r'bytes=(\d*)-(\d*)',raw.strip())
            try:
                if not match or not any(match.groups()) or length==0:raise ValueError()
                first,last=match.groups()
                if not first:
                    suffix=int(last)
                    if suffix<=0:raise ValueError()
                    start=max(0,length-suffix)
                else:
                    start=int(first);end=min(length-1,int(last)) if last else length-1
                    if start>=length or end<start:raise ValueError()
            except (ValueError,OverflowError):
                source.close();self.send_response(416,'Range Not Satisfiable')
                self.send_header('Content-Range',f'bytes */{length}')
                self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length','0');self.end_headers()
                return None
        count=max(0,end-start+1);source.seek(start);self._range_remaining=count
        self.send_response(206 if raw is not None else 200)
        self.send_header('Content-Type','video/mp4');self.send_header('Accept-Ranges','bytes')
        self.send_header('Content-Length',str(count));self.send_header('Last-Modified',self.date_time_string(stat.st_mtime))
        if raw is not None:self.send_header('Content-Range',f'bytes {start}-{end}/{length}')
        self.end_headers();return source
    def copyfile(self,source,outputfile):
        remaining=self._range_remaining
        if remaining is None:return super().copyfile(source,outputfile)
        while remaining>0:
            chunk=source.read(min(64*1024,remaining))
            if not chunk:break
            outputfile.write(chunk);remaining-=len(chunk)
    def end_headers(self):
        if self.path.startswith('/app/'):
            self.send_header('Content-Security-Policy',CSP)
            self.send_header('Cross-Origin-Opener-Policy','same-origin')
            self.send_header('Cross-Origin-Embedder-Policy','require-corp')
            self.send_header('Cross-Origin-Resource-Policy','same-origin')
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
    def log_message(self,format,*args):pass
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=4187);args=parser.parse_args()
    print(f'Arseniy Move preview: http://127.0.0.1:{args.port}/preview/index.html',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
