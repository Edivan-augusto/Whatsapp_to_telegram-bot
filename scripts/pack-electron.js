const packager = require('electron-packager');

(async () => {
  const ignoreFn = (file) => {
    try {
      const f = (file || '').replace(/\\/g, '/');
      if (f.startsWith('/dist') || f.startsWith('dist/')) return true;
      if (f.includes('/dist/WA TG Assistant (Python)')) return true;
      if (f.startsWith('/.wwebjs_auth') || f.startsWith('.wwebjs_auth/')) return true;
      if (f.startsWith('/.wwebjs_cache') || f.startsWith('.wwebjs_cache/')) return true;
      if (f.includes('/node_modules/puppeteer/.local-chromium')) return true;
    } catch {}
    return false;
  };

  const options = {
    dir: '.',
    name: 'WA TG Assistant',
    platform: 'win32',
    arch: 'x64',
    out: 'dist-electron',
    overwrite: true,
    ignore: ignoreFn,
  };
  const appPaths = await packager(options);
  console.log('Packed:', appPaths);
})().catch((e) => { console.error(e); process.exit(1); });
