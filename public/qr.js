/* Self-hosted QR code generator (byte mode, error correction M). No external library, CSP-safe.
   window.makeQrDataUri(text) -> data:image/svg+xml URI, or '' on failure. */
(function () {
  'use strict';
  var ECC = [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
  var BLK = [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
  function rawModules(v) { var r = (16 * v + 128) * v + 64; if (v >= 2) { var n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; }
  function dataCodewords(v) { return Math.floor(rawModules(v) / 8) - ECC[v] * BLK[v]; }
  function gmul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 255; }
  function rsDivisor(d) { var r = []; for (var i = 0; i < d - 1; i++) r.push(0); r.push(1); var root = 1; for (i = 0; i < d; i++) { for (var j = 0; j < d; j++) { r[j] = gmul(r[j], root); if (j + 1 < d) r[j] ^= r[j + 1]; } root = gmul(root, 2); } return r; }
  function rsRemainder(data, div) { var r = div.map(function () { return 0; }); data.forEach(function (b) { var f = b ^ r.shift(); r.push(0); div.forEach(function (c, i) { r[i] ^= gmul(c, f); }); }); return r; }
  function utf8(s) { var u = unescape(encodeURIComponent(s)), a = []; for (var i = 0; i < u.length; i++) a.push(u.charCodeAt(i)); return a; }
  function encode(text) {
    var bytes = utf8(text), ver = 0;
    for (var v = 1; v <= 40; v++) { var cc = v < 10 ? 8 : 16; if (4 + cc + bytes.length * 8 <= dataCodewords(v) * 8) { ver = v; break; } }
    if (!ver) throw new Error('too long');
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8; put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = []; for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
    // ECC + interleave
    var nb = BLK[ver], el = ECC[ver], raw = Math.floor(rawModules(ver) / 8), ns = nb - raw % nb, sl = Math.floor(raw / nb), div = rsDivisor(el), blocks = [], p = 0;
    for (i = 0; i < nb; i++) { var dat = data.slice(p, p + sl - el + (i < ns ? 0 : 1)); p += dat.length; var ecc = rsRemainder(dat, div); if (i < ns) dat.push(0); blocks.push(dat.concat(ecc)); }
    var all = []; for (i = 0; i < blocks[0].length; i++) blocks.forEach(function (bl, j) { if (i !== sl - el || j >= ns) all.push(bl[i]); });
    // matrix
    var size = ver * 4 + 17, m = [], fn = [];
    for (i = 0; i < size; i++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(x, y, d) { m[y][x] = d; fn[y][x] = true; }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    function finder(cx, cy) { for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) { var d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4); } }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var pos = []; if (ver > 1) { var na = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2; pos = [6]; for (var ps = size - 7; pos.length < na; ps -= step) pos.splice(1, 0, ps); }
    for (i = 0; i < pos.length; i++) for (var j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    function fmt(mask) {
      var d = (0 << 3) | mask, r = d; for (var q = 0; q < 10; q++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var bt = ((d << 10) | r) ^ 0x5412; function g(n) { return ((bt >>> n) & 1) !== 0; }
      for (q = 0; q <= 5; q++) setF(8, q, g(q)); setF(8, 7, g(6)); setF(8, 8, g(7)); setF(7, 8, g(8));
      for (q = 9; q < 15; q++) setF(14 - q, 8, g(q));
      for (q = 0; q < 8; q++) setF(size - 1 - q, 8, g(q));
      for (q = 8; q < 15; q++) setF(8, size - 15 + q, g(q));
      setF(8, size - 8, true);
    }
    fmt(0);
    if (ver >= 7) { var rr = ver; for (i = 0; i < 12; i++) rr = (rr << 1) ^ ((rr >>> 11) * 0x1F25); var vb = (ver << 12) | rr; for (i = 0; i < 18; i++) { var col = ((vb >>> i) & 1) !== 0, a = size - 11 + i % 3, b2 = Math.floor(i / 3); setF(a, b2, col); setF(b2, a, col); } }
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) { var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert; if (!fn[y][x] && idx < all.length * 8) { m[y][x] = ((all[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0; idx++; } } }
    function mask(mk) { for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) { var inv; switch (mk) { case 0: inv = (x + y) % 2 === 0; break; case 1: inv = y % 2 === 0; break; case 2: inv = x % 3 === 0; break; case 3: inv = (x + y) % 3 === 0; break; case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; case 5: inv = x * y % 2 + x * y % 3 === 0; break; case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break; default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0; } if (!fn[y][x] && inv) m[y][x] = !m[y][x]; } }
    function penalty() {
      var s = 0, y, x, run, c;
      for (y = 0; y < size; y++) { run = 1; for (x = 1; x < size; x++) { if (m[y][x] === m[y][x - 1]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; } }
      for (x = 0; x < size; x++) { run = 1; for (y = 1; y < size; y++) { if (m[y][x] === m[y - 1][x]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; } }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) s += 3; }
      return s;
    }
    var best = 0, bestP = Infinity;
    for (var mk = 0; mk < 8; mk++) { mask(mk); fmt(mk); var pn = penalty(); if (pn < bestP) { bestP = pn; best = mk; } mask(mk); }
    mask(best); fmt(best);
    return m;
  }
  window.makeQrDataUri = function (text) {
    try {
      var m = encode(String(text)), n = m.length, q = 2, d = '';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) d += 'M' + (x + q) + ',' + (y + q) + 'h1v1h-1z';
      var t = n + q * 2;
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + t + ' ' + t + '" shape-rendering="crispEdges"><rect width="' + t + '" height="' + t + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    } catch (e) { return ''; }
  };
})();
