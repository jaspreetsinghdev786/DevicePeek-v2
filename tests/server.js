const http = require('http');
const long = Array.from({ length: 80 }, (_, i) => `<p id="p${i}">Paragraph ${i} lorem ipsum dolor sit amet.</p>`).join('');
const page = (title, body, head = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>${title}</title>${head}
<style>body{font-family:sans-serif;margin:0;padding:60px 20px 20px}header{position:fixed;top:0;left:0;right:0;height:44px;background:#333;color:#fff}#chat{position:fixed;right:16px;bottom:16px;width:56px;height:56px;background:red;border-radius:50%}</style></head>
<body><header id="hdr">Header <a href="/about" id="about">About</a> <a href="/" id="home">Home</a></header>${body}<div id="chat"></div></body></html>`;

const spa = page('SPA', `<button id="go" onclick="history.pushState({}, '', '/spa/route2'); document.title='R2'">go</button><div>${long}</div>`);

module.exports = function start(port) {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      const ua = req.headers['user-agent'] || '';
      if (u.pathname === '/ua') {
        rsp.writeHead(200, { 'content-type': 'text/plain' });
        return rsp.end(ua);
      }
      if (u.pathname === '/xfo') {
        rsp.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
        return rsp.end(page('XFO', '<h1>xfo page</h1>' + long));
      }
      if (u.pathname === '/strictcsp') {
        rsp.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "frame-src 'none'" });
        return rsp.end(page('CSP', '<h1>strict csp</h1>' + long));
      }
      if (u.pathname.startsWith('/spa')) {
        rsp.writeHead(200, { 'content-type': 'text/html' });
        return rsp.end(spa);
      }
      rsp.writeHead(200, { 'content-type': 'text/html' });
      rsp.end(page(u.pathname, `<h1>${u.pathname}</h1><div id="ua-mark">${/iPhone|Android/.test(ua) ? 'MOBILE' : 'DESKTOP'}</div>${long}`));
    });
    srv.listen(port, () => res(srv));
  });
};
